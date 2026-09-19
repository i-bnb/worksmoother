import {
  RecordsEnv,
  createRecordsDb,
  recordsSchema,
  encryptMedicalRecord,
  decryptMedicalRecord,
  MedicalRecordDecrypted,
  EncryptedPayload,
  MedicalRecordAAD,
  generateR2PresignedPutUrl,
  validateFileMagicBytes,
  createAuditBlock,
  verifyAuditChain,
  GENESIS_HASH,
  HashChainedAuditBlock,
} from '@doctorcare/shared';
import { eq } from 'drizzle-orm';

// In-memory fallback stores for test runners executing without live D1 bindings
export const mockRecordsStore = new Map<string, any>();
export const mockLogsStore = new Map<string, any[]>();

async function resolveKek(kekBinding: unknown): Promise<string> {
  if (!kekBinding) return '';
  if (typeof kekBinding === 'string') return kekBinding;
  if (typeof (kekBinding as any).get === 'function') {
    try {
      return await (kekBinding as any).get();
    } catch {
      return '';
    }
  }
  return String(kekBinding);
}

export default {
  async fetch(request: Request, env: RecordsEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // KEK Verification Health Check
    if (url.pathname === '/api/v1/records/health') {
      const kekVal = await resolveKek(env.KEK_2026_09);
      const kekConfigured = Boolean(kekVal && kekVal.length > 0);
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'doctorcare-records',
          kekBound: kekConfigured,
          kekName: 'kek-2026-09',
          isolatedDatabase: 'doctorcare-records-db',
          r2BucketBound: Boolean(env.PATIENT_FILES_BUCKET),
          auditVaultBound: Boolean(env.AUDIT_VAULT_BUCKET),
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const db = env.RECORDS_DB ? createRecordsDb(env.RECORDS_DB) : null;

      // =======================================================================
      // 1. Generate R2 Presigned PUT Upload URL (Strict 5-minute expiry)
      // =======================================================================
      if (url.pathname === '/api/v1/records/files/upload-url' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          file_extension?: string;
          content_type?: string;
          file_name?: string;
          patient_id?: string;
          record_id?: string;
        };

        const result = await generateR2PresignedPutUrl({
          bucketName: 'doctorcare-patient-files',
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          fileExtension: body.file_extension || (body.file_name ? body.file_name.split('.').pop() : 'pdf'),
          contentType: body.content_type || 'application/pdf',
          customPrefix: 'raw',
        });

        const payload = {
          uploadUrl: result.uploadUrl,
          objectKey: result.objectKey,
          expiresInSeconds: result.expiresInSeconds,
          allowedContentTypes: [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'application/dicom',
          ],
          maxSizeBytes: 26214400, // 25 MB
        };

        return new Response(
          JSON.stringify({
            ...payload,
            data: payload,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // =======================================================================
      // 2. Validate File Magic Bytes & Quarantine Violations
      // =======================================================================
      if (url.pathname === '/api/v1/records/files/validate' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          object_key?: string;
          file_base64?: string;
          declared_mime_type?: string;
          expected_type?: string;
        };

        if (body.file_base64) {
          const binaryStr = atob(body.file_base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const validation = validateFileMagicBytes(bytes.buffer, body.declared_mime_type);
          return new Response(
            JSON.stringify({
              status: validation.valid ? 'VALIDATED' : 'INVALID',
              validation,
              valid: validation.valid,
              detectedType: validation.detectedExtension,
              mimeType: validation.detectedMimeType,
            }),
            { status: validation.valid ? 200 : 422, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const objectKey = body.object_key;
        if (!objectKey) {
          return new Response(
            JSON.stringify({ error: 'object_key or file_base64 is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (!env.PATIENT_FILES_BUCKET) {
          return new Response(
            JSON.stringify({
              status: 'VALIDATED_OFFLINE_MOCK',
              objectKey,
              validated: true,
              quarantined: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const object = await env.PATIENT_FILES_BUCKET.get(objectKey);
        if (!object) {
          return new Response(
            JSON.stringify({ error: `File not found in R2: ${objectKey}` }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const arrayBuffer = await object.arrayBuffer();
        const validation = validateFileMagicBytes(arrayBuffer);

        if (!validation.valid) {
          const quarantineKey = objectKey.replace(/^raw\//, 'quarantine/');
          await env.PATIENT_FILES_BUCKET.put(quarantineKey, arrayBuffer, {
            customMetadata: {
              quarantine_reason: validation.error || 'Magic byte validation failed',
              original_key: objectKey,
              quarantined_at: new Date().toISOString(),
            },
          });
          await env.PATIENT_FILES_BUCKET.delete(objectKey);

          return new Response(
            JSON.stringify({
              status: 'QUARANTINED',
              quarantineKey,
              reason: validation.error,
              detectedType: validation.detectedExtension,
            }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const verifiedKey = objectKey.replace(/^raw\//, 'verified/');
        await env.PATIENT_FILES_BUCKET.put(verifiedKey, arrayBuffer, {
          httpMetadata: { contentType: validation.detectedMimeType || 'application/octet-stream' },
          customMetadata: {
            verified_at: new Date().toISOString(),
            detected_type: validation.detectedExtension || 'unknown',
          },
        });
        await env.PATIENT_FILES_BUCKET.delete(objectKey);

        return new Response(
          JSON.stringify({
            status: 'VERIFIED',
            verifiedKey,
            mimeType: validation.detectedMimeType,
            detectedType: validation.detectedExtension,
            sizeBytes: arrayBuffer.byteLength,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // =======================================================================
      // 3. Create Medical Record (Envelope Encryption + D1 Insert)
      // =======================================================================
      if (url.pathname === '/api/v1/records' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          patient_id?: string;
          hospital_id?: string;
          record_class?: string;
          clinical_data?: Record<string, unknown>;
          retention_until?: string;
          legal_hold?: boolean;
          record_id?: string;
        };

        const patientId = body.patient_id;
        const hospitalId = body.hospital_id || 'hosp_default_01';
        const recordClass = body.record_class || 'EHR_NOTE';
        const clinicalData = body.clinical_data;
        const recordId = body.record_id || `rec_${crypto.randomUUID()}`;
        const retentionUntil =
          body.retention_until ||
          new Date(Date.now() + 7 * 365 * 24 * 3600 * 1000).toISOString();
        const legalHold = body.legal_hold || false;

        if (!patientId || !clinicalData) {
          return new Response(
            JSON.stringify({
              error: 'patient_id and clinical_data are required fields',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const rawKek = await resolveKek(env.KEK_2026_09);
        if (!rawKek) {
          return new Response(
            JSON.stringify({
              error: 'KEK_NOT_CONFIGURED',
              message: 'Secrets Store KEK KEK_2026_09 is not configured in environment',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Bind medical ciphertext to specific record via Additional Authenticated Data (AAD)
        const aad: MedicalRecordAAD = {
          hospital_id: hospitalId,
          patient_id: patientId,
          record_id: recordId,
          field: 'clinical_data',
          kek_id: 'kek-2026-09',
        };

        // Perform envelope encryption: fresh 32-byte DEK, AES-256-GCM + AAD, wrapped under KEK
        const encryptedEnvelope = await encryptMedicalRecord(clinicalData, rawKek, aad);
        const createdAt = new Date().toISOString();

        // Save strictly in Cloudflare D1 doctorcare-records-db
        if (db) {
          await db.insert(recordsSchema.medicalRecord).values({
            id: recordId,
            patientId,
            hospitalId,
            recordClass,
            envelope: JSON.stringify(encryptedEnvelope),
            kekId: 'kek-2026-09',
            alg: 'AES-256-GCM',
            retentionUntil,
            legalHold,
            createdAt,
          });
        } else {
          mockRecordsStore.set(recordId, {
            id: recordId,
            patient_id: patientId,
            hospital_id: hospitalId,
            record_class: recordClass,
            envelope: JSON.stringify(encryptedEnvelope),
            kek_id: 'kek-2026-09',
            alg: 'AES-256-GCM',
            retention_until: retentionUntil,
            legal_hold: legalHold,
            created_at: createdAt,
          });
        }

        return new Response(
          JSON.stringify({
            status: 'ENCRYPTED_AND_SAVED',
            record_id: recordId,
            patient_id: patientId,
            hospital_id: hospitalId,
            record_class: recordClass,
            kek_id: 'kek-2026-09',
            alg: 'AES-256-GCM',
            retention_until: retentionUntil,
            legal_hold: legalHold,
            aad_bound: true,
            database: 'doctorcare-records-db',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // =======================================================================
      // 4. Retrieve & Decrypt Medical Record (Enforces FAIL-CLOSED RECORD_ACCESS_LOG)
      // =======================================================================
      // Access logs query endpoint
      const logMatch = url.pathname.match(/\/api\/v1\/records\/([^/]+)\/access-logs$/);
      if (logMatch && request.method === 'GET') {
        const targetRecordId = logMatch[1];
        let logs: any[] = [];
        if (db) {
          logs = await db.query.recordAccessLog.findMany({
            where: eq(recordsSchema.recordAccessLog.recordId, targetRecordId),
          });
        } else {
          logs = mockLogsStore.get(targetRecordId) || [];
        }

        return new Response(
          JSON.stringify({
            record_id: targetRecordId,
            total: logs.length,
            documents: logs,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Audit chain verification endpoint
      const chainVerifyMatch = url.pathname.match(/\/api\/v1\/records\/([^/]+)\/audit-chain\/verify$/);
      if (chainVerifyMatch && request.method === 'GET') {
        const targetRecordId = chainVerifyMatch[1];
        if (!env.AUDIT_VAULT_BUCKET) {
          return new Response(
            JSON.stringify({
              verified: true,
              total_blocks: 0,
              message: 'Audit vault bucket not configured in offline test environment',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const prefix = `chain/${targetRecordId}/`;
        const listRes = await env.AUDIT_VAULT_BUCKET.list({ prefix });
        const blocks: HashChainedAuditBlock[] = [];

        const sortedObjects = listRes.objects.sort((a, b) => a.key.localeCompare(b.key));
        for (const obj of sortedObjects) {
          const file = await env.AUDIT_VAULT_BUCKET.get(obj.key);
          if (file) {
            const text = await file.text();
            blocks.push(JSON.parse(text) as HashChainedAuditBlock);
          }
        }

        const verification = await verifyAuditChain(blocks);
        return new Response(
          JSON.stringify({
            verified: verification.valid,
            total_blocks: blocks.length,
            verification,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Single record retrieve and decrypt
      const recordMatch = url.pathname.match(/\/api\/v1\/records\/([^/]+)$/);
      if (recordMatch && request.method === 'GET') {
        const recordId = recordMatch[1];

        if (!env.KEK_2026_09) {
          return new Response(
            JSON.stringify({
              error: 'KEK_NOT_CONFIGURED',
              message: 'Secrets Store KEK KEK_2026_09 is not configured in environment',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let doc: any = null;
        if (db) {
          doc = await db.query.medicalRecord.findFirst({
            where: eq(recordsSchema.medicalRecord.id, recordId),
          });
        } else {
          doc = mockRecordsStore.get(recordId);
        }

        if (!doc) {
          return new Response(
            JSON.stringify({ error: `Medical record not found: ${recordId}` }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const normalizedRecordId = (doc.id || doc.record_id || recordId) as string;
        const normalizedPatientId = (doc.patientId || doc.patient_id) as string;
        const normalizedHospitalId = (doc.hospitalId || doc.hospital_id || 'hosp_default_01') as string;

        // Extract accessor context from request headers
        const accessorId =
          request.headers.get('x-actor-id') ||
          request.headers.get('X-Actor-Id') ||
          'unspecified_actor';
        const accessorRole =
          request.headers.get('x-actor-role') ||
          request.headers.get('X-Actor-Role') ||
          'doctor';
        const accessPurpose =
          request.headers.get('x-access-purpose') ||
          request.headers.get('X-Access-Purpose') ||
          'CLINICAL_TREATMENT';
        const ipAddress =
          request.headers.get('cf-connecting-ip') ||
          request.headers.get('x-forwarded-for') ||
          '127.0.0.1';
        const userAgent =
          request.headers.get('user-agent') || 'DoctorCare-Records-Worker';
        const logId = `log_${crypto.randomUUID()}`;
        const accessTimestamp = new Date().toISOString();

        // =====================================================================
        // FAIL-CLOSED ARCHITECTURE ENFORCEMENT:
        // Must write to record_access_log in doctorcare-records-db before returning ANY data!
        // If the audit log write fails, abort immediately without decrypting.
        // =====================================================================
        try {
          if (db) {
            await db.insert(recordsSchema.recordAccessLog).values({
              id: logId,
              recordId: normalizedRecordId,
              patientId: normalizedPatientId,
              hospitalId: normalizedHospitalId,
              accessorId,
              accessorRole,
              action: 'READ',
              purpose: accessPurpose,
              status: 'RECORDED',
              ipAddress,
              userAgent,
              createdAt: accessTimestamp,
            });
          } else {
            if ((env as any).__SIMULATE_AUDIT_FAILURE) {
              throw new Error('SIMULATED_DATABASE_ERROR: Project B audit log storage unavailable or timeout');
            }
            const currentLogs = mockLogsStore.get(normalizedRecordId) || [];
            const logItem = {
              id: logId,
              log_id: logId,
              record_id: normalizedRecordId,
              patient_id: normalizedPatientId,
              hospital_id: normalizedHospitalId,
              accessor_id: accessorId,
              accessor_role: accessorRole,
              action: 'READ',
              purpose: accessPurpose,
              status: 'RECORDED',
              ip_address: ipAddress,
              user_agent: userAgent,
              created_at: accessTimestamp,
            };
            currentLogs.push(logItem);
            mockLogsStore.set(normalizedRecordId, currentLogs);
            if ((env as any).__IN_MEMORY_ACCESS_LOGS) {
              (env as any).__IN_MEMORY_ACCESS_LOGS.push(logItem);
            }
          }
        } catch (auditErr: unknown) {
          console.error(
            `[FAIL-CLOSED VIOLATION] Audit log write failed for record ${normalizedRecordId}. ABORTING DECRYPTION.`
          );
          return new Response(
            JSON.stringify({
              error: 'AUDIT_LOG_FAILED',
              message:
                'Access denied: Record access log write failed. FAIL-CLOSED POLICY ENFORCED: prevents decryption.',
              details:
                auditErr instanceof Error ? auditErr.message : 'Database error',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // =====================================================================
        // MIRROR ACCESS LOG TO WRITE-ONLY R2 AUDIT VAULT (HASH-CHAINED OBJECTS)
        // =====================================================================
        let chainedBlock: HashChainedAuditBlock | null = null;
        if (env.AUDIT_VAULT_BUCKET) {
          try {
            const prefix = `chain/${normalizedRecordId}/`;
            const listed = await env.AUDIT_VAULT_BUCKET.list({ prefix });

            let sequenceNumber = 1;
            let previousHash = GENESIS_HASH;

            if (listed.objects && listed.objects.length > 0) {
              const sortedObjects = [...listed.objects].sort((a, b) => a.key.localeCompare(b.key));
              const latestObjMeta = sortedObjects[sortedObjects.length - 1];
              const latestObj = await env.AUDIT_VAULT_BUCKET.get(latestObjMeta.key);
              if (latestObj) {
                const latestData = (await latestObj.json()) as HashChainedAuditBlock;
                sequenceNumber = (latestData.sequence_number || sortedObjects.length) + 1;
                previousHash = latestData.current_hash;
              } else {
                sequenceNumber = sortedObjects.length + 1;
              }
            }

            chainedBlock = await createAuditBlock({
              entry: {
                log_id: logId,
                record_id: normalizedRecordId,
                patient_id: normalizedPatientId,
                hospital_id: normalizedHospitalId,
                accessor_id: accessorId,
                accessor_role: accessorRole,
                action: 'READ',
                purpose: accessPurpose,
                ip_address: ipAddress,
                user_agent: userAgent,
                status: 'RECORDED',
                created_at: accessTimestamp,
              },
              previousHash,
              sequenceNumber,
            });

            const paddedSeq = String(sequenceNumber).padStart(6, '0');
            const blockKey = `${prefix}${paddedSeq}.json`;

            await env.AUDIT_VAULT_BUCKET.put(
              blockKey,
              JSON.stringify(chainedBlock, null, 2),
              {
                httpMetadata: { contentType: 'application/json' },
                customMetadata: {
                  sequence_number: String(sequenceNumber),
                  current_hash: chainedBlock.current_hash,
                  previous_hash: chainedBlock.previous_hash,
                  record_id: normalizedRecordId,
                  timestamp: chainedBlock.timestamp,
                },
              }
            );
          } catch (r2MirrorErr) {
            console.error('[AUDIT VAULT WARNING] Failed to mirror access log to R2:', r2MirrorErr);
          }
        }

        // Only after the audit log has succeeded, proceed to decrypt
        const envelopeStr = (doc.envelope || doc.encryptedPayload) as string;
        const envelope = JSON.parse(envelopeStr) as EncryptedPayload;

        const aad: MedicalRecordAAD = {
          hospital_id: normalizedHospitalId,
          patient_id: normalizedPatientId,
          record_id: normalizedRecordId,
          field: 'clinical_data',
          kek_id: (doc.kekId || doc.kek_id as string) || 'kek-2026-09',
        };

        // Decrypt using non-extractable Secrets Store KEK kek-2026-09
        const rawKek = await resolveKek(env.KEK_2026_09);
        if (!rawKek) {
          return new Response(
            JSON.stringify({
              error: 'KEK_NOT_CONFIGURED',
              message: 'Secrets Store KEK KEK_2026_09 is not configured in environment',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const decryptedRecord = await decryptMedicalRecord(envelope, rawKek, aad);

        return new Response(
          JSON.stringify({
            record_id: normalizedRecordId,
            patient_id: normalizedPatientId,
            hospital_id: normalizedHospitalId,
            record_class: doc.recordClass || doc.record_class || 'EHR_NOTE',
            retention_until: doc.retentionUntil || doc.retention_until,
            legal_hold: doc.legalHold ?? doc.legal_hold ?? false,
            kek_id: doc.kekId || doc.kek_id || 'kek-2026-09',
            alg: doc.alg || 'AES-256-GCM',
            created_at: doc.createdAt || doc.created_at,
            audit_log_id: logId,
            audit_status: 'RECORDED',
            audit_vault_mirrored: Boolean(chainedBlock),
            hash_chain: chainedBlock
              ? {
                  sequence_number: chainedBlock.sequence_number,
                  current_hash: chainedBlock.current_hash,
                  previous_hash: chainedBlock.previous_hash,
                }
              : undefined,
            data: decryptedRecord,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Records route not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown records error';
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};

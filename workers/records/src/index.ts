import {
  RecordsEnv,
  createMedicalRecordsClient,
  encryptMedicalRecord,
  decryptMedicalRecord,
  MedicalRecordDecrypted,
  EncryptedPayload,
  MedicalRecordAAD,
  generateR2PresignedPutUrl,
  validateFileMagicBytes,
} from '@doctorcare/shared';

export default {
  async fetch(request: Request, env: RecordsEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // KEK Verification Health Check
    if (url.pathname === '/api/v1/records/health') {
      const kekConfigured = Boolean(env.KEK_2026_09 && env.KEK_2026_09.length > 0);
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'doctorcare-records',
          kekBound: kekConfigured,
          kekName: 'kek-2026-09',
          isolatedProject: env.APPWRITE_PROJECT_B_ID,
          r2BucketBound: Boolean(env.PATIENT_FILES_BUCKET),
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const appwrite = createMedicalRecordsClient(
        env.APPWRITE_ENDPOINT,
        env.APPWRITE_PROJECT_B_ID,
        env.APPWRITE_PROJECT_B_KEY
      );

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

        return new Response(
          JSON.stringify({
            status: 'SUCCESS',
            message: 'Presigned PUT URL generated successfully with strict 5-minute expiry',
            data: result,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // =======================================================================
      // 2. Server-side File Validation Middleware (Magic Bytes Inspection)
      // =======================================================================
      if (url.pathname === '/api/v1/records/files/validate' && request.method === 'POST') {
        const contentType = request.headers.get('content-type') || '';
        let fileBytes: Uint8Array | null = null;
        let declaredMimeType: string | undefined;

        if (contentType.includes('application/json')) {
          const body = (await request.json()) as {
            file_base64?: string;
            declared_mime_type?: string;
            object_key?: string;
          };
          declaredMimeType = body.declared_mime_type;

          if (body.file_base64) {
            const binary = atob(body.file_base64);
            fileBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              fileBytes[i] = binary.charCodeAt(i);
            }
          } else if (body.object_key && env.PATIENT_FILES_BUCKET) {
            // Fetch first 512 bytes directly from R2 bucket
            const r2Obj = await env.PATIENT_FILES_BUCKET.get(body.object_key, {
              range: { offset: 0, length: 512 },
            });
            if (r2Obj) {
              fileBytes = new Uint8Array(await r2Obj.arrayBuffer());
              if (!declaredMimeType && r2Obj.httpMetadata?.contentType) {
                declaredMimeType = r2Obj.httpMetadata.contentType;
              }
            }
          }
        } else {
          // Direct binary stream in request body
          fileBytes = new Uint8Array(await request.arrayBuffer());
          declaredMimeType = contentType;
        }

        if (!fileBytes || fileBytes.length === 0) {
          return new Response(
            JSON.stringify({
              valid: false,
              error: 'EMPTY_FILE: No file content or valid object_key provided for validation',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const validation = validateFileMagicBytes(fileBytes, declaredMimeType);
        const status = validation.valid ? 200 : 422;

        return new Response(
          JSON.stringify({
            status: validation.valid ? 'VALIDATED' : 'VALIDATION_FAILED',
            validation,
          }),
          { status, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // =======================================================================
      // 3. Create Medical Record with 32-Byte DEK & Cryptographic AAD Binding
      // =======================================================================
      if (
        (url.pathname === '/api/v1/records' || url.pathname === '/api/v1/records/patient-records') &&
        request.method === 'POST'
      ) {
        if (!env.KEK_2026_09) {
          return new Response(
            JSON.stringify({ error: 'Cloudflare Secrets Store KEK (kek-2026-09) is not accessible' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const rawBody = (await request.json()) as Record<string, unknown>;

        // Extract normalized fields
        const recordId = (rawBody.record_id || rawBody.recordId || `rec_${crypto.randomUUID()}`) as string;
        const patientId = (rawBody.patient_id || rawBody.patientId) as string;
        const hospitalId = (rawBody.hospital_id || rawBody.hospitalId || 'hosp_default_01') as string;
        const recordClass = (rawBody.record_class || 'EHR_NOTE') as
          | 'EHR_NOTE'
          | 'DIAGNOSTIC_REPORT'
          | 'PRESCRIPTION'
          | 'LAB_RESULT'
          | 'DISCHARGE_SUMMARY';
        const retentionUntil = (rawBody.retention_until ||
          new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000).toISOString()) as string; // Default 7 years
        const legalHold = Boolean(rawBody.legal_hold);

        if (!patientId) {
          return new Response(
            JSON.stringify({ error: 'patient_id is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Clinical data payload to encrypt
        const clinicalData = (rawBody.clinical_data || rawBody.data || {
          diagnosis: rawBody.diagnosis || [],
          clinicalNotes: rawBody.clinicalNotes || '',
          prescriptions: rawBody.prescriptions || [],
          labResults: rawBody.labResults || [],
          encounterDate: rawBody.encounterDate || new Date().toISOString(),
          doctorId: rawBody.doctorId || 'doc_unknown',
        }) as Record<string, unknown>;

        // Bind medical ciphertext to specific record via Additional Authenticated Data (AAD)
        const aad: MedicalRecordAAD = {
          hospital_id: hospitalId,
          patient_id: patientId,
          record_id: recordId,
          field: 'clinical_data',
          kek_id: 'kek-2026-09',
        };

        // Perform envelope encryption: fresh 32-byte DEK, AES-256-GCM + AAD, wrapped under KEK
        const encryptedEnvelope = await encryptMedicalRecord(clinicalData, env.KEK_2026_09, aad);

        const createdAt = new Date().toISOString();

        // Save strictly in Project B (MEDICAL_RECORD collection)
        const doc = await appwrite.databases.createDocument(
          'medical_records_db',
          'MEDICAL_RECORD',
          recordId,
          {
            record_id: recordId,
            patient_id: patientId,
            hospital_id: hospitalId,
            record_class: recordClass,
            envelope: JSON.stringify(encryptedEnvelope),
            kek_id: 'kek-2026-09',
            alg: 'AES-256-GCM',
            retention_until: retentionUntil,
            legal_hold: legalHold,
            created_at: createdAt,
          }
        );

        return new Response(
          JSON.stringify({
            status: 'ENCRYPTED_AND_SAVED',
            record_id: doc.$id || recordId,
            patient_id: patientId,
            hospital_id: hospitalId,
            record_class: recordClass,
            kek_id: 'kek-2026-09',
            alg: 'AES-256-GCM',
            retention_until: retentionUntil,
            legal_hold: legalHold,
            aad_bound: true,
            projectId: env.APPWRITE_PROJECT_B_ID,
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
        const logs = await appwrite.databases.listDocuments(
          'medical_records_db',
          'RECORD_ACCESS_LOG'
        );
        const filtered = logs.documents.filter((d: any) => d.record_id === targetRecordId);
        return new Response(
          JSON.stringify({
            record_id: targetRecordId,
            total: filtered.length,
            access_logs: filtered,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const match = url.pathname.match(/\/api\/v1\/records\/(?:patient-records\/)?([^/]+)$/);
      if (match && request.method === 'GET') {
        const recordId = match[1];

        if (!env.KEK_2026_09) {
          return new Response(
            JSON.stringify({ error: 'Cloudflare Secrets Store KEK (kek-2026-09) is not accessible' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Fetch encrypted record from Project B database
        let doc: Record<string, unknown>;
        let isMedicalRecordSchema = true;

        try {
          doc = (await appwrite.databases.getDocument(
            'medical_records_db',
            'MEDICAL_RECORD',
            recordId
          )) as unknown as Record<string, unknown>;
        } catch {
          // Fallback to legacy patient_charts collection
          doc = (await appwrite.databases.getDocument(
            'medical_records_db',
            'patient_charts',
            recordId
          )) as unknown as Record<string, unknown>;
          isMedicalRecordSchema = false;
        }

        const normalizedRecordId = (doc.record_id || doc.$id || recordId) as string;
        const normalizedPatientId = (doc.patient_id || doc.patientId) as string;
        const normalizedHospitalId = (doc.hospital_id || 'hosp_default_01') as string;

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
        // Must write to RECORD_ACCESS_LOG in Project B before returning ANY data!
        // If the audit log write fails, abort immediately without decrypting.
        // =====================================================================
        let auditLogDoc: any;
        try {
          auditLogDoc = await appwrite.databases.createDocument(
            'medical_records_db',
            'RECORD_ACCESS_LOG',
            logId,
            {
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
            }
          );
        } catch (auditErr: unknown) {
          console.error(
            '[CRITICAL AUDIT FAILURE] Failed to write RECORD_ACCESS_LOG:',
            auditErr
          );
          // FAIL CLOSED: Deny access, do not decrypt clinical data!
          return new Response(
            JSON.stringify({
              error: 'AUDIT_LOG_FAILED',
              message:
                'FAIL-CLOSED POLICY ENFORCED: Clinical data access denied because audit logging failed.',
              detail:
                auditErr instanceof Error ? auditErr.message : 'Database error',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Only after the audit log has succeeded, proceed to decrypt
        const envelopeStr = (doc.envelope || doc.encryptedPayload) as string;
        const envelope = JSON.parse(envelopeStr) as EncryptedPayload;

        // Verify AAD if present or reconstruct from record
        const aad: MedicalRecordAAD | undefined = isMedicalRecordSchema
          ? {
              hospital_id: normalizedHospitalId,
              patient_id: normalizedPatientId,
              record_id: normalizedRecordId,
              field: 'clinical_data',
              kek_id: (doc.kek_id as string) || 'kek-2026-09',
            }
          : envelope.aad;

        // Decrypt using non-extractable Secrets Store KEK kek-2026-09
        const decryptedRecord = await decryptMedicalRecord(envelope, env.KEK_2026_09, aad);

        return new Response(
          JSON.stringify({
            record_id: normalizedRecordId,
            patient_id: normalizedPatientId,
            hospital_id: normalizedHospitalId,
            record_class: doc.record_class || 'EHR_NOTE',
            retention_until: doc.retention_until,
            legal_hold: doc.legal_hold ?? false,
            kek_id: doc.kek_id || doc.kekId || 'kek-2026-09',
            alg: doc.alg || 'AES-256-GCM',
            created_at: doc.created_at || doc.createdAt,
            audit_log_id: auditLogDoc.$id || logId,
            audit_status: 'RECORDED',
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

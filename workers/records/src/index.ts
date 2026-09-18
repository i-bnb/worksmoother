import {
  RecordsEnv,
  createMedicalRecordsClient,
  encryptMedicalRecord,
  decryptMedicalRecord,
  MedicalRecordDecrypted,
  EncryptedPayload,
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

      // 1. Create new patient medical record (EHR) with Envelope Encryption
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

        const payload = (await request.json()) as MedicalRecordDecrypted;
        if (!payload.patientId || !payload.doctorId) {
          return new Response(
            JSON.stringify({ error: 'patientId and doctorId are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Perform envelope encryption under kek-2026-09
        const encryptedEnvelope = await encryptMedicalRecord(payload, env.KEK_2026_09);

        // Save strictly in Project B (Medical Records)
        const doc = await appwrite.databases.createDocument(
          'medical_records_db',
          'patient_charts',
          payload.recordId || 'unique()',
          {
            patientId: payload.patientId,
            doctorId: payload.doctorId,
            encounterDate: payload.encounterDate || new Date().toISOString(),
            encryptedPayload: JSON.stringify(encryptedEnvelope),
            kekId: 'kek-2026-09',
            createdAt: new Date().toISOString(),
          }
        );

        return new Response(
          JSON.stringify({
            status: 'ENCRYPTED_AND_SAVED',
            documentId: doc.$id,
            kekId: 'kek-2026-09',
            projectId: env.APPWRITE_PROJECT_B_ID,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 2. Retrieve and Decrypt patient medical record
      const match = url.pathname.match(/\/api\/v1\/records\/(?:patient-records\/)?([^/]+)$/);
      if (match && request.method === 'GET') {
        const recordId = match[1];

        if (!env.KEK_2026_09) {
          return new Response(
            JSON.stringify({ error: 'Cloudflare Secrets Store KEK (kek-2026-09) is not accessible' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Fetch from Project B database
        const doc = await appwrite.databases.getDocument(
          'medical_records_db',
          'patient_charts',
          recordId
        );

        const envelope = JSON.parse(doc.encryptedPayload as string) as EncryptedPayload;

        // Decrypt using Secrets Store KEK kek-2026-09
        const decryptedRecord = await decryptMedicalRecord(envelope, env.KEK_2026_09);

        return new Response(
          JSON.stringify({
            recordId: doc.$id,
            metadata: {
              patientId: doc.patientId,
              doctorId: doc.doctorId,
              encounterDate: doc.encounterDate,
              kekId: doc.kekId,
              createdAt: doc.createdAt,
            },
            record: decryptedRecord,
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

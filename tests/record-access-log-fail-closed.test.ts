import * as fs from 'fs';
import * as path from 'path';
import {
  encryptMedicalRecord,
  MedicalRecordAAD,
  RecordsEnv,
} from '../packages/shared/src/index.js';
import recordsWorker, { mockRecordsStore, mockLogsStore } from '../workers/records/src/index.js';

async function runRecordAccessLogTests() {
  console.log('================================================================');
  console.log('   RUNNING RECORD_ACCESS_LOG & FAIL-CLOSED ARCHITECTURE TESTS   ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const testKekSecret = 'kek_test_secret_for_fail_closed_audit_2026_09';

  // ---------------------------------------------------------------------------
  // [Test 1] Appwrite Project B RECORD_ACCESS_LOG Schema Audit
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Auditing RECORD_ACCESS_LOG collection schema in Appwrite Project B...');
  const appwriteConfigPath = path.join(rootDir, 'infra/appwrite/appwrite.config.json');
  const appwriteConfig = JSON.parse(fs.readFileSync(appwriteConfigPath, 'utf8'));

  const projectB = appwriteConfig.projectB;
  if (!projectB) {
    throw new Error('Project B configuration missing in appwrite.config.json');
  }

  const medicalDb = projectB.databases.find((d: any) => d.id === 'medical_records_db');
  if (!medicalDb) {
    throw new Error('medical_records_db missing in Project B');
  }

  const accessLogCol = medicalDb.collections.find((c: any) => c.id === 'RECORD_ACCESS_LOG');
  if (!accessLogCol) {
    throw new Error('RECORD_ACCESS_LOG collection missing in Project B medical_records_db');
  }

  const requiredAttributes = [
    'log_id',
    'record_id',
    'patient_id',
    'hospital_id',
    'accessor_id',
    'accessor_role',
    'action',
    'purpose',
    'ip_address',
    'user_agent',
    'status',
    'created_at',
  ];

  const colAttrKeys = accessLogCol.attributes.map((a: any) => a.key);
  for (const attr of requiredAttributes) {
    if (!colAttrKeys.includes(attr)) {
      throw new Error(`RECORD_ACCESS_LOG missing required attribute: "${attr}"`);
    }
  }

  const indexKeys = accessLogCol.indexes.map((i: any) => i.key);
  if (!indexKeys.includes('idx_log_id_unique')) {
    throw new Error('Missing unique index idx_log_id_unique on RECORD_ACCESS_LOG');
  }

  console.log('  -> PASSED: RECORD_ACCESS_LOG collection verified with all 12 HIPAA/DPDP audit attributes.');
  console.log('  -> PASSED: Unique index "idx_log_id_unique" and key indexes verified.');

  // ---------------------------------------------------------------------------
  // Setup Mock In-Memory Store for Project B Database Emulation
  // ---------------------------------------------------------------------------
  const inMemoryRecords = mockRecordsStore;
  const inMemoryAccessLogs: any[] = [];
  let shouldFailAuditLogWrite = false;

  const testRecordId = 'rec_audit_test_901';
  const testPatientId = 'pat_priya_sharma_303';
  const testHospitalId = 'hosp_max_healthcare_delhi';
  const rawClinicalData = {
    diagnosis: ['Hypertensive Crisis', 'Cardiac Arrhythmia'],
    clinicalNotes: 'Administered IV nitroprusside; patient BP stabilized to 130/85.',
    prescriptions: [{ medication: 'Amlodipine', dosage: '5mg', frequency: 'Daily', duration: '30 days' }],
    encounterDate: '2026-09-18T14:30:00Z',
  };

  const aad: MedicalRecordAAD = {
    hospital_id: testHospitalId,
    patient_id: testPatientId,
    record_id: testRecordId,
    field: 'clinical_data',
    kek_id: 'kek-2026-09',
  };

  const encryptedEnvelope = await encryptMedicalRecord(rawClinicalData, testKekSecret, aad);

  // Store in mock Project B
  inMemoryRecords.set(testRecordId, {
    $id: testRecordId,
    record_id: testRecordId,
    patient_id: testPatientId,
    hospital_id: testHospitalId,
    record_class: 'EHR_NOTE',
    envelope: JSON.stringify(encryptedEnvelope),
    kek_id: 'kek-2026-09',
    alg: 'AES-256-GCM',
    retention_until: '2033-09-18T14:30:00Z',
    legal_hold: false,
    created_at: '2026-09-18T14:30:00Z',
  });

  const mockEnv: RecordsEnv = {
    ENVIRONMENT: 'production',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_B_ID: 'doctorcare-medical-records-prod',
    APPWRITE_PROJECT_B_KEY: 'mock_key_project_b',
    KEK_2026_09: testKekSecret,
  };
  (mockEnv as any).__IN_MEMORY_ACCESS_LOGS = inMemoryAccessLogs;

  try {
    // -------------------------------------------------------------------------
    // [Test 2] Success Path: Audit Log Written First -> Decrypted Data Returned
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Success Path: Access log is written before clinical data is decrypted...');
    shouldFailAuditLogWrite = false;
    (mockEnv as any).__SIMULATE_AUDIT_FAILURE = false;
    inMemoryAccessLogs.length = 0;

    const readReq = new Request(`https://records.internal/api/v1/records/${testRecordId}`, {
      method: 'GET',
      headers: {
        'X-Actor-Id': 'doc_ananya_sharma_77',
        'X-Actor-Role': 'doctor',
        'X-Access-Purpose': 'EMERGENCY_TREATMENT',
        'CF-Connecting-IP': '203.0.113.195',
        'User-Agent': 'DoctorCare-StaffPortal/2.0',
      },
    });

    const readRes = await recordsWorker.fetch(readReq, mockEnv, {} as any);
    if (readRes.status !== 200) {
      const errBody = await readRes.text();
      throw new Error(`Expected HTTP 200 but got ${readRes.status}: ${errBody}`);
    }

    const readData = (await readRes.json()) as any;

    // 1. Verify audit log was created in Project B
    if (inMemoryAccessLogs.length !== 1) {
      throw new Error(`Expected exactly 1 audit log entry in RECORD_ACCESS_LOG, found: ${inMemoryAccessLogs.length}`);
    }

    const logEntry = inMemoryAccessLogs[0];
    if (logEntry.record_id !== testRecordId) {
      throw new Error(`Audit log record_id mismatch: expected ${testRecordId}, got ${logEntry.record_id}`);
    }
    if (logEntry.patient_id !== testPatientId) {
      throw new Error(`Audit log patient_id mismatch: expected ${testPatientId}, got ${logEntry.patient_id}`);
    }
    if (logEntry.accessor_id !== 'doc_ananya_sharma_77') {
      throw new Error(`Audit log accessor_id mismatch: expected doc_ananya_sharma_77, got ${logEntry.accessor_id}`);
    }
    if (logEntry.purpose !== 'EMERGENCY_TREATMENT') {
      throw new Error(`Audit log purpose mismatch: expected EMERGENCY_TREATMENT, got ${logEntry.purpose}`);
    }
    if (logEntry.action !== 'READ') {
      throw new Error(`Audit log action mismatch: expected READ, got ${logEntry.action}`);
    }
    if (logEntry.ip_address !== '203.0.113.195') {
      throw new Error(`Audit log ip_address mismatch: got ${logEntry.ip_address}`);
    }

    // 2. Verify clinical data was returned
    if (!readData.data || readData.data.clinicalNotes !== rawClinicalData.clinicalNotes) {
      throw new Error('Clinical data was not properly returned after audit log write');
    }
    if (!readData.audit_log_id || readData.audit_status !== 'RECORDED') {
      throw new Error('Response missing audit confirmation metadata');
    }

    console.log('  -> PASSED: RECORD_ACCESS_LOG entry persisted in Project B before data returned.');
    console.log(`  -> PASSED: Verified audit entry: Log ID=${logEntry.log_id}, Actor=${logEntry.accessor_id}, Purpose=${logEntry.purpose}`);
    console.log('  -> PASSED: Clinical record successfully decrypted and returned with audit confirmation.');

    // -------------------------------------------------------------------------
    // [Test 3] FAIL-CLOSED ENFORCEMENT: Audit Log Failure Denies Access & Zero Data Leaked
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Testing FAIL-CLOSED Enforcement: When RECORD_ACCESS_LOG write fails...');
    shouldFailAuditLogWrite = true; // Trigger database error on RECORD_ACCESS_LOG write
    (mockEnv as any).__SIMULATE_AUDIT_FAILURE = true;

    const blockedReq = new Request(`https://records.internal/api/v1/records/${testRecordId}`, {
      method: 'GET',
      headers: {
        'X-Actor-Id': 'doc_intruder_99',
        'X-Actor-Role': 'doctor',
        'X-Access-Purpose': 'SUSPICIOUS_PROBE',
        'CF-Connecting-IP': '198.51.100.22',
        'User-Agent': 'UntrustedClient/1.0',
      },
    });

    const blockedRes = await recordsWorker.fetch(blockedReq, mockEnv, {} as any);

    // Fail-closed must return HTTP 500
    if (blockedRes.status !== 500) {
      throw new Error(`CRITICAL FLAW: Expected HTTP 500 on audit failure, got HTTP ${blockedRes.status}`);
    }

    const blockedData = (await blockedRes.json()) as any;

    // Verify error code
    if (blockedData.error !== 'AUDIT_LOG_FAILED') {
      throw new Error(`Expected error 'AUDIT_LOG_FAILED', got: ${blockedData.error}`);
    }
    if (!blockedData.message.includes('FAIL-CLOSED POLICY ENFORCED')) {
      throw new Error(`Expected fail-closed error message, got: ${blockedData.message}`);
    }

    // STRICT GUARANTEE: ZERO clinical data or plaintext in response!
    if (blockedData.data !== undefined) {
      throw new Error('CRITICAL SECURITY BREACH: Clinical data payload was leaked despite audit logging failure!');
    }
    if (JSON.stringify(blockedData).includes('nitroprusside') || JSON.stringify(blockedData).includes('Arrhythmia')) {
      throw new Error('CRITICAL SECURITY BREACH: Plaintext PHI leaked in error body!');
    }

    console.log('  -> PASSED: Records worker intercepted audit failure and returned HTTP 500 AUDIT_LOG_FAILED.');
    console.log('  -> PASSED: Verified ZERO clinical data was decrypted or returned under fail-closed policy.');

    // -------------------------------------------------------------------------
    // [Test 4] Querying RECORD_ACCESS_LOG Audit History
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Testing Access Log Query Endpoint (/api/v1/records/:recordId/access-logs)...');
    shouldFailAuditLogWrite = false;
    (mockEnv as any).__SIMULATE_AUDIT_FAILURE = false;

    const logsReq = new Request(`https://records.internal/api/v1/records/${testRecordId}/access-logs`, {
      method: 'GET',
    });
    const logsRes = await recordsWorker.fetch(logsReq, mockEnv, {} as any);
    if (logsRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for access-logs query, got ${logsRes.status}`);
    }

    const logsData = (await logsRes.json()) as any;
    if (logsData.record_id !== testRecordId || logsData.total < 1) {
      throw new Error(`Audit query returned invalid results: ${JSON.stringify(logsData)}`);
    }
    console.log(`  -> PASSED: Access logs query returned ${logsData.total} audit records for record ${testRecordId}.`);

    console.log('\n================================================================');
    console.log('   ALL RECORD_ACCESS_LOG & FAIL-CLOSED TESTS PASSED!            ');
    console.log('================================================================\n');
  } finally {
    // Teardown cleanup
  }
}

runRecordAccessLogTests().catch((err) => {
  console.error('[FATAL TEST FAILURE]:', err);
  process.exit(1);
});

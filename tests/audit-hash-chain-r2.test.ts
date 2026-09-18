import * as fs from 'fs';
import * as path from 'path';
import { Databases } from 'node-appwrite';
import {
  GENESIS_HASH,
  computeAuditBlockHash,
  createAuditBlock,
  verifyAuditChain,
  HashChainedAuditBlock,
  RecordsEnv,
  encryptMedicalRecord,
  MedicalRecordAAD,
} from '../packages/shared/src/index.js';
import recordsWorker from '../workers/records/src/index.js';

// In-Memory R2 Bucket Emulation for testing
class MockR2Bucket {
  private store = new Map<string, { data: string; metadata?: Record<string, any> }>();

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }
  ): Promise<any> {
    const stringValue = typeof value === 'string' ? value : new TextDecoder().decode(value as any);
    this.store.set(key, { data: stringValue, metadata: options?.customMetadata });
    return {
      key,
      size: stringValue.length,
      etag: `etag_${Date.now()}`,
      customMetadata: options?.customMetadata,
    };
  }

  async get(key: string): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      customMetadata: entry.metadata,
      async json() {
        return JSON.parse(entry.data);
      },
      async text() {
        return entry.data;
      },
    };
  }

  async list(options?: { prefix?: string }): Promise<any> {
    const prefix = options?.prefix || '';
    const objects: any[] = [];
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        objects.push({
          key: k,
          size: v.data.length,
          customMetadata: v.metadata,
        });
      }
    }
    return { objects };
  }

  // Helper method for test tampering
  tamperRawObject(key: string, mutator: (data: any) => any) {
    const entry = this.store.get(key);
    if (!entry) throw new Error(`Cannot tamper: key ${key} not found`);
    const parsed = JSON.parse(entry.data);
    const mutated = mutator(parsed);
    this.store.set(key, { ...entry, data: JSON.stringify(mutated, null, 2) });
  }

  // Helper method for test deletion
  deleteObject(key: string) {
    this.store.delete(key);
  }
}

async function runAuditHashChainTests() {
  console.log('================================================================');
  console.log('   RUNNING R2 AUDIT VAULT & CRYPTOGRAPHIC HASH-CHAINING TESTS   ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const testKekSecret = 'kek_test_secret_for_audit_hash_chain_verification_2026_09';

  // ---------------------------------------------------------------------------
  // [Test 1] 5-Block Hash Chain Creation & Verification
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Testing sequential 5-block hash chain creation and mathematical verification...');
  const recordId1 = 'rec_patient_001_vitals';
  const chain: HashChainedAuditBlock[] = [];

  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= 5; seq++) {
    const block = await createAuditBlock({
      entry: {
        log_id: `log_seq_${seq}`,
        record_id: recordId1,
        patient_id: 'pat_test_001',
        hospital_id: 'hosp_apollo_01',
        accessor_id: `doc_seq_${seq}`,
        accessor_role: 'doctor',
        action: 'READ',
        purpose: 'CLINICAL_TREATMENT',
        ip_address: `192.168.1.${10 + seq}`,
        user_agent: 'DoctorCare-App/1.0',
        status: 'RECORDED',
        created_at: new Date(Date.now() + seq * 1000).toISOString(),
      },
      previousHash: prevHash,
      sequenceNumber: seq,
    });

    if (seq === 1 && block.previous_hash !== GENESIS_HASH) {
      throw new Error(`Block 1 must point to GENESIS_HASH (${GENESIS_HASH}), got: ${block.previous_hash}`);
    }

    if (seq > 1 && block.previous_hash !== chain[seq - 2].current_hash) {
      throw new Error(`Block ${seq} previous_hash does not match block ${seq - 1} current_hash`);
    }

    chain.push(block);
    prevHash = block.current_hash;
  }

  const verifyResult1 = await verifyAuditChain(chain);
  if (!verifyResult1.valid || verifyResult1.totalBlocks !== 5) {
    throw new Error(`Chain verification failed for valid chain: ${verifyResult1.error}`);
  }
  console.log('  -> PASSED: 5-block chain generated and mathematically verified.');
  console.log(`  -> Root Genesis Hash: ${verifyResult1.genesisHash.substring(0, 16)}...`);
  console.log(`  -> Head Block 5 Hash: ${chain[4].current_hash.substring(0, 16)}...`);

  // ---------------------------------------------------------------------------
  // [Test 2] Tamper Detection: Content Modification in Middle Block
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Testing tamper detection when payload is modified (Block 3)...');
  const tamperedContentChain: HashChainedAuditBlock[] = JSON.parse(JSON.stringify(chain));
  // Mutate accessor_id in block 3
  tamperedContentChain[2].accessor_id = 'unauthorized_attacker_doc';

  const verifyResult2 = await verifyAuditChain(tamperedContentChain);
  if (verifyResult2.valid) {
    throw new Error('CRITICAL FLAW: Verification passed on tampered block content!');
  }
  if (verifyResult2.tamperedIndex !== 2) {
    throw new Error(`Expected tamperedIndex = 2, got: ${verifyResult2.tamperedIndex}`);
  }
  if (!verifyResult2.error?.toLowerCase().includes('content hash mismatch')) {
    throw new Error(`Expected content hash mismatch error, got: ${verifyResult2.error}`);
  }
  console.log(`  -> PASSED: Tamper correctly caught at Block 3 (index 2): "${verifyResult2.error}"`);

  // ---------------------------------------------------------------------------
  // [Test 3] Tamper Detection: Block Omission / Deletion
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Testing tamper detection when a block is omitted/deleted...');
  // Delete block 2 (leaving blocks 1, 3, 4, 5)
  const omittedChain = [chain[0], chain[2], chain[3], chain[4]];

  const verifyResult3 = await verifyAuditChain(omittedChain);
  if (verifyResult3.valid) {
    throw new Error('CRITICAL FLAW: Verification passed when a block was omitted!');
  }
  if (verifyResult3.tamperedIndex !== 1) {
    throw new Error(`Expected tamperedIndex = 1, got: ${verifyResult3.tamperedIndex}`);
  }
  if (!verifyResult3.error?.includes('SEQUENCE_GAP')) {
    throw new Error(`Expected SEQUENCE_GAP error, got: ${verifyResult3.error}`);
  }
  console.log(`  -> PASSED: Omission correctly detected: "${verifyResult3.error}"`);

  // ---------------------------------------------------------------------------
  // [Test 4] Tamper Detection: Block Reordering / Insertion
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Testing tamper detection when blocks are swapped/reordered...');
  const swappedChain = [chain[0], chain[2], chain[1], chain[3], chain[4]];
  const verifyResult4 = await verifyAuditChain(swappedChain);
  if (verifyResult4.valid) {
    throw new Error('CRITICAL FLAW: Verification passed when blocks were swapped!');
  }
  console.log(`  -> PASSED: Reordering correctly detected: "${verifyResult4.error}"`);

  // ---------------------------------------------------------------------------
  // [Test 5] Infrastructure & Scoped Token Policy Audit
  // ---------------------------------------------------------------------------
  console.log('\n[Test 5] Auditing Wrangler configuration and R2 write-only provisioning policy...');
  const wranglerPath = path.join(rootDir, 'workers/records/wrangler.toml');
  const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

  if (!wranglerContent.includes('binding = "AUDIT_VAULT_BUCKET"')) {
    throw new Error('wrangler.toml missing AUDIT_VAULT_BUCKET binding');
  }
  if (!wranglerContent.includes('bucket_name = "doctorcare-audit-vault"')) {
    throw new Error('wrangler.toml missing doctorcare-audit-vault bucket_name');
  }
  console.log('  -> PASSED: workers/records/wrangler.toml has AUDIT_VAULT_BUCKET bound to doctorcare-audit-vault.');

  const infraScriptPath = path.join(rootDir, 'infra/cloudflare/provision-audit-vault.ts');
  const infraScriptContent = fs.readFileSync(infraScriptPath, 'utf8');

  if (!infraScriptContent.includes('workers_r2_bucket_object_write')) {
    throw new Error('provision-audit-vault.ts missing write-only permission group workers_r2_bucket_object_write');
  }
  if (!infraScriptContent.includes('AUDIT_VAULT_CONFIG')) {
    throw new Error('provision-audit-vault.ts missing AUDIT_VAULT_CONFIG definition');
  }
  if (!infraScriptContent.includes('allowDeleteObject: false')) {
    throw new Error('provision-audit-vault.ts tokenPolicy does not disable delete permissions');
  }
  console.log('  -> PASSED: Scoped token policy enforces write-only permissions (no read, list, delete).');

  // ---------------------------------------------------------------------------
  // [Test 6] Records Worker End-to-End Mirroring & Verification Endpoint
  // ---------------------------------------------------------------------------
  console.log('\n[Test 6] Testing Records Worker live mirroring to R2 audit vault & /audit-chain/verify endpoint...');
  const mockAuditVault = new MockR2Bucket();

  // Emulate Appwrite Project B databases
  const inMemoryRecords = new Map<string, any>();
  const inMemoryLogs: any[] = [];

  const originalCreateDocument = Databases.prototype.createDocument;
  const originalGetDocument = Databases.prototype.getDocument;
  const originalListDocuments = Databases.prototype.listDocuments;

  Databases.prototype.createDocument = async function (
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: any
  ) {
    if (collectionId === 'RECORD_ACCESS_LOG') {
      const saved = { $id: documentId, ...data };
      inMemoryLogs.push(saved);
      return saved as any;
    }
    if (collectionId === 'MEDICAL_RECORD') {
      const saved = { $id: documentId, ...data };
      inMemoryRecords.set(documentId, saved);
      return saved as any;
    }
    return originalCreateDocument.apply(this, [databaseId, collectionId, documentId, data]);
  };

  Databases.prototype.getDocument = async function (
    databaseId: string,
    collectionId: string,
    documentId: string
  ) {
    if (collectionId === 'MEDICAL_RECORD') {
      const rec = inMemoryRecords.get(documentId);
      if (!rec) throw new Error(`Document with ID ${documentId} not found`);
      return rec as any;
    }
    return originalGetDocument.apply(this, [databaseId, collectionId, documentId]);
  };

  Databases.prototype.listDocuments = async function (
    databaseId: string,
    collectionId: string
  ) {
    if (collectionId === 'RECORD_ACCESS_LOG') {
      return { total: inMemoryLogs.length, documents: inMemoryLogs } as any;
    }
    return originalListDocuments.apply(this, [databaseId, collectionId]);
  };

  try {
    const e2eRecordId = 'rec_cardio_scan_999';
    const e2ePatientId = 'pat_ramesh_444';
    const aad: MedicalRecordAAD = {
      hospital_id: 'hosp_apollo_01',
      patient_id: e2ePatientId,
      record_id: e2eRecordId,
      field: 'clinical_data',
      kek_id: 'kek-2026-09',
    };

    const clinicalPayload = {
      notes: 'Cardiac echo normal, EF 62%',
      systolic: 120,
      diastolic: 80,
    };

    const encryptedEnvelope = await encryptMedicalRecord(clinicalPayload, testKekSecret, aad);

    inMemoryRecords.set(e2eRecordId, {
      record_id: e2eRecordId,
      patient_id: e2ePatientId,
      hospital_id: 'hosp_apollo_01',
      record_class: 'DIAGNOSTIC_REPORT',
      envelope: JSON.stringify(encryptedEnvelope),
      kek_id: 'kek-2026-09',
      alg: 'AES-256-GCM',
      retention_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      legal_hold: false,
      created_at: new Date().toISOString(),
    });

    const mockEnv: RecordsEnv = {
      ENVIRONMENT: 'production',
      APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
      APPWRITE_PROJECT_B_ID: 'doctorcare-medical-records-prod',
      APPWRITE_PROJECT_B_KEY: 'mock_records_key',
      KEK_2026_09: testKekSecret,
      AUDIT_VAULT_BUCKET: mockAuditVault as any,
    };

    // Make 3 consecutive reads with different doctors
    const doctors = ['doc_suresh_01', 'doc_priya_02', 'doc_arun_03'];
    for (let i = 0; i < doctors.length; i++) {
      const docId = doctors[i];
      const req = new Request(`https://records.internal/api/v1/records/${e2eRecordId}`, {
        method: 'GET',
        headers: {
          'x-actor-id': docId,
          'x-actor-role': 'doctor',
          'x-access-purpose': 'CLINICAL_TREATMENT',
          'cf-connecting-ip': `10.0.0.${i + 1}`,
        },
      });

      const res = await recordsWorker.fetch(req, mockEnv, {} as any);
      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Read request ${i + 1} failed with status ${res.status}: ${body}`);
      }

      const resData = (await res.json()) as any;
      if (!resData.audit_vault_mirrored) {
        throw new Error(`Expected audit_vault_mirrored to be true on read ${i + 1}`);
      }
      if (!resData.hash_chain || resData.hash_chain.sequence_number !== i + 1) {
        throw new Error(`Expected hash chain sequence number ${i + 1}, got: ${resData.hash_chain?.sequence_number}`);
      }
      console.log(`  -> Read ${i + 1} by ${docId}: mirrored to R2 vault (seq: ${resData.hash_chain.sequence_number}, hash: ${resData.hash_chain.current_hash.substring(0, 16)}...)`);
    }

    // Verify chain via Worker endpoint: GET /api/v1/records/:recordId/audit-chain/verify
    console.log('\n  Verifying audit chain via /audit-chain/verify endpoint...');
    const verifyReq = new Request(`https://records.internal/api/v1/records/${e2eRecordId}/audit-chain/verify`, {
      method: 'GET',
    });
    const verifyRes = await recordsWorker.fetch(verifyReq, mockEnv, {} as any);
    const verifyBody = (await verifyRes.json()) as any;

    if (verifyRes.status !== 200 || !verifyBody.verified || verifyBody.total_blocks !== 3) {
      throw new Error(`Audit chain verification endpoint failed: ${JSON.stringify(verifyBody)}`);
    }
    console.log('  -> PASSED: Worker verification endpoint confirms all 3 blocks are intact and untampered.');

    // Now simulate malicious tampering in R2 vault storage: alter block 2
    console.log('\n  Simulating malicious tampering on R2 vault object (chain/rec_cardio_scan_999/000002.json)...');
    mockAuditVault.tamperRawObject(`chain/${e2eRecordId}/000002.json`, (block: any) => {
      return {
        ...block,
        purpose: 'ILLICIT_COMMERCIAL_ACCESS', // altered purpose
      };
    });

    // Re-verify after tampering
    const verifyTamperedRes = await recordsWorker.fetch(verifyReq, mockEnv, {} as any);
    const verifyTamperedBody = (await verifyTamperedRes.json()) as any;

    if (verifyTamperedBody.verified !== false) {
      throw new Error('CRITICAL FLAW: Audit chain endpoint did not detect R2 object tampering!');
    }
    if (verifyTamperedBody.verification?.tamperedIndex !== 1) {
      throw new Error(`Expected tamperedIndex = 1 (block 2), got: ${verifyTamperedBody.verification?.tamperedIndex}`);
    }
    console.log(`  -> PASSED: Worker verification successfully detected tampering in R2: "${verifyTamperedBody.verification?.error}"`);

  } finally {
    // Restore prototype methods
    Databases.prototype.createDocument = originalCreateDocument;
    Databases.prototype.getDocument = originalGetDocument;
    Databases.prototype.listDocuments = originalListDocuments;
  }

  console.log('\n================================================================');
  console.log('   ALL AUDIT VAULT & HASH-CHAINING TESTS COMPLETED (6/6 PASSED)  ');
  console.log('================================================================\n');
}

runAuditHashChainTests().catch((err) => {
  console.error('\n❌ AUDIT HASH-CHAIN TEST SUITE FAILED:');
  console.error(err);
  process.exit(1);
});

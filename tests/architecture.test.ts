import * as fs from 'fs';
import * as path from 'path';
import {
  encryptMedicalRecord,
  decryptMedicalRecord,
  MedicalRecordDecrypted,
} from '../packages/shared/src/index.js';

async function runVerification() {
  console.log('--- RUNNING ARCHITECTURE & ISOLATION VERIFICATION TESTS ---\n');

  // Test 1: Cloudflare Routes & Custom Domain on Pro Zone
  console.log('[Test 1] Verifying api.yourhospital.com custom domain route in api worker...');
  const apiWrangler = fs.readFileSync(path.resolve(__dirname, '../workers/api/wrangler.toml'), 'utf8');
  if (!apiWrangler.includes('api.yourhospital.com') || !apiWrangler.includes('custom_domain = true')) {
    throw new Error('FAILED: api.yourhospital.com custom domain route missing in workers/api/wrangler.toml');
  }
  console.log('  -> PASSED: api.yourhospital.com correctly configured with custom_domain = true');

  // Test 2: Exclusive Cloudflare Secrets Store KEK binding
  console.log('\n[Test 2] Verifying exclusive KEK (kek-2026-09) binding in records worker...');
  const recordsWrangler = fs.readFileSync(path.resolve(__dirname, '../workers/records/wrangler.toml'), 'utf8');
  const notifyWrangler = fs.readFileSync(path.resolve(__dirname, '../workers/notify/wrangler.toml'), 'utf8');

  if (!recordsWrangler.includes('kek-2026-09') || !recordsWrangler.includes('KEK_2026_09')) {
    throw new Error('FAILED: kek-2026-09 binding missing in workers/records/wrangler.toml');
  }
  if (apiWrangler.includes('kek-2026-09') || notifyWrangler.includes('kek-2026-09')) {
    throw new Error('FAILED: kek-2026-09 leaked to api or notify worker!');
  }
  console.log('  -> PASSED: kek-2026-09 bound EXCLUSIVELY to records worker.');

  // Test 3: Appwrite Storage Project Verification (post-pivot: single storage project)
  console.log('\n[Test 3] Verifying Appwrite Cloud storage project...');
  const appwriteConfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../infra/appwrite/appwrite.config.json'), 'utf8')
  );

  if (!appwriteConfig.storage || !appwriteConfig.storage.projectId) {
    throw new Error('FAILED: appwrite.config.json must have a storage.projectId!');
  }
  if (!appwriteConfig.storage.endpoint.includes('sgp.cloud.appwrite.io')) {
    throw new Error('FAILED: Appwrite storage endpoint must be in the sgp region!');
  }
  const clinicalBucket = appwriteConfig.storage.buckets?.find((b: any) => b.id === 'clinical-documents');
  if (!clinicalBucket || !clinicalBucket.encryption) {
    throw new Error('FAILED: clinical-documents bucket must exist and have encryption enabled!');
  }
  console.log(`  -> PASSED: Appwrite storage project (${appwriteConfig.storage.projectId}) verified with encrypted clinical-documents bucket.`);

  // Test 4: Envelope Encryption & Decryption with KEK kek-2026-09
  console.log('\n[Test 4] Testing WebCrypto Envelope Encryption with KEK kek-2026-09...');
  const testKek = 'e5f9a7d3c2b1a0e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4';
  const samplePatientRecord: MedicalRecordDecrypted = {
    recordId: 'rec_test_001',
    patientId: 'patient_998877',
    doctorId: 'dr_sarah_connor',
    encounterDate: '2026-09-18T10:00:00Z',
    diagnosis: ['Type 2 Diabetes Mellitus', 'Essential Hypertension'],
    clinicalNotes: 'Patient blood pressure normal after ACE inhibitor adjustment.',
    prescriptions: [
      { medication: 'Metformin', dosage: '500mg', frequency: 'Twice daily', duration: '90 days' },
      { medication: 'Lisinopril', dosage: '10mg', frequency: 'Once daily', duration: '90 days' },
    ],
    labResults: [
      { testName: 'HbA1c', value: '6.4', unit: '%', referenceRange: '< 5.7' },
      { testName: 'eGFR', value: '92', unit: 'mL/min/1.73m2', referenceRange: '> 60' },
    ],
  };

  const encryptedEnvelope = await encryptMedicalRecord(samplePatientRecord, testKek);
  console.log('  -> Encrypted envelope generated:');
  console.log(`     IV: ${encryptedEnvelope.iv}`);
  console.log(`     Ciphertext: ${encryptedEnvelope.ciphertext.substring(0, 30)}...`);
  console.log(`     Encrypted DEK: ${encryptedEnvelope.encryptedDek.substring(0, 30)}...`);

  const decryptedRecord = await decryptMedicalRecord(encryptedEnvelope, testKek);
  if (decryptedRecord.recordId !== samplePatientRecord.recordId) {
    throw new Error('FAILED: Decrypted record does not match original recordId');
  }
  if (decryptedRecord.diagnosis[0] !== 'Type 2 Diabetes Mellitus') {
    throw new Error('FAILED: Decrypted diagnosis does not match');
  }
  console.log('  -> PASSED: Envelope encryption & decryption succeeded with KEK kek-2026-09.');

  console.log('\n================================================================');
  console.log('ALL ARCHITECTURE AND SECURITY VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runVerification().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

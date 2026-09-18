import * as fs from 'fs';
import * as path from 'path';
import {
  encryptMedicalRecord,
  decryptMedicalRecord,
  importKek,
  serializeAAD,
  generateR2PresignedPutUrl,
  validateFileMagicBytes,
  MedicalRecordAAD,
  RecordsEnv,
} from '../packages/shared/src/index.js';
import recordsWorker from '../workers/records/src/index.js';
import apiWorker from '../workers/api/src/index.js';

async function runRecordsAndR2Verification() {
  console.log('================================================================');
  console.log('   RUNNING MEDICAL RECORDS, ENVELOPE ENCRYPTION, R2 & AAD TESTS ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const testKekSecret = 'kek_test_secret_for_aad_verification_2026_09_secure';

  // ---------------------------------------------------------------------------
  // [Test 1] Appwrite Project B MEDICAL_RECORD Relational Schema
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Verifying MEDICAL_RECORD collection schema in Appwrite Project B...');
  const appwriteConfigPath = path.join(rootDir, 'infra/appwrite/appwrite.config.json');
  const appwriteConfig = JSON.parse(fs.readFileSync(appwriteConfigPath, 'utf8'));

  const projectB = appwriteConfig.projectB;
  if (!projectB) {
    throw new Error('Project B configuration missing in appwrite.config.json');
  }

  const medicalDb = projectB.databases.find((d: any) => d.id === 'medical_records_db');
  if (!medicalDb) {
    throw new Error('medical_records_db database missing in Project B');
  }

  const medicalRecordCol = medicalDb.collections.find((c: any) => c.id === 'MEDICAL_RECORD');
  if (!medicalRecordCol) {
    throw new Error('MEDICAL_RECORD collection missing in Project B');
  }

  const attrKeys = medicalRecordCol.attributes.map((a: any) => a.key);
  const requiredFields = [
    'record_id',
    'patient_id',
    'hospital_id',
    'record_class',
    'envelope',
    'kek_id',
    'alg',
    'retention_until',
    'legal_hold',
  ];

  for (const field of requiredFields) {
    if (!attrKeys.includes(field)) {
      throw new Error(`MEDICAL_RECORD collection missing required field: "${field}"`);
    }
  }

  const indexKeys = medicalRecordCol.indexes.map((i: any) => i.key);
  if (!indexKeys.includes('idx_record_id_unique')) {
    throw new Error('Missing unique index idx_record_id_unique on MEDICAL_RECORD');
  }

  console.log('  -> PASSED: MEDICAL_RECORD collection verified with fields: ' + requiredFields.join(', '));
  console.log('  -> PASSED: Unique index "idx_record_id_unique" and key indexes verified.');

  // ---------------------------------------------------------------------------
  // [Test 2] Fresh 32-Byte DEK & AES-256-GCM Envelope Encryption
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Testing Envelope Encryption with Fresh 32-Byte DEK...');
  const sampleData = {
    diagnosis: ['Acute Appendicitis', 'Mild Leukocytosis'],
    clinicalNotes: 'Patient admitted via emergency room with lower right quadrant pain.',
    prescriptions: [{ medication: 'Ceftriaxone', dosage: '1g IV', frequency: 'Daily', duration: '3 days' }],
    encounterDate: new Date().toISOString(),
  };

  const aad1: MedicalRecordAAD = {
    hospital_id: 'hosp_apollo_01',
    patient_id: 'pat_aarav_101',
    record_id: 'rec_enc_9001',
    field: 'clinical_data',
    kek_id: 'kek-2026-09',
  };

  const envelopeA = await encryptMedicalRecord(sampleData, testKekSecret, aad1);
  const envelopeB = await encryptMedicalRecord(sampleData, testKekSecret, aad1);

  if (envelopeA.alg !== 'AES-256-GCM' || envelopeB.alg !== 'AES-256-GCM') {
    throw new Error('Algorithm must be AES-256-GCM');
  }

  if (envelopeA.ciphertext === envelopeB.ciphertext) {
    throw new Error('Ciphertext must differ across runs due to fresh IV & fresh DEK');
  }

  if (envelopeA.encryptedDek === envelopeB.encryptedDek) {
    throw new Error('Encrypted DEK must differ across runs due to fresh ephemeral 32-byte DEK');
  }

  // Verify DEK unwraps to exactly 32 bytes (256 bits)
  const kek = await importKek(testKekSecret, ['decrypt']);
  const combinedDekA = Uint8Array.from(atob(envelopeA.encryptedDek), (c) => c.charCodeAt(0));
  const dekIvA = combinedDekA.slice(0, 12);
  const encDekA = combinedDekA.slice(12);
  const rawDekA = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dekIvA }, kek, encDekA);

  if (rawDekA.byteLength !== 32) {
    throw new Error(`DEK length must be exactly 32 bytes (256-bit), got: ${rawDekA.byteLength}`);
  }

  console.log(`  -> PASSED: Envelope encryption uses AES-256-GCM and verified fresh 32-byte (256-bit) DEK.`);

  // ---------------------------------------------------------------------------
  // [Test 3] Cryptographic AAD Binding ({hospital_id, patient_id, record_id, field, kek_id})
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Cryptographic AAD Binding & Tampering Resistance...');

  // Decryption with matching AAD should succeed
  const decryptedGood = await decryptMedicalRecord(envelopeA, testKekSecret, aad1);
  if ((decryptedGood as any).clinicalNotes !== sampleData.clinicalNotes) {
    throw new Error('Decrypted clinical notes mismatch');
  }
  console.log('  -> PASSED: Decryption succeeds with identical AAD 5-tuple.');

  // Tamper Test A: Different patient_id
  const tamperedPatientAAD: MedicalRecordAAD = {
    ...aad1,
    patient_id: 'pat_attacker_666',
  };
  let tamperCaught = false;
  try {
    await decryptMedicalRecord(envelopeA, testKekSecret, tamperedPatientAAD);
  } catch (err) {
    tamperCaught = true;
  }
  if (!tamperCaught) {
    throw new Error('CRITICAL SECURITY FLAW: Decryption succeeded despite mismatched patient_id!');
  }
  console.log('  -> PASSED: Tampering patient_id was cryptographically rejected by AES-GCM tag verification.');

  // Tamper Test B: Different hospital_id
  const tamperedHospitalAAD: MedicalRecordAAD = {
    ...aad1,
    hospital_id: 'hosp_unauthorized_99',
  };
  tamperCaught = false;
  try {
    await decryptMedicalRecord(envelopeA, testKekSecret, tamperedHospitalAAD);
  } catch (err) {
    tamperCaught = true;
  }
  if (!tamperCaught) {
    throw new Error('CRITICAL SECURITY FLAW: Decryption succeeded despite mismatched hospital_id!');
  }
  console.log('  -> PASSED: Tampering hospital_id was cryptographically rejected by AES-GCM tag verification.');

  // Tamper Test C: Different record_id
  const tamperedRecordAAD: MedicalRecordAAD = {
    ...aad1,
    record_id: 'rec_forged_7777',
  };
  tamperCaught = false;
  try {
    await decryptMedicalRecord(envelopeA, testKekSecret, tamperedRecordAAD);
  } catch (err) {
    tamperCaught = true;
  }
  if (!tamperCaught) {
    throw new Error('CRITICAL SECURITY FLAW: Decryption succeeded despite mismatched record_id!');
  }
  console.log('  -> PASSED: Tampering record_id was cryptographically rejected by AES-GCM tag verification.');

  // ---------------------------------------------------------------------------
  // [Test 4] Decryption Path: Non-Extractable KEK (extractable: false)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying KEK is imported as non-extractable WebCrypto CryptoKey (extractable: false)...');
  const nonExtractableKek = await importKek(testKekSecret, ['decrypt']);

  if (nonExtractableKek.extractable !== false) {
    throw new Error('CRITICAL SECURITY FLAW: KEK CryptoKey was imported with extractable: true!');
  }

  // Attempt to export key must fail
  let exportPrevented = false;
  try {
    await crypto.subtle.exportKey('raw', nonExtractableKek);
  } catch (err) {
    exportPrevented = true;
  }
  if (!exportPrevented) {
    throw new Error('CRITICAL SECURITY FLAW: Non-extractable KEK was exported from memory!');
  }
  console.log('  -> PASSED: KEK CryptoKey is extractable: false. WebCrypto rejected key export.');

  // ---------------------------------------------------------------------------
  // [Test 5] Network Isolation: Records Worker Has No Public Internet Routes
  // ---------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying Private Records Worker Service Binding & zero public routes...');
  const recordsWranglerPath = path.join(rootDir, 'workers/records/wrangler.toml');
  const recordsWrangler = fs.readFileSync(recordsWranglerPath, 'utf8');

  if (recordsWrangler.includes('routes =') || recordsWrangler.includes('custom_domain = true')) {
    throw new Error('CRITICAL FLAW: records Worker has a public route defined in wrangler.toml!');
  }

  const apiWranglerPath = path.join(rootDir, 'workers/api/wrangler.toml');
  const apiWrangler = fs.readFileSync(apiWranglerPath, 'utf8');

  if (!apiWrangler.includes('service = "doctorcare-records"') || !apiWrangler.includes('RECORDS_SERVICE')) {
    throw new Error('api Worker missing RECORDS_SERVICE binding to doctorcare-records');
  }

  console.log('  -> PASSED: records Worker has NO public internet route in wrangler.toml.');
  console.log('  -> PASSED: api Worker exposes RECORDS_SERVICE private Service Binding.');

  // ---------------------------------------------------------------------------
  // [Test 6] Cloudflare R2 Bucket for Patient Files: 5-Minute Presigned PUT URLs
  // ---------------------------------------------------------------------------
  console.log('\n[Test 6] Verifying R2 Bucket Presigned PUT URLs with strict 5-minute expiry...');
  if (!recordsWrangler.includes('doctorcare-patient-files') || !recordsWrangler.includes('PATIENT_FILES_BUCKET')) {
    throw new Error('PATIENT_FILES_BUCKET binding missing in workers/records/wrangler.toml');
  }

  const presignedResult = await generateR2PresignedPutUrl({
    bucketName: 'doctorcare-patient-files',
    accountId: 'acc_cf_prod_123',
    accessKeyId: 'r2_access_key_abc',
    secretAccessKey: 'r2_secret_key_xyz',
    fileExtension: 'pdf',
    contentType: 'application/pdf',
  });

  if (presignedResult.expiresInSeconds !== 300) {
    throw new Error(`Presigned URL expiry must be 300 seconds (5 min), got ${presignedResult.expiresInSeconds}`);
  }

  const expectedKeyPattern = /^raw\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
  if (!expectedKeyPattern.test(presignedResult.objectKey)) {
    throw new Error(`Object key does not match random UUID pattern: ${presignedResult.objectKey}`);
  }

  if (!presignedResult.uploadUrl.includes('X-Amz-Expires=300')) {
    throw new Error('Presigned URL missing X-Amz-Expires=300 query parameter');
  }

  if (!presignedResult.uploadUrl.includes('X-Amz-Signature=')) {
    throw new Error('Presigned URL missing X-Amz-Signature query parameter');
  }

  console.log(`  -> PASSED: R2 Bucket binding PATIENT_FILES_BUCKET verified.`);
  console.log(`  -> PASSED: Presigned PUT URL generated with strict 300s expiry (${presignedResult.expiresAt}).`);
  console.log(`  -> PASSED: Cryptographically random object key verified: ${presignedResult.objectKey}`);

  // ---------------------------------------------------------------------------
  // [Test 7] Server-Side File Validation Middleware (Magic Bytes)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 7] Testing Server-Side File Validation Middleware (Magic Bytes)...');

  // Case A: Valid %PDF-
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
  const pdfValidation = validateFileMagicBytes(pdfBytes, 'application/pdf');
  if (!pdfValidation.valid || pdfValidation.detectedExtension !== 'pdf') {
    throw new Error(`PDF validation failed: ${pdfValidation.error}`);
  }
  console.log(`  -> PASSED: Valid PDF magic bytes (%PDF-) detected (${pdfValidation.magicBytesHex}).`);

  // Case B: Valid DICOM with 128-byte preamble + DICM
  const dicomBytes = new Uint8Array(132);
  // Preamble 0..127 zeroes
  dicomBytes[128] = 0x44; // D
  dicomBytes[129] = 0x49; // I
  dicomBytes[130] = 0x43; // C
  dicomBytes[131] = 0x4d; // M
  const dicomValidation = validateFileMagicBytes(dicomBytes, 'application/dicom');
  if (!dicomValidation.valid || dicomValidation.detectedMimeType !== 'application/dicom') {
    throw new Error(`DICOM validation failed: ${dicomValidation.error}`);
  }
  console.log(`  -> PASSED: Valid DICOM medical scan magic bytes (DICM at offset 128) detected.`);

  // Case C: Valid JPEG
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const jpegValidation = validateFileMagicBytes(jpegBytes, 'image/jpeg');
  if (!jpegValidation.valid || jpegValidation.detectedExtension !== 'jpg') {
    throw new Error(`JPEG validation failed: ${jpegValidation.error}`);
  }
  console.log(`  -> PASSED: Valid JPEG image magic bytes detected.`);

  // Case D: Valid PNG
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const pngValidation = validateFileMagicBytes(pngBytes, 'image/png');
  if (!pngValidation.valid || pngValidation.detectedExtension !== 'png') {
    throw new Error(`PNG validation failed: ${pngValidation.error}`);
  }
  console.log(`  -> PASSED: Valid PNG medical scan magic bytes detected.`);

  // Case E: Malicious executable disguised as PDF (MZ Header)
  const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ PE
  const exeValidation = validateFileMagicBytes(exeBytes, 'application/pdf');
  if (exeValidation.valid) {
    throw new Error('CRITICAL FLAW: Executable was accepted as valid PDF!');
  }
  console.log(`  -> PASSED: Malicious PE executable rejected: "${exeValidation.error}"`);

  // Case F: HTML/Script disguised as PDF
  const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><script>alert(1)</script>');
  const htmlValidation = validateFileMagicBytes(htmlBytes, 'application/pdf');
  if (htmlValidation.valid) {
    throw new Error('CRITICAL FLAW: HTML script was accepted as valid PDF!');
  }
  console.log(`  -> PASSED: Malicious HTML/script rejected: "${htmlValidation.error}"`);

  // ---------------------------------------------------------------------------
  // [Test 8] Records Worker HTTP Endpoints (Full Flow)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 8] Testing Records Worker HTTP Handlers...');
  const mockEnv: RecordsEnv = {
    ENVIRONMENT: 'production',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_B_ID: 'doctorcare-medical-records-prod',
    APPWRITE_PROJECT_B_KEY: 'mock_project_b_key',
    KEK_2026_09: testKekSecret,
  };

  // Health check
  const healthReq = new Request('https://records.internal/api/v1/records/health');
  const healthRes = await recordsWorker.fetch(healthReq, mockEnv, {} as any);
  const healthData = (await healthRes.json()) as any;
  if (!healthData.kekBound || healthData.kekName !== 'kek-2026-09') {
    throw new Error('Records worker health check failed');
  }
  console.log('  -> PASSED: Records worker health check confirmed KEK binding.');

  // Upload URL generation endpoint
  const uploadUrlReq = new Request('https://records.internal/api/v1/records/files/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_extension: 'pdf', content_type: 'application/pdf' }),
  });
  const uploadUrlRes = await recordsWorker.fetch(uploadUrlReq, mockEnv, {} as any);
  const uploadUrlData = (await uploadUrlRes.json()) as any;
  if (uploadUrlRes.status !== 200 || uploadUrlData.data.expiresInSeconds !== 300) {
    throw new Error('Upload URL endpoint failed');
  }
  console.log('  -> PASSED: Records worker /upload-url returned 300s presigned URL.');

  // File validate endpoint (PDF bytes)
  const base64Pdf = btoa(String.fromCharCode(...pdfBytes));
  const validateReq = new Request('https://records.internal/api/v1/records/files/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_base64: base64Pdf, declared_mime_type: 'application/pdf' }),
  });
  const validateRes = await recordsWorker.fetch(validateReq, mockEnv, {} as any);
  const validateData = (await validateRes.json()) as any;
  if (validateRes.status !== 200 || !validateData.validation.valid) {
    throw new Error('File validation endpoint failed');
  }
  console.log('  -> PASSED: Records worker /validate correctly verified PDF magic bytes.');

  console.log('\n================================================================');
  console.log('   ALL MEDICAL RECORDS, ENVELOPE ENCRYPTION, R2 & AAD TESTS PASSED! ');
  console.log('================================================================\n');
}

runRecordsAndR2Verification().catch((err) => {
  console.error('[FATAL TEST FAILURE]:', err);
  process.exit(1);
});

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Import all API worker Zod schemas to verify .strict() enforcement
import {
  HoldSlotSchema,
  ConfirmSlotSchema,
  ReleaseSlotSchema,
  TokenExchangeSchema,
  RefreshTokenSchema,
  MfaVerifySchema,
  CreateHospitalSchema,
  CreateDepartmentSchema,
  CreateDoctorSchema,
  CreateRoomSchema,
  CreateAppointmentSchema,
  CreatePaymentOrderSchema,
  GrantConsentSchema,
  WithdrawConsentSchema,
  CreateMedicalRecordSchema,
  GenerateUploadUrlSchema,
  ValidateFileSchema,
} from '../workers/api/src/schemas/index';

console.log('================================================================');
console.log('   RUNNING FINAL COMPREHENSIVE REPOSITORY & ARCHITECTURE AUDIT  ');
console.log('================================================================\n');

async function runFinalValidation() {
  const rootDir = process.cwd();

  // -------------------------------------------------------------------------
  // Part 1: Comprehensive Configuration Files Validation
  // -------------------------------------------------------------------------
  console.log('[Part 1] Validating all Cloudflare Wrangler & Infrastructure configurations...');

  // 1.1 API Worker Wrangler Config
  const apiWranglerPath = path.join(rootDir, 'workers', 'api', 'wrangler.toml');
  assert.ok(fs.existsSync(apiWranglerPath), 'workers/api/wrangler.toml must exist');
  const apiWrangler = fs.readFileSync(apiWranglerPath, 'utf8');

  assert.ok(apiWrangler.includes('name = "doctorcare-api"'), 'API worker name must be doctorcare-api');
  assert.ok(apiWrangler.includes('pattern = "api.yourhospital.com"'), 'Must configure api.yourhospital.com custom domain');
  assert.ok(apiWrangler.includes('binding = "RECORDS_SERVICE"'), 'Must configure RECORDS_SERVICE binding');
  assert.ok(apiWrangler.includes('binding = "NOTIFY_SERVICE"'), 'Must configure NOTIFY_SERVICE binding');
  assert.ok(apiWrangler.includes('name = "SessionDurableObject"'), 'Must bind SessionDurableObject');
  assert.ok(apiWrangler.includes('name = "SlotDurableObject"'), 'Must bind SlotDurableObject');
  assert.ok(apiWrangler.includes('name = "RateLimiterDurableObject"'), 'Must bind RateLimiterDurableObject');
  assert.ok(apiWrangler.includes('API_RATE_LIMITER'), 'Must configure API_RATE_LIMITER');
  assert.ok(apiWrangler.includes('AUTH_RATE_LIMITER'), 'Must configure AUTH_RATE_LIMITER');
  assert.ok(apiWrangler.includes('binding = "TASK_QUEUE"'), 'Must configure TASK_QUEUE producer');
  console.log('  ✓ Verified workers/api/wrangler.toml (Custom domain, Service Bindings, 3 DOs, RateLimiters, Queues)');

  // 1.2 Records Worker Wrangler Config
  const recordsWranglerPath = path.join(rootDir, 'workers', 'records', 'wrangler.toml');
  assert.ok(fs.existsSync(recordsWranglerPath), 'workers/records/wrangler.toml must exist');
  const recordsWrangler = fs.readFileSync(recordsWranglerPath, 'utf8');

  assert.ok(recordsWrangler.includes('name = "doctorcare-records"'), 'Records worker name must be doctorcare-records');
  assert.ok(recordsWrangler.includes('binding = "KEK_2026_09"'), 'Must bind KEK_2026_09');
  assert.ok(recordsWrangler.includes('secret_name = "kek-2026-09"'), 'Must bind Secrets Store secret kek-2026-09');
  assert.ok(recordsWrangler.includes('binding = "PATIENT_FILES_BUCKET"'), 'Must bind PATIENT_FILES_BUCKET');
  assert.ok(recordsWrangler.includes('bucket_name = "doctorcare-patient-files"'), 'Must target doctorcare-patient-files');
  assert.ok(recordsWrangler.includes('binding = "AUDIT_VAULT_BUCKET"'), 'Must bind AUDIT_VAULT_BUCKET');
  assert.ok(recordsWrangler.includes('bucket_name = "doctorcare-audit-vault"'), 'Must target doctorcare-audit-vault');
  assert.ok(!recordsWrangler.includes('routes ='), 'Records worker must have NO public routes (private isolation)');
  console.log('  ✓ Verified workers/records/wrangler.toml (Secrets Store KEK, Patient R2, Write-Only Audit R2, Zero Public Route)');

  // 1.3 Notify Worker Wrangler Config
  const notifyWranglerPath = path.join(rootDir, 'workers', 'notify', 'wrangler.toml');
  assert.ok(fs.existsSync(notifyWranglerPath), 'workers/notify/wrangler.toml must exist');
  const notifyWrangler = fs.readFileSync(notifyWranglerPath, 'utf8');

  assert.ok(notifyWrangler.includes('name = "doctorcare-notify"'), 'Notify worker name must be doctorcare-notify');
  assert.ok(notifyWrangler.includes('queue = "doctorcare-tasks"'), 'Must consume doctorcare-tasks queue');
  assert.ok(notifyWrangler.includes('dead_letter_queue = "doctorcare-tasks-dlq"'), 'Must designate dead_letter_queue');
  assert.ok(!notifyWrangler.includes('KEK'), 'Notify worker must have ZERO access to KEK');
  assert.ok(!notifyWrangler.includes('medical_records'), 'Notify worker must have ZERO access to medical records');
  console.log('  ✓ Verified workers/notify/wrangler.toml (Queue consumer, DLQ, credential isolation)');

  // 1.4 Web App Wrangler & OpenNext Config
  const webWranglerPath = path.join(rootDir, 'apps', 'web', 'wrangler.toml');
  assert.ok(fs.existsSync(webWranglerPath), 'apps/web/wrangler.toml must exist');
  const webWrangler = fs.readFileSync(webWranglerPath, 'utf8');

  assert.ok(webWrangler.includes('.open-next/worker.js'), 'Web worker must target .open-next/worker.js');
  assert.ok(webWrangler.includes('nodejs_compat'), 'Must enable nodejs_compat');
  assert.ok(webWrangler.includes('binding = "ASSETS"'), 'Must configure ASSETS binding');
  assert.ok(webWrangler.includes('binding = "API_SERVICE"'), 'Must bind API_SERVICE to doctorcare-api');

  const openNextConfigPath = path.join(rootDir, 'apps', 'web', 'open-next.config.ts');
  assert.ok(fs.existsSync(openNextConfigPath), 'open-next.config.ts must exist');
  const openNextContent = fs.readFileSync(openNextConfigPath, 'utf8');
  assert.ok(openNextContent.includes('defineCloudflareConfig'), 'Must use defineCloudflareConfig');
  console.log('  ✓ Verified apps/web/wrangler.toml and open-next.config.ts (@opennextjs/cloudflare integration)');

  // 1.5 Appwrite Infrastructure Declarative Config
  const appwriteConfigPath = path.join(rootDir, 'infra', 'appwrite', 'appwrite.config.json');
  assert.ok(fs.existsSync(appwriteConfigPath), 'infra/appwrite/appwrite.config.json must exist');
  const appwriteConfig = JSON.parse(fs.readFileSync(appwriteConfigPath, 'utf8'));

  assert.strictEqual(appwriteConfig.projectA.projectId, 'doctorcare-operational-prod');
  assert.strictEqual(appwriteConfig.projectB.projectId, 'doctorcare-medical-records-prod');

  const projACollections = appwriteConfig.projectA.databases[0].collections.map((c: any) => c.id);
  assert.ok(projACollections.includes('HOSPITAL'));
  assert.ok(projACollections.includes('DEPARTMENT'));
  assert.ok(projACollections.includes('DOCTOR'));
  assert.ok(projACollections.includes('ROOM'));
  assert.ok(projACollections.includes('AVAILABILITY_SLOT'));
  assert.ok(projACollections.includes('BOOKING'));
  assert.ok(projACollections.includes('WEBHOOK_EVENT'));
  assert.ok(projACollections.includes('CONSENT_LOG'));

  const projBCollections = appwriteConfig.projectB.databases[0].collections.map((c: any) => c.id);
  assert.ok(projBCollections.includes('patient_charts'));
  assert.ok(projBCollections.includes('MEDICAL_RECORD'));
  assert.ok(projBCollections.includes('RECORD_ACCESS_LOG'));
  console.log('  ✓ Verified infra/appwrite/appwrite.config.json (Project A & B dual isolation, 11 total collections)');

  // 1.6 Cloudflare Zone WAF & Rate Limiting Rulesets
  const wafConfigPath = path.join(rootDir, 'infra', 'cloudflare', 'waf-rulesets.json');
  assert.ok(fs.existsSync(wafConfigPath), 'infra/cloudflare/waf-rulesets.json must exist');
  const wafConfig = JSON.parse(fs.readFileSync(wafConfigPath, 'utf8'));

  assert.strictEqual(wafConfig.rulesets.length, 2, 'Must configure 2 managed rulesets');
  assert.ok(wafConfig.rulesets.some((r: any) => r.name.includes('Cloudflare Managed')), 'Must include Cloudflare Managed');
  assert.ok(wafConfig.rulesets.some((r: any) => r.name.includes('OWASP Core')), 'Must include OWASP Core');
  assert.strictEqual(wafConfig.rate_limiting_phase, 'http_ratelimit');
  assert.strictEqual(wafConfig.rate_limiting_rules.length, 3, 'Must define 3 Zone WAF rate limiting rules');
  console.log('  ✓ Verified infra/cloudflare/waf-rulesets.json (Cloudflare Managed, OWASP CRS, Layer 1 WAF Rate Limiting)');

  // 1.7 Cloudflare D1 Dual Database & Drizzle ORM Schema Validation
  const opsSchemaPath = path.join(rootDir, 'packages', 'shared', 'src', 'db', 'schema-ops.ts');
  const recordsSchemaPath = path.join(rootDir, 'packages', 'shared', 'src', 'db', 'schema-records.ts');
  const opsMigrationPath = path.join(rootDir, 'infra', 'd1', 'migrations', '0001_ops_schema.sql');
  const recordsMigrationPath = path.join(rootDir, 'infra', 'd1', 'migrations', '0002_records_schema.sql');

  assert.ok(fs.existsSync(opsSchemaPath), 'schema-ops.ts must exist');
  assert.ok(fs.existsSync(recordsSchemaPath), 'schema-records.ts must exist');
  assert.ok(fs.existsSync(opsMigrationPath), '0001_ops_schema.sql must exist');
  assert.ok(fs.existsSync(recordsMigrationPath), '0002_records_schema.sql must exist');

  const recordsSchemaContent = fs.readFileSync(recordsSchemaPath, 'utf8');
  assert.ok(apiWrangler.includes('database_name = "doctorcare-ops-db"'), 'API worker must bind doctorcare-ops-db');
  assert.ok(recordsWrangler.includes('database_name = "doctorcare-records-db"'), 'Records worker must bind doctorcare-records-db');
  assert.ok(!apiWrangler.includes('doctorcare-records-db'), 'API worker must NEVER bind doctorcare-records-db directly');
  assert.ok(recordsSchemaContent.includes('export const medicalRecord = sqliteTable'), 'Must define medicalRecord table in records schema');
  assert.ok(recordsSchemaContent.includes('envelope'), 'medicalRecord must store ciphertext envelope');
  assert.ok(recordsSchemaContent.includes('kekId'), 'medicalRecord must record kekId');
  assert.ok(recordsSchemaContent.includes('retentionUntil'), 'medicalRecord must record retentionUntil');
  console.log('  ✓ Verified Cloudflare D1 & Drizzle schemas (doctorcare-ops-db & doctorcare-records-db physical boundary)');

  // -------------------------------------------------------------------------
  // Part 2: Strict Zod Request Schema Validation
  // -------------------------------------------------------------------------
  console.log('\n[Part 2] Validating all Zod request schemas (.strict() enforcement)...');

  const schemasToAudit = [
    {
      name: 'HoldSlotSchema',
      schema: HoldSlotSchema,
      validPayload: {
        doctor_id: 'doc_suresh_01',
        start_time_utc: '2026-09-19T09:00:00.000Z',
        end_time_utc: '2026-09-19T09:30:00.000Z',
        patient_id: 'pat_test_01',
        idempotency_key: 'idemp_test_01',
      },
    },
    {
      name: 'ConfirmSlotSchema',
      schema: ConfirmSlotSchema,
      validPayload: {
        slot_key: 'doc_suresh_01:2026-09-19T09:00:00Z',
        idempotency_key: 'idemp_test_01',
      },
    },
    {
      name: 'ReleaseSlotSchema',
      schema: ReleaseSlotSchema,
      validPayload: {
        slot_key: 'doc_suresh_01:2026-09-19T09:00:00Z',
        idempotency_key: 'idemp_test_01',
      },
    },
    {
      name: 'TokenExchangeSchema',
      schema: TokenExchangeSchema,
      validPayload: {
        jwt: 'mock_jwt_token_payload_xyz',
      },
    },
    {
      name: 'RefreshTokenSchema',
      schema: RefreshTokenSchema,
      validPayload: {
        refreshToken: 'rft_sample_refresh_token_01',
        userId: 'usr_sample_user_01',
      },
    },
    {
      name: 'MfaVerifySchema',
      schema: MfaVerifySchema,
      validPayload: {
        factor: 'totp',
        code: '123456',
        sessionId: 'sess_123456',
      },
    },
    {
      name: 'CreateHospitalSchema',
      schema: CreateHospitalSchema,
      validPayload: {
        name: 'Apex Super Specialty Hospital',
        address: '100 Medical Road, Mumbai',
        phone: '+912212345678',
        timezone: 'Asia/Kolkata',
      },
    },
    {
      name: 'CreateDepartmentSchema',
      schema: CreateDepartmentSchema,
      validPayload: {
        hospital_id: 'hosp_mumbai_01',
        name: 'Interventional Cardiology',
        description: 'Comprehensive adult and pediatric cardiac care',
      },
    },
    {
      name: 'CreateDoctorSchema',
      schema: CreateDoctorSchema,
      validPayload: {
        hospital_id: 'hosp_mumbai_01',
        department_id: 'dept_cardio_01',
        name: 'Dr. Suresh R. Nair',
        email: 'suresh.nair@apex.org',
        specialty: 'Cardiology',
        active: true,
      },
    },
    {
      name: 'CreateRoomSchema',
      schema: CreateRoomSchema,
      validPayload: {
        hospital_id: 'hosp_mumbai_01',
        department_id: 'dept_cardio_01',
        room_number: 'Room 304',
        floor: 3,
        status: 'AVAILABLE',
      },
    },
    {
      name: 'CreateAppointmentSchema',
      schema: CreateAppointmentSchema,
      validPayload: {
        patientId: 'pat_test_01',
        doctorId: 'doc_suresh_01',
        clinicId: 'clinic_01',
        scheduledAt: '2026-09-19T09:00:00.000Z',
        status: 'SCHEDULED',
        notes: 'Follow-up consultation post PTCA',
      },
    },
    {
      name: 'CreatePaymentOrderSchema',
      schema: CreatePaymentOrderSchema,
      validPayload: {
        doctor_id: 'doc_suresh_01',
        slot_key: 'doc_suresh_01:2026-09-19T09:00:00Z',
        patient_id: 'pat_test_01',
        consultation_type: 'SPECIALIST',
      },
    },
    {
      name: 'GrantConsentSchema',
      schema: GrantConsentSchema,
      validPayload: {
        patient_id: 'pat_test_01',
        purpose: 'WHATSAPP_CONFIRMATIONS',
        notice_version: 'v2026.09.1',
        language: 'en',
      },
    },
    {
      name: 'WithdrawConsentSchema',
      schema: WithdrawConsentSchema,
      validPayload: {
        patient_id: 'pat_test_01',
        purpose: 'WHATSAPP_CONFIRMATIONS',
      },
    },
    {
      name: 'CreateMedicalRecordSchema',
      schema: CreateMedicalRecordSchema,
      validPayload: {
        patient_id: 'pat_test_01',
        hospital_id: 'hosp_mumbai_01',
        record_class: 'EHR_NOTE',
        clinical_data: { diagnosis: 'Hypertension Stage 1' },
      },
    },
    {
      name: 'GenerateUploadUrlSchema',
      schema: GenerateUploadUrlSchema,
      validPayload: {
        patient_id: 'pat_test_01',
        file_name: 'scan_report.pdf',
        content_type: 'application/pdf',
      },
    },
    {
      name: 'ValidateFileSchema',
      schema: ValidateFileSchema,
      validPayload: {
        declared_mime_type: 'application/pdf',
        object_key: 'uploads/patient/file_123.pdf',
      },
    },
  ];

  for (const item of schemasToAudit) {
    // 1. Valid payload must pass
    const validResult = item.schema.safeParse(item.validPayload);
    assert.strictEqual(validResult.success, true, `${item.name} must accept valid payload`);

    // 2. Extraneous property injection must fail under .strict()
    const tamperedPayload = {
      ...item.validPayload,
      __injected_malicious_field: 'unauthorized_parameter_pollution',
      client_manipulated_amount: 1, // Common price manipulation attack vector
    };
    const tamperedResult = item.schema.safeParse(tamperedPayload);
    assert.strictEqual(tamperedResult.success, false, `${item.name} must reject extraneous fields (.strict() required)`);

    const hasUnrecognizedKeys = tamperedResult.error.issues.some((issue) => issue.code === 'unrecognized_keys');
    assert.strictEqual(
      hasUnrecognizedKeys,
      true,
      `${item.name} must fail with 'unrecognized_keys' issue code when extraneous fields are present`
    );

    console.log(`  ✓ Schema ${item.name.padEnd(26)} enforced .strict() (rejected unauthorized parameter pollution)`);
  }

  console.log('\n================================================================');
  console.log('   FINAL COMPREHENSIVE REPOSITORY AUDIT PASSED (ALL CHECKS OK)! ');
  console.log('================================================================\n');
}

runFinalValidation().catch((err) => {
  console.error('Final validation failed:', err);
  process.exit(1);
});

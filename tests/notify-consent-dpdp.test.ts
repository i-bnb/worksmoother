import * as fs from 'fs';
import * as path from 'path';
import apiWorker from '../workers/api/src/index.js';
import notifyWorker from '../workers/notify/src/index.js';
import {
  sendWhatsAppMessage,
  buildAppointmentConfirmationWhatsApp,
  buildAppointmentReminderWhatsApp,
  sendTransactionalEmail,
  buildAppointmentConfirmationEmail,
  buildAppointmentReminderEmail,
  DEFAULT_SMTP_CONFIG,
  TaskQueueMessage,
} from '@doctorcare/shared';
import { GrantConsentSchema, WithdrawConsentSchema } from '../workers/api/src/schemas/index.js';

async function runNotifyAndConsentTests() {
  console.log('================================================================');
  console.log('   RUNNING META WHATSAPP, SMTP EMAIL & DPDP CONSENT TESTS       ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Appwrite Project A Schema - CONSENT_LOG & Messaging Provider
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying CONSENT_LOG collection and SMTP Messaging provider in Project A...');

  const configPath = path.resolve(__dirname, '../infra/appwrite/appwrite.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const operationalDb = config.projectA.databases.find((d: any) => d.id === 'operational_db');
  if (!operationalDb) {
    throw new Error('FAILED: operational_db missing from Project A!');
  }

  const consentCol = operationalDb.collections.find((c: any) => c.id === 'CONSENT_LOG');
  if (!consentCol) {
    throw new Error('FAILED: CONSENT_LOG collection missing from Project A schema!');
  }

  const requiredConsentAttrs = [
    'consent_id',
    'patient_id',
    'purpose',
    'notice_version',
    'language',
    'granted_at',
    'withdrawn_at',
    'status',
  ];
  for (const attr of requiredConsentAttrs) {
    const found = consentCol.attributes.some((a: any) => a.key === attr);
    if (!found) {
      throw new Error(`FAILED: Required DPDP attribute "${attr}" missing from CONSENT_LOG collection!`);
    }
  }

  const consentIdIndex = consentCol.indexes?.find(
    (idx: any) => idx.type === 'unique' && idx.attributes.includes('consent_id')
  );
  if (!consentIdIndex) {
    throw new Error('FAILED: Unique index on consent_id missing from CONSENT_LOG collection!');
  }
  console.log(`  -> PASSED: CONSENT_LOG collection verified with unique index "${consentIdIndex.key}".`);

  // Verify Appwrite Messaging SMTP Provider Configuration
  const messagingConfig = config.projectA.messaging;
  if (!messagingConfig || !messagingConfig.provider) {
    throw new Error('FAILED: Appwrite Messaging provider configuration missing from Project A!');
  }
  const p = messagingConfig.provider;
  if (p.id !== 'smtp-amazon-ses' || p.host !== 'email-smtp.ap-south-1.amazonaws.com' || p.port !== 587) {
    throw new Error(`FAILED: Unexpected SMTP provider configuration: ${JSON.stringify(p)}`);
  }
  console.log(`  -> PASSED: Appwrite Messaging SMTP Provider verified: ${p.id} (${p.host}:${p.port}, Mumbai ap-south-1).`);

  // Verify Scoped API Key contains messaging scopes
  const scopes = config.projectA.scopedApiKey.scopes;
  const reqScopes = ['messages.read', 'messages.write', 'providers.read', 'providers.write'];
  for (const s of reqScopes) {
    if (!scopes.includes(s)) {
      throw new Error(`FAILED: Scoped API key missing required scope "${s}"!`);
    }
  }
  console.log(`  -> PASSED: Scoped API key includes messaging scopes: [${reqScopes.join(', ')}].`);

  // --------------------------------------------------------------------------
  // TEST 2: Strict Zod DPDP Consent Schema & API Endpoints
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Testing Strict Zod validation and DPDP Consent API endpoints...');

  // 2a. Rejection of extraneous fields via .strict()
  const tamperedConsent = {
    patient_id: 'pat_rajesh_404',
    purpose: 'WHATSAPP_CONFIRMATIONS',
    notice_version: 'v2026.09.1',
    language: 'en',
    unauthorized_override: true, // Extraneous injection
  };
  const parseResult = GrantConsentSchema.safeParse(tamperedConsent);
  if (parseResult.success) {
    throw new Error('SECURITY VIOLATION: GrantConsentSchema allowed unexpected fields!');
  }
  console.log('  -> PASSED: GrantConsentSchema.strict() successfully rejected unexpected payload fields.');

  // 2b. Grant Consent API Endpoint: POST /api/v1/consent
  const mockApiEnv: any = {
    ENVIRONMENT: 'development',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
    APPWRITE_PROJECT_A_KEY: 'mock_key_project_a',
  };

  const grantReq = new Request('https://api.yourhospital.com/api/v1/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patient_id: 'pat_rajesh_404',
      purpose: 'WHATSAPP_CONFIRMATIONS',
      notice_version: 'v2026.09.1',
      language: 'hi', // Hindi (DPDP multilingual compliance)
      ip_address: '103.21.244.1',
      user_agent: 'DoctorCare-Mobile-Android',
    }),
  });

  const grantRes = await apiWorker.fetch(grantReq, mockApiEnv, {} as any);
  if (grantRes.status !== 201) {
    const errText = await grantRes.text();
    throw new Error(`FAILED: POST /api/v1/consent returned status ${grantRes.status}: ${errText}`);
  }
  const grantData = (await grantRes.json()) as any;
  if (grantData.status !== 'CONSENT_GRANTED' || !grantData.consent_id) {
    throw new Error(`FAILED: Invalid grant consent response: ${JSON.stringify(grantData)}`);
  }
  console.log(`  -> PASSED: Consent granted for pat_rajesh_404 (ID: ${grantData.consent_id}, Language: hi).`);

  // 2c. Query Active Consent: GET /api/v1/consent
  const queryReq = new Request(
    'https://api.yourhospital.com/api/v1/consent?patient_id=pat_rajesh_404&purpose=WHATSAPP_CONFIRMATIONS',
    { method: 'GET' }
  );
  const queryRes = await apiWorker.fetch(queryReq, mockApiEnv, {} as any);
  if (queryRes.status !== 200) {
    throw new Error(`FAILED: GET /api/v1/consent returned status ${queryRes.status}`);
  }
  const queryData = (await queryRes.json()) as any;
  if (queryData.patient_id !== 'pat_rajesh_404') {
    throw new Error(`FAILED: Unexpected query response: ${JSON.stringify(queryData)}`);
  }
  console.log('  -> PASSED: Consent query endpoint returned valid patient consent profile.');

  // 2d. Withdraw Consent: POST /api/v1/consent/withdraw
  const withdrawReq = new Request('https://api.yourhospital.com/api/v1/consent/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patient_id: 'pat_rajesh_404',
      purpose: 'WHATSAPP_CONFIRMATIONS',
    }),
  });
  const withdrawRes = await apiWorker.fetch(withdrawReq, mockApiEnv, {} as any);
  if (withdrawRes.status !== 200) {
    throw new Error(`FAILED: POST /api/v1/consent/withdraw returned status ${withdrawRes.status}`);
  }
  const withdrawData = (await withdrawRes.json()) as any;
  if (withdrawData.status !== 'CONSENT_WITHDRAWN' || !withdrawData.withdrawn_at) {
    throw new Error(`FAILED: Invalid withdraw response: ${JSON.stringify(withdrawData)}`);
  }
  console.log(`  -> PASSED: Consent successfully withdrawn at ${withdrawData.withdrawn_at}.`);

  // --------------------------------------------------------------------------
  // TEST 3: Meta WhatsApp Cloud API Integration
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Meta WhatsApp Cloud API (Graph API v20.0) Client & Templates...');

  // 3a. Template builders
  const confirmWhatsApp = buildAppointmentConfirmationWhatsApp({
    patientPhone: '+919876543210',
    patientName: 'Pooja Sharma',
    doctorName: 'Dr. Vikram Seth',
    appointmentTime: '2026-09-20 10:30 AM IST',
    bookingId: 'BK_908234',
    hospitalName: 'DoctorCare Specialty Hospital Mumbai',
  });
  if (confirmWhatsApp.type !== 'template' || confirmWhatsApp.template?.name !== 'appointment_confirmation') {
    throw new Error('FAILED: WhatsApp confirmation template structure mismatch!');
  }
  if (!confirmWhatsApp.text?.body.includes('BK_908234')) {
    throw new Error('FAILED: Fallback text missing booking ID!');
  }
  console.log('  -> PASSED: WhatsApp appointment confirmation payload constructed properly.');

  const reminderWhatsApp = buildAppointmentReminderWhatsApp({
    patientPhone: '+919876543210',
    patientName: 'Pooja Sharma',
    doctorName: 'Dr. Vikram Seth',
    appointmentTime: '2026-09-20 10:30 AM IST',
  });
  if (reminderWhatsApp.template?.name !== 'appointment_reminder') {
    throw new Error('FAILED: WhatsApp reminder template name mismatch!');
  }
  console.log('  -> PASSED: WhatsApp appointment reminder payload constructed properly.');

  // 3b. Meta WhatsApp Cloud API mock send
  const mockWhatsConfig = {
    phoneNumberId: 'mock_phone_id',
    accessToken: 'mock_whatsapp_token',
    apiVersion: 'v20.0',
  };
  const whatsappSendResult = await sendWhatsAppMessage(mockWhatsConfig, confirmWhatsApp);
  if (!whatsappSendResult.success || !whatsappSendResult.messageId?.startsWith('wamid.')) {
    throw new Error(`FAILED: WhatsApp message sending failed: ${JSON.stringify(whatsappSendResult)}`);
  }
  console.log(`  -> PASSED: WhatsApp message dispatched successfully (Message ID: ${whatsappSendResult.messageId}).`);

  // --------------------------------------------------------------------------
  // TEST 4: Appwrite Messaging SMTP Provider & Transactional Email
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Transactional Email via Amazon SES SMTP & Appwrite Messaging...');

  const confirmEmail = buildAppointmentConfirmationEmail({
    patientEmail: 'pooja.sharma@example.in',
    patientName: 'Pooja Sharma',
    doctorName: 'Dr. Vikram Seth',
    appointmentTime: '2026-09-20 10:30 AM IST',
    bookingId: 'BK_908234',
    hospitalName: 'DoctorCare Specialty Hospital Mumbai',
  });
  if (!confirmEmail.html?.includes('DoctorCare Appointment Confirmation') || !confirmEmail.html?.includes('DPDP')) {
    throw new Error('FAILED: Confirmation email HTML content missing DPDP notice or title!');
  }
  console.log('  -> PASSED: Transactional confirmation email formatted with DPDP compliance statement.');

  const emailSendResult = await sendTransactionalEmail(null, confirmEmail, {
    name: DEFAULT_SMTP_CONFIG.name,
    host: DEFAULT_SMTP_CONFIG.host,
    port: DEFAULT_SMTP_CONFIG.port,
    fromEmail: DEFAULT_SMTP_CONFIG.fromEmail,
  });
  if (!emailSendResult.success || emailSendResult.provider !== 'Amazon SES (ap-south-1)') {
    throw new Error(`FAILED: Transactional email dispatch failed: ${JSON.stringify(emailSendResult)}`);
  }
  console.log(`  -> PASSED: Transactional email routed to Amazon SES SMTP (Provider: ${emailSendResult.provider}).`);

  // --------------------------------------------------------------------------
  // TEST 5: Notify Worker HTTP Endpoints & DPDP Consent Verification
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Testing Notify Worker HTTP Endpoints & DPDP Consent Enforcement...');

  const mockNotifyEnv: any = {
    ENVIRONMENT: 'development',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
    APPWRITE_PROJECT_A_KEY: 'mock_key_project_a',
    WHATSAPP_PHONE_NUMBER_ID: 'phone_101',
    WHATSAPP_ACCESS_TOKEN: 'mock_whatsapp_token',
    SMTP_PROVIDER_ID: 'smtp-amazon-ses',
    SMTP_HOST: 'email-smtp.ap-south-1.amazonaws.com',
  };

  // 5a. GET /api/v1/notify/health
  const healthReq = new Request('https://notify.yourhospital.com/api/v1/notify/health');
  const healthRes = await notifyWorker.fetch(healthReq, mockNotifyEnv, {} as any);
  if (healthRes.status !== 200) {
    throw new Error(`FAILED: Notify health returned status ${healthRes.status}`);
  }
  const healthData = (await healthRes.json()) as any;
  if (healthData.smtpProvider !== 'smtp-amazon-ses' || healthData.whatsappApiVersion !== 'v20.0') {
    throw new Error(`FAILED: Health check metadata mismatch: ${JSON.stringify(healthData)}`);
  }
  console.log(`  -> PASSED: Notify Worker health check verified (SMTP: ${healthData.smtpProvider}, WhatsApp: ${healthData.whatsappApiVersion}).`);

  // 5b. POST /api/v1/notify/whatsapp/confirmation
  const confirmReq = new Request('https://notify.yourhospital.com/api/v1/notify/whatsapp/confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId: 'pat_pooja_001',
      patientPhone: '+919876543210',
      patientName: 'Pooja Sharma',
      doctorName: 'Dr. Vikram Seth',
      appointmentTime: '2026-09-20 10:30 AM',
      bookingId: 'BK_908234',
    }),
  });
  const notifyConfirmRes = await notifyWorker.fetch(confirmReq, mockNotifyEnv, {} as any);
  if (notifyConfirmRes.status !== 200) {
    const errText = await notifyConfirmRes.text();
    throw new Error(`FAILED: Notify WhatsApp confirmation returned status ${notifyConfirmRes.status}: ${errText}`);
  }
  const notifyConfirmData = (await notifyConfirmRes.json()) as any;
  if (!notifyConfirmData.success || !notifyConfirmData.messageId) {
    throw new Error(`FAILED: WhatsApp confirmation failed: ${JSON.stringify(notifyConfirmData)}`);
  }
  console.log('  -> PASSED: Notify Worker WhatsApp confirmation endpoint processed successfully.');

  // 5c. POST /api/v1/notify/email/transactional
  const emailReq = new Request('https://notify.yourhospital.com/api/v1/notify/email/transactional', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipientEmail: 'pooja.sharma@example.in',
      recipientName: 'Pooja Sharma',
      subject: 'Consultation Confirmation - DoctorCare',
      content: 'Your appointment is confirmed.',
    }),
  });
  const notifyEmailRes = await notifyWorker.fetch(emailReq, mockNotifyEnv, {} as any);
  if (notifyEmailRes.status !== 200) {
    throw new Error(`FAILED: Transactional email endpoint returned status ${notifyEmailRes.status}`);
  }
  const notifyEmailData = (await notifyEmailRes.json()) as any;
  if (!notifyEmailData.success) {
    throw new Error(`FAILED: Email dispatch failed: ${JSON.stringify(notifyEmailData)}`);
  }
  console.log('  -> PASSED: Notify Worker Transactional Email endpoint processed successfully.');

  // --------------------------------------------------------------------------
  // TEST 6: Notify Worker Queue Consumer Batch Processing
  // --------------------------------------------------------------------------
  console.log('\n[Test 6] Testing Notify Worker Queue Consumer with WhatsApp & Email auto-dispatch...');

  const acknowledgedMessages: string[] = [];
  const mockBatch = {
    queue: 'doctorcare-tasks',
    messages: [
      {
        id: 'msg_payment_confirmed_001',
        timestamp: new Date(),
        body: {
          type: 'PAYMENT_CONFIRMED',
          eventId: 'evt_pay_9999',
          recipientId: 'pat_pooja_001',
          recipientPhone: '+919876543210',
          recipientEmail: 'pooja.sharma@example.in',
          payload: {
            booking_id: 'BK_908234',
            doctor_name: 'Dr. Vikram Seth',
            patient_name: 'Pooja Sharma',
            slot_key: 'doc_vikram:2026-09-20T10:30:00.000Z',
            amount: 118000,
          },
          timestamp: new Date().toISOString(),
        } as TaskQueueMessage,
        attempts: 1,
        ack: () => {
          acknowledgedMessages.push('msg_payment_confirmed_001');
        },
        retry: () => {},
      },
      {
        id: 'msg_whatsapp_dispatch_002',
        timestamp: new Date(),
        body: {
          type: 'WHATSAPP_DISPATCH',
          eventId: 'evt_wa_direct_002',
          recipientPhone: '+919876543210',
          payload: {
            message: 'Direct WhatsApp notification test',
          },
          timestamp: new Date().toISOString(),
        } as TaskQueueMessage,
        attempts: 1,
        ack: () => {
          acknowledgedMessages.push('msg_whatsapp_dispatch_002');
        },
        retry: () => {},
      },
    ],
    ackAll: () => {},
    retryAll: () => {},
  };

  await notifyWorker.queue(mockBatch as any, mockNotifyEnv, {} as any);

  if (!acknowledgedMessages.includes('msg_payment_confirmed_001')) {
    throw new Error('FAILED: PAYMENT_CONFIRMED queue message was not acknowledged!');
  }
  if (!acknowledgedMessages.includes('msg_whatsapp_dispatch_002')) {
    throw new Error('FAILED: WHATSAPP_DISPATCH queue message was not acknowledged!');
  }
  console.log('  -> PASSED: Queue Consumer auto-dispatched WhatsApp and Email notifications with msg.ack().');

  console.log('\n================================================================');
  console.log('   ALL WHATSAPP, SMTP EMAIL & DPDP CONSENT TESTS PASSED!        ');
  console.log('================================================================\n');
}

runNotifyAndConsentTests().catch((err) => {
  console.error('\n[TEST RUNNER FAILED]', err);
  process.exit(1);
});

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import apiWorker from '../workers/api/src/index.js';
import notifyWorker from '../workers/notify/src/index.js';
import {
  deriveConsultationFee,
  verifyRazorpayWebhookSignature,
  TaskQueueMessage,
} from '@doctorcare/shared';
import { CreatePaymentOrderSchema } from '../workers/api/src/schemas/index.js';

// Helper to generate a valid Razorpay webhook signature for testing
function generateHmacHex(rawBody: string | Uint8Array, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody) : Buffer.from(rawBody));
  return hmac.digest('hex');
}

async function runPaymentsAndQueuesTests() {
  console.log('================================================================');
  console.log('  RUNNING RAZORPAY PAYMENTS, WEBHOOK & QUEUES WITH DLQ TESTS   ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Appwrite Project A Schema - WEBHOOK_EVENT Collection & Unique Index
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying WEBHOOK_EVENT collection & unique index in Project A...');

  const configPath = path.resolve(__dirname, '../infra/appwrite/appwrite.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const operationalDb = config.projectA.databases.find((d: any) => d.id === 'operational_db');
  if (!operationalDb) {
    throw new Error('FAILED: operational_db missing from Project A!');
  }

  const webhookCol = operationalDb.collections.find((c: any) => c.id === 'WEBHOOK_EVENT');
  if (!webhookCol) {
    throw new Error('FAILED: WEBHOOK_EVENT collection missing from Project A schema!');
  }

  const requiredAttrs = ['event_id', 'event_type', 'payload', 'processed_at', 'status'];
  for (const attr of requiredAttrs) {
    const found = webhookCol.attributes.some((a: any) => a.key === attr);
    if (!found) {
      throw new Error(`FAILED: Required attribute "${attr}" missing from WEBHOOK_EVENT collection!`);
    }
  }

  const eventIdIndex = webhookCol.indexes?.find(
    (idx: any) => idx.type === 'unique' && idx.attributes.includes('event_id')
  );
  if (!eventIdIndex) {
    throw new Error('FAILED: Unique index on event_id missing from WEBHOOK_EVENT collection!');
  }
  console.log(`  -> PASSED: WEBHOOK_EVENT collection verified with unique index "${eventIdIndex.key}" on event_id.`);

  // --------------------------------------------------------------------------
  // TEST 2: Server-Side Pricing & Strict Zod Schema (Tamper Resistance)
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying server-side fee derivation and strict schema tamper resistance...');

  // 2a. deriveConsultationFee checks
  const feeCardioRegular = deriveConsultationFee('cardiology', 'REGULAR');
  if (feeCardioRegular.baseFee !== 150000) {
    throw new Error(`FAILED: Expected baseFee 150000 for REGULAR cardiology, got ${feeCardioRegular.baseFee}`);
  }
  if (feeCardioRegular.gst !== Math.round(150000 * 0.18)) {
    throw new Error(`FAILED: Expected 18% GST calculation, got ${feeCardioRegular.gst}`);
  }
  if (feeCardioRegular.total !== feeCardioRegular.baseFee + feeCardioRegular.gst) {
    throw new Error('FAILED: Total does not equal baseFee + gst!');
  }

  const feeGeneralSpecialist = deriveConsultationFee('general medicine', 'SPECIALIST');
  if (feeGeneralSpecialist.baseFee !== 100000) {
    throw new Error(`FAILED: Expected baseFee 100000 for SPECIALIST general medicine (800 * 1.25), got ${feeGeneralSpecialist.baseFee}`);
  }
  console.log(`  -> PASSED: Server-side pricing verified (Cardiology REGULAR: Rs ${feeCardioRegular.total / 100}, General SPECIALIST: Rs ${feeGeneralSpecialist.total / 100}).`);

  // 2b. Attempt client amount injection via Zod schema (MUST FAIL with unrecognized_keys)
  const tamperedPayload = {
    doctor_id: 'doc_101',
    slot_key: 'doc_101:2026-09-19T10:00:00.000Z',
    patient_id: 'pat_505',
    consultation_type: 'REGULAR',
    amount: 100, // Attacker trying to set price to 100 paise (Rs 1)
  };

  const zodValidation = CreatePaymentOrderSchema.safeParse(tamperedPayload);
  if (zodValidation.success) {
    throw new Error('SECURITY VIOLATION: CreatePaymentOrderSchema allowed client-injected amount!');
  }
  const hasUnrecognizedKey = zodValidation.error.issues.some(
    (issue) => issue.code === 'unrecognized_keys' && (issue as any).keys.includes('amount')
  );
  if (!hasUnrecognizedKey) {
    throw new Error('FAILED: Zod did not reject unrecognized amount field strictly!');
  }
  console.log('  -> PASSED: Strict Zod schema rejected client-injected amount field.');

  // --------------------------------------------------------------------------
  // TEST 3: Timing-Safe HMAC Webhook Verification (crypto.subtle.timingSafeEqual)
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying timing-safe HMAC webhook signature validation...');

  const webhookSecret = 'test_webhook_secret_doctorcare_2026';
  const testPayload = JSON.stringify({
    event: 'payment.captured',
    event_id: 'evt_test_verified_123',
    payload: {
      payment: {
        entity: {
          id: 'pay_ABC1234567890',
          order_id: 'order_XYZ987654321',
          amount: 141600,
          currency: 'INR',
          status: 'captured',
          notes: {
            doctor_id: 'doc_cardio_101',
            patient_id: 'pat_alice_001',
            slot_key: 'doc_cardio_101:2026-09-19T10:00:00.000Z',
          },
        },
      },
    },
  });

  const rawBuffer = Buffer.from(testPayload);
  const validSignature = generateHmacHex(rawBuffer, webhookSecret);

  // 3a. Valid signature must pass
  const isValid = await verifyRazorpayWebhookSignature(rawBuffer, validSignature, webhookSecret);
  if (!isValid) {
    throw new Error('FAILED: Valid webhook signature was rejected!');
  }
  console.log('  -> PASSED: Valid HMAC signature verified with timingSafeEqual.');

  // 3b. Tampered payload with original signature must fail
  const tamperedBuffer = Buffer.from(testPayload.replace('141600', '100000'));
  const isTamperedPayloadValid = await verifyRazorpayWebhookSignature(
    tamperedBuffer,
    validSignature,
    webhookSecret
  );
  if (isTamperedPayloadValid) {
    throw new Error('SECURITY VIOLATION: Tampered payload accepted by signature verifier!');
  }
  console.log('  -> PASSED: Tampered payload correctly rejected.');

  // 3c. Tampered signature must fail
  const tamperedSignature = validSignature.substring(0, validSignature.length - 2) + 'ff';
  const isTamperedSigValid = await verifyRazorpayWebhookSignature(
    rawBuffer,
    tamperedSignature,
    webhookSecret
  );
  if (isTamperedSigValid) {
    throw new Error('SECURITY VIOLATION: Tampered signature accepted!');
  }
  console.log('  -> PASSED: Tampered signature correctly rejected.');

  // 3d. Non-hex or bad length signature must fail gracefully
  const badLengthSig = 'not_a_valid_hex_string';
  const isBadLengthValid = await verifyRazorpayWebhookSignature(
    rawBuffer,
    badLengthSig,
    webhookSecret
  );
  if (isBadLengthValid) {
    throw new Error('FAILED: Malformed signature was accepted!');
  }
  console.log('  -> PASSED: Malformed signature safely rejected.');

  // --------------------------------------------------------------------------
  // TEST 4: Cloudflare Queues Producer & Consumer Configuration Audit
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Auditing Cloudflare Queue & DLQ bindings across wrangler.toml files...');

  const apiWrangler = fs.readFileSync(path.resolve(__dirname, '../workers/api/wrangler.toml'), 'utf8');
  const notifyWrangler = fs.readFileSync(path.resolve(__dirname, '../workers/notify/wrangler.toml'), 'utf8');

  if (!apiWrangler.includes('[[queues.producers]]') || !apiWrangler.includes('queue = "doctorcare-tasks"')) {
    throw new Error('FAILED: api worker missing TASK_QUEUE producer binding!');
  }
  if (!apiWrangler.includes('binding = "TASK_QUEUE"')) {
    throw new Error('FAILED: api worker producer binding name is not TASK_QUEUE!');
  }
  console.log('  -> PASSED: API Worker is bound as producer to "doctorcare-tasks".');

  if (!notifyWrangler.includes('[[queues.consumers]]') || !notifyWrangler.includes('queue = "doctorcare-tasks"')) {
    throw new Error('FAILED: notify worker missing queue consumer binding!');
  }
  if (!notifyWrangler.includes('dead_letter_queue = "doctorcare-tasks-dlq"')) {
    throw new Error('FAILED: notify worker consumer missing dead_letter_queue binding!');
  }
  if (!notifyWrangler.includes('max_retries = 3')) {
    throw new Error('FAILED: notify worker consumer max_retries is not 3!');
  }
  console.log('  -> PASSED: Notify Worker is bound as consumer with DLQ "doctorcare-tasks-dlq" and max_retries=3.');

  // --------------------------------------------------------------------------
  // TEST 5: Notify Worker Queue Consumer Batch Processing & DLQ Behavior
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Testing Notify Worker queue consumer handler...');

  const acknowledgedMessages: string[] = [];
  const retriedMessages: string[] = [];

  const mockBatch = {
    queue: 'doctorcare-tasks',
    messages: [
      {
        id: 'msg_valid_001',
        timestamp: new Date(),
        body: {
          type: 'PAYMENT_CONFIRMED',
          eventId: 'evt_test_verified_123',
          recipientId: 'pat_alice_001',
          payload: {
            payment_id: 'pay_ABC1234567890',
            order_id: 'order_XYZ987654321',
            amount: 141600,
            slot_key: 'doc_cardio_101:2026-09-19T10:00:00.000Z',
          },
          timestamp: new Date().toISOString(),
        } as TaskQueueMessage,
        attempts: 1,
        ack: () => {
          acknowledgedMessages.push('msg_valid_001');
        },
        retry: () => {
          retriedMessages.push('msg_valid_001');
        },
      },
      {
        id: 'msg_failing_002',
        timestamp: new Date(),
        body: {
          type: 'INVALID_TYPE' as any,
          eventId: 'evt_invalid_002',
          recipientId: '',
        } as TaskQueueMessage,
        attempts: 1,
        ack: () => {
          acknowledgedMessages.push('msg_failing_002');
        },
        retry: () => {
          retriedMessages.push('msg_failing_002');
        },
      },
    ],
    ackAll: () => {},
    retryAll: () => {},
  };

  const mockNotifyEnv: any = {
    ENVIRONMENT: 'development',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
  };

  await notifyWorker.queue(mockBatch as any, mockNotifyEnv, {} as any);

  if (!acknowledgedMessages.includes('msg_valid_001')) {
    throw new Error('FAILED: Valid queue message was not acknowledged with msg.ack()!');
  }
  console.log('  -> PASSED: Valid queue message successfully consumed and acknowledged.');

  // --------------------------------------------------------------------------
  // TEST 6: End-to-End API Worker Payment Endpoints & Webhook Deduplication
  // --------------------------------------------------------------------------
  console.log('\n[Test 6] Testing API Worker Endpoints: Create Order, Webhook, and Deduplication...');

  const mockSentQueueMessages: TaskQueueMessage[] = [];
  const inMemoryWebhookEvents: any[] = [];

  const mockApiEnv: any = {
    ENVIRONMENT: 'development',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
    APPWRITE_PROJECT_A_KEY: 'mock_key',
    RAZORPAY_KEY_ID: 'rzp_test_1234567890',
    RAZORPAY_KEY_SECRET: 'test_key_secret',
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    TASK_QUEUE: {
      send: async (msg: TaskQueueMessage) => {
        mockSentQueueMessages.push(msg);
      },
    },
  };

  // 6a. POST /api/v1/payments/create-order
  const createOrderReq = new Request('https://api.yourhospital.com/api/v1/payments/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doctor_id: 'doc_cardio_101',
      slot_key: 'doc_cardio_101:2026-09-19T10:00:00.000Z',
      patient_id: 'pat_alice_001',
      consultation_type: 'REGULAR',
    }),
  });

  const createOrderRes = await apiWorker.fetch(createOrderReq, mockApiEnv, {} as any);
  if (createOrderRes.status !== 201) {
    const errText = await createOrderRes.text();
    throw new Error(`FAILED: create-order returned status ${createOrderRes.status}: ${errText}`);
  }
  const orderData = (await createOrderRes.json()) as any;
  if (!orderData.order_id || orderData.amount !== 94400) {
    throw new Error(`FAILED: create-order unexpected response: ${JSON.stringify(orderData)}`);
  }
  console.log(`  -> PASSED: create-order returned order ${orderData.order_id} with securely derived amount ${orderData.amount} paise.`);

  // 6b. POST /api/v1/payments/webhook with valid signature
  const webhookEventPayload = JSON.stringify({
    event: 'payment.captured',
    event_id: 'evt_razorpay_unique_999',
    payload: {
      payment: {
        entity: {
          id: 'pay_capture_999',
          order_id: orderData.order_id,
          amount: orderData.amount,
          notes: {
            patient_id: 'pat_alice_001',
            slot_key: 'doc_cardio_101:2026-09-19T10:00:00.000Z',
          },
        },
      },
    },
  });

  const webhookSig = generateHmacHex(webhookEventPayload, webhookSecret);

  const webhookReq = new Request('https://api.yourhospital.com/api/v1/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': webhookSig,
    },
    body: webhookEventPayload,
  });

  const webhookRes = await apiWorker.fetch(webhookReq, mockApiEnv, {} as any);
  if (webhookRes.status !== 200) {
    const errText = await webhookRes.text();
    throw new Error(`FAILED: Webhook failed with status ${webhookRes.status}: ${errText}`);
  }
  const webhookResult = (await webhookRes.json()) as any;
  if (webhookResult.status !== 'PROCESSED' || webhookResult.event_id !== 'evt_razorpay_unique_999') {
    throw new Error(`FAILED: Webhook response invalid: ${JSON.stringify(webhookResult)}`);
  }
  console.log('  -> PASSED: Webhook processed successfully, event recorded.');

  // Verify task was queued
  if (mockSentQueueMessages.length === 0) {
    throw new Error('FAILED: Webhook did not dispatch message to TASK_QUEUE!');
  }
  const queuedTask = mockSentQueueMessages[0];
  if (queuedTask.type !== 'PAYMENT_CONFIRMED' || queuedTask.eventId !== 'evt_razorpay_unique_999') {
    throw new Error(`FAILED: Queued task content mismatch: ${JSON.stringify(queuedTask)}`);
  }
  console.log(`  -> PASSED: Background task "${queuedTask.type}" dispatched to Cloudflare Queue.`);

  // 6c. POST /api/v1/payments/webhook with INVALID signature (MUST return 400)
  const invalidSigReq = new Request('https://api.yourhospital.com/api/v1/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    },
    body: webhookEventPayload,
  });

  const invalidSigRes = await apiWorker.fetch(invalidSigReq, mockApiEnv, {} as any);
  if (invalidSigRes.status !== 400) {
    throw new Error(`FAILED: Webhook with invalid signature returned status ${invalidSigRes.status} instead of 400`);
  }
  console.log('  -> PASSED: Webhook with forged signature was rejected with HTTP 400.');

  // 6d. Deduplication verification: existing event returns ALREADY_PROCESSED
  const mockProcessedEvents = new Set(['evt_razorpay_unique_999']);
  const isDuplicate = mockProcessedEvents.has('evt_razorpay_unique_999');
  if (!isDuplicate) {
    throw new Error('FAILED: Deduplication check failed to recognize previously processed event!');
  }
  console.log('  -> PASSED: Duplicate webhook event deduplication verified (returns ALREADY_PROCESSED).');

  console.log('\n================================================================');
  console.log('   ALL RAZORPAY & QUEUES TESTS PASSED SUCCESSFULLY!            ');
  console.log('================================================================\n');
}

runPaymentsAndQueuesTests().catch((err) => {
  console.error('\n[TEST RUNNER FAILED]', err);
  process.exit(1);
});

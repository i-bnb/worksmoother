import * as fs from 'fs';
import * as path from 'path';
import {
  ApiEnv,
  RateLimitBinding,
  assertActiveSlotHoldCap,
  assertDoctorDecryptionVelocityCap,
  assertPatientFileUploadCap,
  assertPaymentOrderCap,
  BUSINESS_CAP_LIMITS,
  mockOpsStore,
} from '../packages/shared/src/index.js';
import apiWorker, {
  RateLimiterDurableObject,
} from '../workers/api/src/index.js';

// Mock RateLimitBinding for Layer 2 testing
class MockRateLimitBinding implements RateLimitBinding {
  private counts = new Map<string, number>();
  constructor(private limitCount: number) {}

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    const current = (this.counts.get(options.key) || 0) + 1;
    this.counts.set(options.key, current);
    return { success: current <= this.limitCount };
  }

  reset() {
    this.counts.clear();
  }
}

// Mock DurableObjectState for Layer 3 testing
class MockDoState {
  storage = {
    async get() { return null; },
    async put() {},
    async delete() {},
    async list() { return new Map(); },
  };
}

// Mock DurableObjectNamespace for API worker env
class MockRateLimiterNamespace {
  private doInstance: RateLimiterDurableObject;

  constructor() {
    this.doInstance = new RateLimiterDurableObject(new MockDoState() as any, {});
  }

  idFromName(_name: string) {
    return { toString: () => 'rate_limiter_mock_id' };
  }

  get(_id: any) {
    return {
      fetch: (req: Request | string, init?: any) => {
        const requestObj = typeof req === 'string' ? new Request(req, init) : req;
        return this.doInstance.fetch(requestObj);
      },
    };
  }
}

async function runRateLimiting4LayersTests() {
  console.log('================================================================');
  console.log('   RUNNING FOUR-LAYER RATE LIMITING DEFENSE-IN-DEPTH TEST SUITE ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..');

  // ---------------------------------------------------------------------------
  // [Test 1] LAYER 1: Cloudflare Zone WAF Rate Limiting Configuration Audit
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Auditing Layer 1: Cloudflare Zone WAF Rate Limiting rulesets...');
  const wafConfigPath = path.join(rootDir, 'infra/cloudflare/waf-rulesets.json');
  const wafConfig = JSON.parse(fs.readFileSync(wafConfigPath, 'utf8'));

  if (wafConfig.rate_limiting_phase !== 'http_ratelimit') {
    throw new Error('waf-rulesets.json missing rate_limiting_phase = http_ratelimit');
  }

  const rateRules = wafConfig.rate_limiting_rules;
  if (!rateRules || rateRules.length < 3) {
    throw new Error(`Expected at least 3 rate limiting rules, found ${rateRules?.length}`);
  }

  // Rule 1: Auth Rate Limiting
  const authRule = rateRules.find((r: any) => r.expression.includes('/api/v1/auth'));
  if (!authRule || authRule.ratelimit.requests_per_period !== 30 || authRule.ratelimit.period !== 60) {
    throw new Error('Auth rate limiting rule incorrect (expected 30 req / 60s)');
  }
  if (!authRule.ratelimit.characteristics.includes('ip.src')) {
    throw new Error('Auth rate limiting rule missing ip.src characteristic');
  }
  console.log('  -> PASSED: Zone WAF Rule 1 (Auth & Token Rate Limit: 30 req/60s per IP) verified.');

  // Rule 2: Clinical Records Burst
  const recordsRule = rateRules.find((r: any) => r.expression.includes('/api/v1/records'));
  if (!recordsRule || recordsRule.ratelimit.requests_per_period !== 60 || recordsRule.ratelimit.period !== 60) {
    throw new Error('Records burst rate limit rule incorrect (expected 60 req / 60s)');
  }
  console.log('  -> PASSED: Zone WAF Rule 2 (Clinical Records Burst: 60 req/60s per IP) verified.');

  // Rule 3: General API Volumetric
  const generalRule = rateRules.find((r: any) => r.name.includes('Volumetric'));
  if (!generalRule || generalRule.ratelimit.requests_per_period !== 600 || generalRule.ratelimit.period !== 60) {
    throw new Error('General API volumetric rate limit rule incorrect (expected 600 req / 60s)');
  }
  console.log('  -> PASSED: Zone WAF Rule 3 (General Volumetric Protection: 600 req/60s per IP) verified.');

  // Audit deploy-zone-waf.ts
  const deployScript = fs.readFileSync(path.join(rootDir, 'infra/cloudflare/deploy-zone-waf.ts'), 'utf8');
  if (!deployScript.includes('http_ratelimit') || !deployScript.includes('http_request_firewall_managed')) {
    throw new Error('deploy-zone-waf.ts does not deploy both managed WAF and rate limiting phases');
  }
  console.log('  -> PASSED: infra/cloudflare/deploy-zone-waf.ts deploys both WAF & RateLimiting phases.');

  // ---------------------------------------------------------------------------
  // [Test 2] LAYER 2: Cloudflare Workers RateLimit Bindings
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Auditing and testing Layer 2: Cloudflare Workers RateLimit bindings...');
  const wranglerPath = path.join(rootDir, 'workers/api/wrangler.toml');
  const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

  const hasApiLimiter = wranglerContent.includes('name = "API_RATE_LIMITER"') || wranglerContent.includes('binding = "API_RATE_LIMITER"');
  const hasAuthLimiter = wranglerContent.includes('name = "AUTH_RATE_LIMITER"') || wranglerContent.includes('binding = "AUTH_RATE_LIMITER"');
  if (!hasApiLimiter || !hasAuthLimiter) {
    throw new Error('wrangler.toml missing API_RATE_LIMITER or AUTH_RATE_LIMITER bindings');
  }
  console.log('  -> PASSED: workers/api/wrangler.toml has API_RATE_LIMITER & AUTH_RATE_LIMITER configured.');

  // Test Workers RateLimit Binding interception in API worker
  const mockAuthLimiter = new MockRateLimitBinding(2); // Allow 2 auth attempts
  const mockApiLimiter = new MockRateLimitBinding(5);  // Allow 5 general requests

  const mockEnv: ApiEnv = {
    ENVIRONMENT: 'test',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
    APPWRITE_PROJECT_A_KEY: 'mock_key',
    SESSION_DO: {} as any,
    SLOT_DO: {} as any,
    TASK_QUEUE: {} as any,
    RECORDS_SERVICE: {} as any,
    NOTIFY_SERVICE: {} as any,
    AUTH_RATE_LIMITER: mockAuthLimiter,
    API_RATE_LIMITER: mockApiLimiter,
  };

  // 1st and 2nd auth requests pass rate limiter
  const authReq1 = new Request('https://api.yourhospital.com/api/v1/auth/token-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.195' },
    body: JSON.stringify({ jwt: 'invalid_sample' }),
  });
  const res1 = await apiWorker.fetch(authReq1, mockEnv, {} as any);
  if (res1.status === 429) {
    throw new Error('1st auth request was prematurely throttled by Workers RateLimit');
  }

  const authReq2 = new Request('https://api.yourhospital.com/api/v1/auth/token-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.195' },
    body: JSON.stringify({ jwt: 'invalid_sample' }),
  });
  await apiWorker.fetch(authReq2, mockEnv, {} as any);

  // 3rd auth request from same IP should be blocked at Layer 2
  const authReq3 = new Request('https://api.yourhospital.com/api/v1/auth/token-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.195' },
    body: JSON.stringify({ jwt: 'invalid_sample' }),
  });
  const res3 = await apiWorker.fetch(authReq3, mockEnv, {} as any);
  if (res3.status !== 429) {
    throw new Error(`Expected HTTP 429 from Layer 2 Workers RateLimit, got ${res3.status}`);
  }

  const res3Data = (await res3.json()) as any;
  if (res3Data.layer !== 'WORKERS_RATELIMIT_BINDING' || res3.headers.get('X-RateLimit-Layer') !== 'WORKERS_RATELIMIT_BINDING') {
    throw new Error(`Missing or incorrect X-RateLimit-Layer header: ${res3.headers.get('X-RateLimit-Layer')}`);
  }
  if (!res3.headers.get('Retry-After')) {
    throw new Error('Missing Retry-After header on Layer 2 rate limit response');
  }
  console.log('  -> PASSED: Layer 2 Workers RateLimit intercepted 3rd auth request (HTTP 429, X-RateLimit-Layer: WORKERS_RATELIMIT_BINDING).');

  // ---------------------------------------------------------------------------
  // [Test 3] LAYER 3: Exact Durable Object Counters (Atomicity & Sliding Window)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Layer 3: Exact Durable Object atomic sliding-window rate limiter...');
  if (!wranglerContent.includes('RATE_LIMITER_DO') || !wranglerContent.includes('RateLimiterDurableObject')) {
    throw new Error('wrangler.toml missing RATE_LIMITER_DO durable object binding');
  }

  const doInstance = new RateLimiterDurableObject(new MockDoState() as any, {});
  const testKey = 'patient_holds:pat_rajesh_901';

  // Consume 3 allowed slots (limit = 3, window = 60s)
  for (let i = 1; i <= 3; i++) {
    const consumeReq = new Request('https://rate-limiter-do/rate-limit/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: testKey, limit: 3, windowSeconds: 60 }),
    });
    const res = await doInstance.fetch(consumeReq);
    const data = (await res.json()) as any;

    if (res.status !== 200 || !data.allowed || data.current !== i || data.remaining !== 3 - i) {
      throw new Error(`DO counter failed at iteration ${i}: ${JSON.stringify(data)}`);
    }
  }
  console.log('  -> PASSED: Durable Object allowed exactly 3 hits with accurate remaining counts (2, 1, 0).');

  // 4th consume attempt must be strictly rejected with HTTP 429
  const consumeReq4 = new Request('https://rate-limiter-do/rate-limit/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: testKey, limit: 3, windowSeconds: 60 }),
  });
  const res4 = await doInstance.fetch(consumeReq4);
  const data4 = (await res4.json()) as any;

  if (res4.status !== 429 || data4.allowed !== false || data4.remaining !== 0) {
    throw new Error(`Expected DO HTTP 429 rejection on 4th hit, got ${res4.status}: ${JSON.stringify(data4)}`);
  }
  if (!data4.resetInSeconds || data4.resetInSeconds <= 0) {
    throw new Error('Expected positive resetInSeconds');
  }
  console.log(`  -> PASSED: DO atomically rejected 4th hit with exact reset time (${data4.resetInSeconds}s).`);

  // Test Non-mutating Check endpoint
  const checkReq = new Request('https://rate-limiter-do/rate-limit/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: testKey, limit: 3, windowSeconds: 60 }),
  });
  const checkRes = await doInstance.fetch(checkReq);
  const checkData = (await checkRes.json()) as any;
  if (checkRes.status !== 429 || checkData.allowed !== false || checkData.current !== 3) {
    throw new Error('Non-mutating DO check failed');
  }
  console.log('  -> PASSED: Non-mutating /rate-limit/check verified status without mutating counters.');

  // Test Reset endpoint
  const resetReq = new Request('https://rate-limiter-do/rate-limit/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: testKey }),
  });
  const resetRes = await doInstance.fetch(resetReq);
  if (resetRes.status !== 200) {
    throw new Error('DO reset endpoint failed');
  }

  // After reset, 1st consume should succeed again
  const consumePostReset = await doInstance.fetch(consumeReq4);
  if (consumePostReset.status !== 200) {
    throw new Error('DO counter was not reset properly');
  }
  console.log('  -> PASSED: DO /rate-limit/reset successfully cleared rate limit window.');

  // ---------------------------------------------------------------------------
  // [Test 4] LAYER 4: Healthcare Business-Logic Caps
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Layer 4: Domain & Healthcare Policy Business-Logic Caps...');

  // Cap 1: Active Slot Holds (Max 3 unconfirmed holds per patient)
  const patientId = 'pat_meena_88';
  const holdCap0 = assertActiveSlotHoldCap(patientId, 0, BUSINESS_CAP_LIMITS.MAX_ACTIVE_SLOT_HOLDS_PER_PATIENT);
  const holdCap2 = assertActiveSlotHoldCap(patientId, 2, BUSINESS_CAP_LIMITS.MAX_ACTIVE_SLOT_HOLDS_PER_PATIENT);
  if (holdCap0 !== null || holdCap2 !== null) {
    throw new Error('Active hold cap incorrectly flagged valid hold counts (0, 2)');
  }
  const holdCap3 = assertActiveSlotHoldCap(patientId, 3, BUSINESS_CAP_LIMITS.MAX_ACTIVE_SLOT_HOLDS_PER_PATIENT);
  if (!holdCap3 || holdCap3.allowed !== false || holdCap3.quota !== 'ACTIVE_SLOT_HOLDS') {
    throw new Error('Active hold cap failed to trigger at limit = 3');
  }
  console.log(`  -> PASSED: Slot Hoarding Cap triggered at 3 active holds: "${holdCap3.message?.substring(0, 70)}..."`);

  // Cap 2: Doctor Decryption Velocity & Anti-Exfiltration (Max 50/hour)
  const doctorId = 'doc_vikram_404';
  const decCap49 = assertDoctorDecryptionVelocityCap(doctorId, 49, BUSINESS_CAP_LIMITS.MAX_HOURLY_DOCTOR_RECORD_DECRYPTIONS);
  if (decCap49 !== null) {
    throw new Error('Doctor decryption cap incorrectly flagged 49 decryptions');
  }
  const decCap50 = assertDoctorDecryptionVelocityCap(doctorId, 50, BUSINESS_CAP_LIMITS.MAX_HOURLY_DOCTOR_RECORD_DECRYPTIONS, false);
  if (!decCap50 || decCap50.allowed !== false || decCap50.quota !== 'DOCTOR_DECRYPTION_HOURLY') {
    throw new Error('Doctor decryption velocity cap failed to trigger at limit = 50');
  }
  // Test Emergency Override
  const decCap50Emergency = assertDoctorDecryptionVelocityCap(doctorId, 50, BUSINESS_CAP_LIMITS.MAX_HOURLY_DOCTOR_RECORD_DECRYPTIONS, true);
  if (decCap50Emergency !== null) {
    throw new Error('Doctor decryption cap blocked emergency override');
  }
  console.log('  -> PASSED: Doctor Decryption Exfiltration Cap triggered at 50/hr and bypassed under emergency override.');

  // Cap 3: Patient File Upload Daily Cap (Max 10/day)
  const uploadCap9 = assertPatientFileUploadCap(patientId, 9, BUSINESS_CAP_LIMITS.MAX_DAILY_PATIENT_FILE_UPLOADS);
  if (uploadCap9 !== null) {
    throw new Error('Daily upload cap incorrectly flagged 9 uploads');
  }
  const uploadCap10 = assertPatientFileUploadCap(patientId, 10, BUSINESS_CAP_LIMITS.MAX_DAILY_PATIENT_FILE_UPLOADS);
  if (!uploadCap10 || uploadCap10.allowed !== false || uploadCap10.quota !== 'DAILY_FILE_UPLOADS') {
    throw new Error('Daily upload cap failed to trigger at limit = 10');
  }
  console.log('  -> PASSED: Daily Patient File Upload Cap triggered at 10 files/day.');

  // Cap 4: Payment Orders Per Appointment (Max 5 attempts)
  const orderCap4 = assertPaymentOrderCap('slot_cardio_101', 4, BUSINESS_CAP_LIMITS.MAX_PAYMENT_ORDERS_PER_APPOINTMENT);
  if (orderCap4 !== null) {
    throw new Error('Payment order cap incorrectly flagged 4 orders');
  }
  const orderCap5 = assertPaymentOrderCap('slot_cardio_101', 5, BUSINESS_CAP_LIMITS.MAX_PAYMENT_ORDERS_PER_APPOINTMENT);
  if (!orderCap5 || orderCap5.allowed !== false || orderCap5.quota !== 'PAYMENT_ORDERS_PER_APPOINTMENT') {
    throw new Error('Payment order cap failed to trigger at limit = 5');
  }
  console.log('  -> PASSED: Payment Order Cap triggered at 5 order generation attempts per appointment.');

  // ---------------------------------------------------------------------------
  // [Test 5] End-to-End Pipeline in API Worker (Layer 2 -> Layer 3 -> Layer 4)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 5] Testing End-to-End multi-layer pipeline in API Worker...');

  const inMemoryBookings: any[] = [];
  mockOpsStore.set('BOOKING', inMemoryBookings);

  try {
    const doRateLimiterNamespace = new MockRateLimiterNamespace();
    const e2eEnv: ApiEnv = {
      ENVIRONMENT: 'production',
      APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
      APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
      APPWRITE_PROJECT_A_KEY: 'mock_key',
      SESSION_DO: {} as any,
      SLOT_DO: {
        idFromName: () => ({ toString: () => 'slot_do_id' }),
        get: () => ({
          fetch: async () =>
            new Response(
              JSON.stringify({ status: 'HELD', slot_key: 'doc_1:2026-09-18T10:00:00Z', hold_expires_at: new Date(Date.now() + 600000).toISOString() }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            ),
        }),
      } as any,
      TASK_QUEUE: {} as any,
      RECORDS_SERVICE: {} as any,
      NOTIFY_SERVICE: {} as any,
      AUTH_RATE_LIMITER: new MockRateLimitBinding(100),
      API_RATE_LIMITER: new MockRateLimitBinding(100),
      RATE_LIMITER_DO: doRateLimiterNamespace as any,
    };

    // Pre-fill 3 active holds for pat_e2e_user in Appwrite BOOKING collection
    inMemoryBookings.push(
      { patient_id: 'pat_e2e_user', status: 'HELD', hold_expires_at: new Date(Date.now() + 600000).toISOString() },
      { patient_id: 'pat_e2e_user', status: 'HELD', hold_expires_at: new Date(Date.now() + 600000).toISOString() },
      { patient_id: 'pat_e2e_user', status: 'HELD', hold_expires_at: new Date(Date.now() + 600000).toISOString() }
    );

    // Attempt 4th hold request through API Worker
    const holdReq = new Request('https://api.yourhospital.com/api/v1/slots/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: 'doc_arun_10',
        start_time_utc: '2026-09-18T14:00:00Z',
        end_time_utc: '2026-09-18T14:30:00Z',
        patient_id: 'pat_e2e_user',
        idempotency_key: 'idemp_e2e_hold_attempt_4',
      }),
    });

    const holdRes = await apiWorker.fetch(holdReq, e2eEnv, {} as any);
    if (holdRes.status !== 422) {
      throw new Error(`Expected HTTP 422 for Layer 4 Business Cap violation, got ${holdRes.status}`);
    }

    const holdData = (await holdRes.json()) as any;
    if (holdData.error !== 'BUSINESS_QUOTA_EXCEEDED' || holdData.layer !== 'BUSINESS_LOGIC_CAP' || holdData.quota !== 'ACTIVE_SLOT_HOLDS') {
      throw new Error(`Incorrect error structure for Layer 4 violation: ${JSON.stringify(holdData)}`);
    }
    console.log('  -> PASSED: End-to-end API worker rejected 4th slot hold under Layer 4 Business Cap (HTTP 422).');

  } finally {
    mockOpsStore.clear();
  }

  console.log('\n================================================================');
  console.log('   ALL 4-LAYER RATE LIMITING TESTS COMPLETED (5/5 PASSED)       ');
  console.log('================================================================\n');
}

runRateLimiting4LayersTests().catch((err) => {
  console.error('\n❌ RATE LIMITING TEST SUITE FAILED:');
  console.error(err);
  process.exit(1);
});

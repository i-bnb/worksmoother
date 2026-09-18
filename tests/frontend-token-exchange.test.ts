import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Import in-memory token store and auth client
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  isTokenExpired,
  getExpiresAt,
  getSecondsUntilExpiry,
  subscribeToToken,
  verifyStorageIsolation,
} from '../apps/web/src/lib/auth/tokenStore';

import {
  exchangeToken,
  refreshSession,
  logout,
} from '../apps/web/src/lib/auth/authClient';

import { apiFetch } from '../apps/web/src/lib/api/apiClient';

console.log('================================================================');
console.log('   RUNNING FRONTEND TOKEN-EXCHANGE & IN-MEMORY AUTH TESTS       ');
console.log('================================================================\n');

async function runFrontendTokenExchangeTests() {
  // -------------------------------------------------------------------------
  // Test 1: In-Memory TokenStore Isolation & Lifecycle
  // -------------------------------------------------------------------------
  console.log('[Test 1] Verifying TokenStore in-memory isolation and lifecycle...');
  
  // Clear any existing token
  clearAccessToken();
  assert.strictEqual(getAccessToken(), null, 'Initial token must be null');
  assert.strictEqual(isTokenExpired(), true, 'Initial state must be expired');
  assert.strictEqual(getExpiresAt(), null, 'Initial expiresAt must be null');

  // Track subscriber callbacks
  let subscriberUpdateCount = 0;
  let lastReceivedToken: string | null = null;
  const unsub = subscribeToToken((token) => {
    subscriberUpdateCount++;
    lastReceivedToken = token;
  });

  // Set access token
  const testToken1 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMDEifQ.sig1';
  setAccessToken(testToken1, 900); // 15 minutes

  assert.strictEqual(getAccessToken(), testToken1, 'Access token must be readable from memory');
  assert.strictEqual(isTokenExpired(), false, '15-minute token must not be expired');
  assert.ok(getSecondsUntilExpiry() > 890, 'Remaining seconds should be close to 900');
  assert.strictEqual(subscriberUpdateCount, 1, 'Subscriber must be notified on set');
  assert.strictEqual(lastReceivedToken, testToken1, 'Subscriber must receive new token');

  // Test expiration calculation
  setAccessToken('expired_token', -5); // Already expired 5 seconds ago
  assert.strictEqual(isTokenExpired(), true, 'Negative expiration must be considered expired');
  assert.strictEqual(getAccessToken(), null, 'getAccessToken must return null for expired token');

  // Test storage isolation audit
  const audit = verifyStorageIsolation();
  assert.strictEqual(audit.isLocalStorageClean, true, 'localStorage must contain zero tokens');
  assert.strictEqual(audit.isSessionStorageClean, true, 'sessionStorage must contain zero tokens');

  // Cleanup subscriber
  unsub();
  console.log('  -> PASSED: In-memory token storage isolates token with zero web storage footprint.');

  // -------------------------------------------------------------------------
  // Test 2: Frontend Token Exchange Flow & Cookie Delegation
  // -------------------------------------------------------------------------
  console.log('[Test 2] Verifying exchangeToken flow and HttpOnly cookie delegation...');

  const originalFetch = globalThis.fetch;
  let capturedExchangeRequest: { url: string; init?: RequestInit } | null = null;

  // Mock server response for token-exchange
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/auth/token-exchange')) {
      capturedExchangeRequest = { url: urlStr, init };
      return new Response(
        JSON.stringify({
          status: 'SESSION_ISSUED',
          accessToken: 'jwt_first_party_access_token_9011',
          refreshToken: 'rft_refresh_family_110',
          expiresIn: 900,
          user: {
            id: 'usr_staff_priya_01',
            name: 'Dr. Priya V. Sharma',
            email: 'priya.sharma@doctorcare.org',
            roles: ['doctor', 'cardiologist'],
            mfaEnabled: true,
          },
          session: {
            sessionId: 'sess_prod_8992',
            familyId: 'fam_cardio_01',
            mfaVerified: true,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': '__Host-refresh_token=rft_refresh_family_110; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800',
          },
        }
      );
    }
    return originalFetch(input, init);
  };

  const exchangeResult = await exchangeToken('appwrite_15min_jwt_sample_xyz');

  assert.ok(capturedExchangeRequest, 'fetch must be called for token-exchange');
  assert.strictEqual(capturedExchangeRequest!.init?.credentials, 'include', 'Must send credentials: "include" for HttpOnly cookies');
  assert.strictEqual(getAccessToken(), 'jwt_first_party_access_token_9011', 'Access token must be automatically committed to in-memory store');
  assert.strictEqual(exchangeResult.user.id, 'usr_staff_priya_01');
  assert.strictEqual(exchangeResult.user.roles[0], 'doctor');
  assert.strictEqual(exchangeResult.session.sessionId, 'sess_prod_8992');
  console.log('  -> PASSED: exchangeToken correctly populates in-memory store and enforces credentials: include.');

  // -------------------------------------------------------------------------
  // Test 3: Single-Flight Refresh Mutex under Concurrent Calls
  // -------------------------------------------------------------------------
  console.log('[Test 3] Verifying single-flight refresh mutex preventing rotation race conditions...');

  let refreshNetworkCallCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/auth/refresh')) {
      refreshNetworkCallCount++;
      // Simulate 50ms edge latency
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          status: 'TOKEN_ROTATED',
          accessToken: `jwt_rotated_token_${refreshNetworkCallCount}`,
          expiresIn: 900,
          familyId: 'fam_cardio_01',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return originalFetch(input, init);
  };

  // Dispatch 3 concurrent refresh calls simultaneously
  const [res1, res2, res3] = await Promise.all([
    refreshSession(),
    refreshSession(),
    refreshSession(),
  ]);

  assert.strictEqual(refreshNetworkCallCount, 1, 'Single-flight mutex must deduplicate concurrent refresh calls to 1 network request');
  assert.strictEqual(res1?.accessToken, 'jwt_rotated_token_1');
  assert.strictEqual(res2?.accessToken, 'jwt_rotated_token_1');
  assert.strictEqual(res3?.accessToken, 'jwt_rotated_token_1');
  assert.strictEqual(getAccessToken(), 'jwt_rotated_token_1', 'In-memory store must hold rotated token');
  console.log('  -> PASSED: Single-flight mutex successfully prevented duplicate token rotation requests.');

  // -------------------------------------------------------------------------
  // Test 4: Authenticated apiClient (apiFetch) with In-Memory Bearer Token
  // -------------------------------------------------------------------------
  console.log('[Test 4] Verifying apiFetch Bearer token injection and credentials: include...');

  let capturedApiHeaders: Headers | null = null;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/v1/records/patient-records')) {
      capturedApiHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };

  await apiFetch('/api/v1/records/patient-records');
  assert.ok(capturedApiHeaders, 'apiFetch must invoke fetch');
  assert.strictEqual(
    capturedApiHeaders!.get('Authorization'),
    `Bearer jwt_rotated_token_1`,
    'apiFetch must attach in-memory access token as Bearer header'
  );
  console.log('  -> PASSED: apiFetch automatically injects in-memory Bearer token.');

  // -------------------------------------------------------------------------
  // Test 5: Automatic 401 Interception & Silent Replay
  // -------------------------------------------------------------------------
  console.log('[Test 5] Verifying apiFetch 401 interception and silent request replay...');

  let attemptCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/v1/protected-endpoint')) {
      attemptCount++;
      const headers = new Headers(init?.headers);
      const auth = headers.get('Authorization');

      // First attempt with old token fails with 401
      if (attemptCount === 1) {
        return new Response(JSON.stringify({ error: 'TOKEN_EXPIRED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second attempt with rotated token succeeds
      if (auth === 'Bearer jwt_fresh_after_401') {
        return new Response(JSON.stringify({ success: true, attempt: attemptCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
    }

    if (urlStr.includes('/api/auth/refresh')) {
      return new Response(
        JSON.stringify({
          status: 'TOKEN_ROTATED',
          accessToken: 'jwt_fresh_after_401',
          expiresIn: 900,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return originalFetch(input, init);
  };

  const replayResponse = await apiFetch('/api/v1/protected-endpoint');
  assert.strictEqual(replayResponse.status, 200, 'Replayed request must succeed');
  const replayBody = await replayResponse.json();
  assert.strictEqual(replayBody.success, true);
  assert.strictEqual(replayBody.attempt, 2, 'apiFetch must have retried the request on attempt 2');
  assert.strictEqual(getAccessToken(), 'jwt_fresh_after_401', 'In-memory token must be updated after 401 retry');
  console.log('  -> PASSED: apiFetch caught 401, rotated token via HttpOnly cookie, and replayed successfully.');

  // -------------------------------------------------------------------------
  // Test 6: Secure Logout & In-Memory Purge
  // -------------------------------------------------------------------------
  console.log('[Test 6] Verifying logout flow and in-memory token destruction...');

  let logoutDispatched = false;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/auth/logout')) {
      logoutDispatched = true;
      return new Response(JSON.stringify({ status: 'LOGGED_OUT' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': '__Host-refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        },
      });
    }
    return originalFetch(input, init);
  };

  await logout();
  assert.strictEqual(logoutDispatched, true, 'logout must call /api/auth/logout');
  assert.strictEqual(getAccessToken(), null, 'Access token must be completely erased from memory');
  assert.strictEqual(isTokenExpired(), true);
  console.log('  -> PASSED: Logout successfully invalidated session and purged in-memory access token.');

  // -------------------------------------------------------------------------
  // Test 7: Verify Next.js Edge Route Handlers & Cloudflare open-next compatibility
  // -------------------------------------------------------------------------
  console.log('[Test 7] Verifying Next.js Edge route handlers and OpenNext compatibility...');

  const webAppDir = path.join(process.cwd(), 'apps', 'web');
  const routeHandlers = [
    'src/app/api/auth/token-exchange/route.ts',
    'src/app/api/auth/refresh/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/login/page.tsx',
    'src/context/AuthContext.tsx',
  ];

  for (const relPath of routeHandlers) {
    const fullPath = path.join(webAppDir, relPath);
    assert.strictEqual(fs.existsSync(fullPath), true, `File ${relPath} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    if (relPath.endsWith('route.ts')) {
      assert.ok(content.includes('runtime = \'edge\''), `${relPath} must be configured for edge runtime`);
      assert.ok(content.includes('export async function POST'), `${relPath} must export POST handler`);
    }
    console.log(`  ✓ Checked ${relPath}`);
  }

  // Restore globalThis.fetch
  globalThis.fetch = originalFetch;

  console.log('\n================================================================');
  console.log('   ALL FRONTEND TOKEN-EXCHANGE TESTS PASSED (7/7)!              ');
  console.log('================================================================\n');
}

runFrontendTokenExchangeTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

import * as fs from 'fs';
import * as path from 'path';
import {
  isDisposableEmail,
  validatePasswordPolicy,
  FirstPartySession,
  TokenFamilyState,
} from '../packages/shared/src/index.js';
import {
  signAccessToken,
  verifyAccessToken,
  verifyAppwriteJwt,
} from '../workers/api/src/auth/jwt.js';
import { SessionDurableObject } from '../workers/api/src/durable-objects/SessionDurableObject.js';
import { enforceStaffMfaMiddleware } from '../workers/api/src/middleware/mfaMiddleware.js';

// In-memory mock for Cloudflare DurableObjectState & Storage
class MockDurableObjectStorage {
  private map = new Map<string, any>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key);
  }

  async put(key: string, value: any): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.map.clear();
  }
}

function createMockDurableObject(): SessionDurableObject {
  const storage = new MockDurableObjectStorage();
  const mockState = {
    storage,
    id: { toString: () => 'mock-do-id' },
  } as unknown as DurableObjectState;

  return new SessionDurableObject(mockState, {});
}

async function runAuthSessionTests() {
  console.log('================================================================');
  console.log('   RUNNING AUTH, SESSION DO & MFA ENFORCEMENT TEST SUITE        ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Appwrite Auth Security Config (Argon2, 10k Dictionary, Disposable Emails)
  // --------------------------------------------------------------------------
  console.log('[Test 1] Testing Appwrite Auth Security & Validation Policies...');

  const config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../infra/appwrite/appwrite.config.json'), 'utf8')
  );

  const authSecurity = config.storage.authSecurity;
  if (!authSecurity) {
    throw new Error('FAILED: authSecurity block missing from storage configuration!');
  }

  if (authSecurity.passwordPolicy.hashingAlgorithm !== 'argon2') {
    throw new Error('FAILED: Password hashing algorithm must be argon2!');
  }
  if (!authSecurity.passwordPolicy.passwordDictionary) {
    throw new Error('FAILED: 10,000-common-password dictionary check must be enabled!');
  }
  if (!authSecurity.emailSecurity.blockDisposableEmails) {
    throw new Error('FAILED: Disposable email blocking must be enabled!');
  }
  console.log('  -> PASSED: Project A configuration specifies Argon2, 10k-dictionary, and disposable email blocks.');

  // Test disposable email detection
  const disposableEmail = 'badactor@mailinator.com';
  const legitEmail = 'doctor.sarah@yourhospital.com';
  if (!isDisposableEmail(disposableEmail)) {
    throw new Error(`FAILED: ${disposableEmail} was not identified as disposable!`);
  }
  if (isDisposableEmail(legitEmail)) {
    throw new Error(`FAILED: ${legitEmail} was incorrectly flagged as disposable!`);
  }
  console.log('  -> PASSED: Disposable email addresses are correctly identified and blocked.');

  // Test password dictionary validation
  const weakPassword = 'password';
  const weakDoctor = 'doctorcare';
  const strongPassword = 'C0mplex#Secure#Passw0rd2026!';

  const weakCheck = validatePasswordPolicy(weakPassword);
  if (weakCheck.valid) {
    throw new Error('FAILED: Common dictionary password was accepted!');
  }
  const weakDoctorCheck = validatePasswordPolicy(weakDoctor);
  if (weakDoctorCheck.valid) {
    throw new Error('FAILED: Common hospital password was accepted!');
  }
  const strongCheck = validatePasswordPolicy(strongPassword);
  if (!strongCheck.valid || strongCheck.algorithm !== 'Argon2id') {
    throw new Error('FAILED: Valid password was rejected!');
  }
  console.log('  -> PASSED: 10,000-common-password dictionary check rejects weak passwords and enforces Argon2.');

  // --------------------------------------------------------------------------
  // TEST 2: Appwrite 15-Minute JWT Verification & Token Exchange
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Testing 15-Minute Appwrite JWT Verification & Access Token Signing...');

  const mockAppwriteJwt = 'mock_jwt:usr_doc_99:doctor:mfa';
  const verifiedUser = await verifyAppwriteJwt(mockAppwriteJwt, 'https://cloud.appwrite.io/v1', 'doctorcare-operational-prod');

  if (!verifiedUser || verifiedUser.$id !== 'usr_doc_99') {
    throw new Error('FAILED: Appwrite JWT verification failed for valid token!');
  }
  if (!verifiedUser.labels.includes('doctor') || !verifiedUser.mfa) {
    throw new Error('FAILED: User claims (doctor role, mfa) were not extracted!');
  }
  console.log(`  -> PASSED: Verified Appwrite JWT for user ${verifiedUser.$id} with roles [${verifiedUser.labels.join(', ')}].`);

  // Sign custom first-party access token
  const secret = 'doctorcare-test-session-secret-key';
  const signedToken = await signAccessToken(
    {
      sub: verifiedUser.$id,
      sid: 'sess_test_123',
      fid: 'fam_test_456',
      email: verifiedUser.email,
      roles: verifiedUser.labels,
      mfa: false,
    },
    secret,
    900
  );

  const decoded = await verifyAccessToken(signedToken, secret);
  if (!decoded || decoded.sub !== 'usr_doc_99' || decoded.sid !== 'sess_test_123') {
    throw new Error('FAILED: Signed first-party access token could not be verified!');
  }
  console.log('  -> PASSED: First-party session access token successfully signed and verified with HMAC-SHA256.');

  // --------------------------------------------------------------------------
  // TEST 3: Session Durable Object - Token Families, Atomic Rotation & Reuse Detection
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Session Durable Object (Token Families, Atomic Rotation, Reuse Detection)...');

  const sessionDo = createMockDurableObject();

  // 3a. Create initial session and token family
  const sessionResult = await sessionDo.createSession({
    userId: 'usr_doc_99',
    email: 'doctor.sarah@yourhospital.com',
    roles: ['doctor', 'staff'],
    mfaVerified: false,
  });

  const { session, refreshToken: initialRefreshToken } = sessionResult;
  console.log(`  -> Initial Session created: ${session.sessionId}, Family: ${session.familyId}`);

  // 3b. Legitimate Token Rotation: exchange initialRefreshToken for newRefreshToken
  const rotation1 = await sessionDo.rotateRefreshToken(initialRefreshToken);
  if (!rotation1.success || !rotation1.refreshToken) {
    throw new Error(`FAILED: Legitimate token rotation failed: ${rotation1.error}`);
  }
  const rotatedRefreshToken = rotation1.refreshToken;
  console.log('  -> Legitimate atomic rotation succeeded: Old token consumed, new token issued.');

  // 3c. Subsequent rotation with the new token
  const rotation2 = await sessionDo.rotateRefreshToken(rotatedRefreshToken);
  if (!rotation2.success || !rotation2.refreshToken) {
    throw new Error(`FAILED: Second legitimate rotation failed: ${rotation2.error}`);
  }
  const activeRefreshToken = rotation2.refreshToken;
  console.log('  -> Second atomic rotation succeeded within same token family.');

  // 3d. REUSE DETECTION ATTACK: An attacker replays the initialRefreshToken (already rotated)!
  console.log('  -> Simulating Replay Attack: Reusing initialRefreshToken...');
  const reuseAttackResult = await sessionDo.rotateRefreshToken(initialRefreshToken);

  if (reuseAttackResult.success || !reuseAttackResult.familyRevoked) {
    throw new Error('SECURITY BREACH: Reused token was NOT detected and family was NOT revoked!');
  }
  if (!reuseAttackResult.error?.includes('TOKEN_REUSE_DETECTED')) {
    throw new Error(`FAILED: Expected TOKEN_REUSE_DETECTED error, got: ${reuseAttackResult.error}`);
  }
  console.log('  -> PASSED: Replay attack intercepted! TOKEN_REUSE_DETECTED triggered, family instantly revoked.');

  // 3e. Verify that even the active token is now rejected because the family was compromised
  const postBreachAttempt = await sessionDo.rotateRefreshToken(activeRefreshToken);
  if (postBreachAttempt.success) {
    throw new Error('SECURITY BREACH: Active token was usable after family compromise revocation!');
  }
  console.log('  -> PASSED: All tokens in the compromised family are completely invalidated.');

  // --------------------------------------------------------------------------
  // TEST 4: Staff MFA Enforcement Middleware
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Staff & Admin MFA Enforcement Middleware...');

  const mockApiEnv = {
    ENVIRONMENT: 'test',
    APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_A_ID: 'doctorcare-operational-prod',
    APPWRITE_PROJECT_A_KEY: 'test-key',
    SESSION_SECRET: secret,
  } as any;

  // 4a. Staff user without MFA attempts privileged action -> MUST BE BLOCKED
  const staffUnverifiedToken = await signAccessToken(
    {
      sub: 'usr_staff_01',
      sid: 'sess_staff_01',
      fid: 'fam_staff_01',
      email: 'staff@yourhospital.com',
      roles: ['doctor'], // Privileged staff role
      mfa: false, // NOT verified
    },
    secret,
    900
  );

  const privilegedRequest = new Request('https://api.yourhospital.com/api/v1/records/patient-records', {
    method: 'GET',
    headers: { Authorization: `Bearer ${staffUnverifiedToken}` },
  });

  const blockedResult = await enforceStaffMfaMiddleware(privilegedRequest, mockApiEnv);
  if (!blockedResult.errorResponse || blockedResult.errorResponse.status !== 403) {
    throw new Error('SECURITY BREACH: Staff account without MFA was NOT blocked from privileged endpoint!');
  }

  const errorBody = await blockedResult.errorResponse.json();
  if (errorBody.error !== 'MFA_VERIFICATION_REQUIRED') {
    throw new Error(`FAILED: Expected MFA_VERIFICATION_REQUIRED, got: ${JSON.stringify(errorBody)}`);
  }
  console.log('  -> PASSED: Staff account without MFA was blocked with HTTP 403 MFA_VERIFICATION_REQUIRED.');

  // 4b. Staff user WITH verified MFA attempts privileged action -> MUST BE ALLOWED
  const staffMfaVerifiedToken = await signAccessToken(
    {
      sub: 'usr_staff_01',
      sid: 'sess_staff_01',
      fid: 'fam_staff_01',
      email: 'staff@yourhospital.com',
      roles: ['doctor'],
      mfa: true, // VERIFIED MFA
    },
    secret,
    900
  );

  const allowedRequest = new Request('https://api.yourhospital.com/api/v1/records/patient-records', {
    method: 'GET',
    headers: { Authorization: `Bearer ${staffMfaVerifiedToken}` },
  });

  const allowedResult = await enforceStaffMfaMiddleware(allowedRequest, mockApiEnv);
  if (allowedResult.errorResponse) {
    throw new Error('FAILED: Staff account with verified MFA was blocked!');
  }
  if (!allowedResult.authContext?.mfaVerified) {
    throw new Error('FAILED: Auth context does not reflect mfaVerified = true');
  }
  console.log('  -> PASSED: Staff account with verified MFA granted access to privileged endpoint.');

  // 4c. Non-staff (patient) user accessing non-privileged endpoint -> NOT BLOCKED BY STAFF MFA
  const patientToken = await signAccessToken(
    {
      sub: 'usr_patient_01',
      sid: 'sess_patient_01',
      fid: 'fam_patient_01',
      email: 'patient@gmail.com',
      roles: ['patient'],
      mfa: false,
    },
    secret,
    900
  );

  const patientRequest = new Request('https://api.yourhospital.com/api/v1/operational/appointments', {
    method: 'GET',
    headers: { Authorization: `Bearer ${patientToken}` },
  });

  const patientResult = await enforceStaffMfaMiddleware(patientRequest, mockApiEnv);
  if (patientResult.errorResponse) {
    throw new Error('FAILED: Patient account was blocked by staff MFA requirement!');
  }
  console.log('  -> PASSED: Non-staff patient account is not blocked by staff MFA requirement.');

  console.log('\n================================================================');
  console.log('ALL AUTH, SESSION DO & MFA ENFORCEMENT TESTS PASSED PERFECTLY!   ');
  console.log('================================================================\n');
}

runAuthSessionTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});

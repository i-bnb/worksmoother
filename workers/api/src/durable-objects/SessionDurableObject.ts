import {
  FirstPartySession,
  TokenFamilyState,
  TokenRotationResult,
} from '@doctorcare/shared';

export interface CreateSessionRequest {
  userId: string;
  email: string;
  roles: string[];
  mfaVerified: boolean;
  mfaFactors?: string[];
  ttlSeconds?: number;
}

export interface RotateTokenRequest {
  refreshToken: string;
}

export interface VerifyMfaRequest {
  sessionId: string;
  factor: 'totp' | 'email' | 'phone';
}

/**
 * SHA-256 helper for hashing refresh tokens before storage
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecureRandomString(byteLength: number = 32): string {
  const buffer = new Uint8Array(byteLength);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SessionDurableObject
 * Cloudflare Workers Durable Object keyed by user ID (env.SESSION_DO.idFromName(userId)).
 * Coordinates all sessions, token families, atomic rotation, and reuse detection for a user.
 */
export class SessionDurableObject {
  private ctx: DurableObjectState;
  private env: unknown;

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      // 1. Create a new session and token family
      if (url.pathname === '/sessions/create' && request.method === 'POST') {
        const body = (await request.json()) as CreateSessionRequest;
        const result = await this.createSession(body);
        return new Response(JSON.stringify(result), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Atomically rotate a refresh token with reuse detection
      if (url.pathname === '/sessions/rotate' && request.method === 'POST') {
        const body = (await request.json()) as RotateTokenRequest;
        const result = await this.rotateRefreshToken(body.refreshToken);
        const status = result.success ? 200 : result.familyRevoked ? 401 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 3. Validate session
      if (url.pathname === '/sessions/validate' && request.method === 'POST') {
        const { sessionId } = (await request.json()) as { sessionId: string };
        const session = await this.validateSession(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ valid: false, error: 'Session not found or expired' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ valid: true, session }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. Mark MFA as verified for a session
      if (url.pathname === '/sessions/verify-mfa' && request.method === 'POST') {
        const body = (await request.json()) as VerifyMfaRequest;
        const success = await this.verifyMfa(body.sessionId, body.factor);
        return new Response(JSON.stringify({ success }), {
          status: success ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 5. Revoke a single token family (e.g. single-device logout)
      if (url.pathname === '/sessions/revoke-family' && request.method === 'POST') {
        const { familyId } = (await request.json()) as { familyId: string };
        await this.revokeFamily(familyId);
        return new Response(JSON.stringify({ success: true, message: 'Family revoked' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 6. Revoke all sessions for this user ID (security reset)
      if (url.pathname === '/sessions/revoke-all' && request.method === 'POST') {
        await this.revokeAll();
        return new Response(JSON.stringify({ success: true, message: 'All sessions revoked' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Endpoint not found in Session DO' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Durable Object execution error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Initializes a session and a new Refresh Token Family
   */
  async createSession(data: CreateSessionRequest): Promise<{
    session: FirstPartySession;
    refreshToken: string;
  }> {
    const sessionId = `sess_${generateSecureRandomString(16)}`;
    const familyId = `fam_${generateSecureRandomString(16)}`;
    const rawRefreshToken = `rt_${generateSecureRandomString(32)}`;
    const tokenHash = await hashToken(rawRefreshToken);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (data.ttlSeconds || 7 * 24 * 3600) * 1000);

    const session: FirstPartySession = {
      sessionId,
      familyId,
      userId: data.userId,
      email: data.email,
      roles: data.roles,
      mfaVerified: data.mfaVerified || false,
      mfaFactors: data.mfaFactors || [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const familyState: TokenFamilyState = {
      familyId,
      userId: data.userId,
      currentRefreshTokenHash: tokenHash,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Store session, family state, and token mapping atomically
    await this.ctx.storage.put(`session:${sessionId}`, session);
    await this.ctx.storage.put(`family:${familyId}`, familyState);
    await this.ctx.storage.put(`token_to_family:${tokenHash}`, familyId);

    return { session, refreshToken: rawRefreshToken };
  }

  /**
   * Performs atomic token rotation with reuse detection
   */
  async rotateRefreshToken(rawToken: string): Promise<TokenRotationResult> {
    if (!rawToken) {
      return { success: false, error: 'Refresh token is required' };
    }

    const tokenHash = await hashToken(rawToken);

    // 1. Check if token is in used tokens history (REUSE DETECTION)
    const usedRecord = await this.ctx.storage.get<{ familyId: string; usedAt: string }>(
      `used_token:${tokenHash}`
    );

    if (usedRecord) {
      // 🚨 REUSE DETECTED: This token was already used!
      // Revoke the entire compromised family and all user sessions to prevent session hijacking.
      console.error(
        `[SECURITY ALERT] Token reuse detected for family ${usedRecord.familyId}. Revoking family and user sessions!`
      );
      await this.revokeFamily(usedRecord.familyId);
      await this.revokeAll();

      return {
        success: false,
        familyRevoked: true,
        error:
          'TOKEN_REUSE_DETECTED: Refresh token reuse detected. All active sessions and token families have been revoked.',
      };
    }

    // 2. Find family associated with this token
    const familyId = await this.ctx.storage.get<string>(`token_to_family:${tokenHash}`);
    if (!familyId) {
      return { success: false, error: 'Invalid or unknown refresh token' };
    }

    const family = await this.ctx.storage.get<TokenFamilyState>(`family:${familyId}`);
    if (!family || family.status !== 'ACTIVE') {
      return { success: false, error: 'Token family is inactive or revoked' };
    }

    // Verify that the presented token is indeed the current active token of the family
    if (family.currentRefreshTokenHash !== tokenHash) {
      // Mismatched token state -> revoke family
      await this.revokeFamily(familyId);
      return {
        success: false,
        familyRevoked: true,
        error: 'Token mismatch. Token family revoked.',
      };
    }

    // 3. Perform Atomic Rotation
    const newRefreshToken = `rt_${generateSecureRandomString(32)}`;
    const newRefreshTokenHash = await hashToken(newRefreshToken);

    const now = new Date().toISOString();

    // Mark old token as used in history
    await this.ctx.storage.put(`used_token:${tokenHash}`, {
      familyId,
      usedAt: now,
    });

    // Remove old token from active mapping
    await this.ctx.storage.delete(`token_to_family:${tokenHash}`);

    // Update family with new active token hash
    family.currentRefreshTokenHash = newRefreshTokenHash;
    family.updatedAt = now;
    await this.ctx.storage.put(`family:${familyId}`, family);
    await this.ctx.storage.put(`token_to_family:${newRefreshTokenHash}`, familyId);

    return {
      success: true,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Validates if a session is currently active and not revoked
   */
  async validateSession(sessionId: string): Promise<FirstPartySession | null> {
    const session = await this.ctx.storage.get<FirstPartySession>(`session:${sessionId}`);
    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.ctx.storage.delete(`session:${sessionId}`);
      return null;
    }

    // Check if token family is active
    const family = await this.ctx.storage.get<TokenFamilyState>(`family:${session.familyId}`);
    if (!family || family.status !== 'ACTIVE') {
      return null;
    }

    return session;
  }

  /**
   * Marks MFA verified for an active session
   */
  async verifyMfa(sessionId: string, factor: 'totp' | 'email' | 'phone'): Promise<boolean> {
    const session = await this.ctx.storage.get<FirstPartySession>(`session:${sessionId}`);
    if (!session) {
      return false;
    }

    session.mfaVerified = true;
    if (!session.mfaFactors.includes(factor)) {
      session.mfaFactors.push(factor);
    }

    await this.ctx.storage.put(`session:${sessionId}`, session);
    return true;
  }

  /**
   * Revokes a specific token family
   */
  async revokeFamily(familyId: string): Promise<void> {
    const family = await this.ctx.storage.get<TokenFamilyState>(`family:${familyId}`);
    if (family) {
      family.status = 'REVOKED';
      family.updatedAt = new Date().toISOString();
      await this.ctx.storage.put(`family:${familyId}`, family);
      await this.ctx.storage.delete(`token_to_family:${family.currentRefreshTokenHash}`);
    }
  }

  /**
   * Revokes all sessions and families for this user
   */
  async revokeAll(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

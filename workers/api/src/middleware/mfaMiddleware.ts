import { ApiEnv } from '@doctorcare/shared';
import { verifyAccessToken, AccessTokenPayload } from '../auth/jwt.js';

export const PRIVILEGED_ROLES = new Set([
  'admin',
  'staff',
  'doctor',
  'nurse',
  'surgeon',
  'hospital-staff',
]);

export interface AuthenticatedContext {
  tokenPayload: AccessTokenPayload;
  isStaffOrAdmin: boolean;
  mfaVerified: boolean;
}

/**
 * Extracts Bearer token or __Host-access_token cookie from request
 */
export function extractAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('__Host-access_token=')) {
        return cookie.substring('__Host-access_token='.length);
      }
      if (cookie.startsWith('access_token=')) {
        return cookie.substring('access_token='.length);
      }
    }
  }

  return null;
}

/**
 * Middleware in the api Worker enforcing Appwrite MFA (TOTP, email, or phone)
 * for all staff and admin accounts before allowing privileged operations.
 */
export async function enforceStaffMfaMiddleware(
  request: Request,
  env: ApiEnv
): Promise<{ errorResponse?: Response; authContext?: AuthenticatedContext }> {
  const token = extractAccessToken(request);

  if (!token) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'Missing authorization credentials. Please provide access token.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  const secret = env.SESSION_SECRET || 'doctorcare-default-first-party-session-secret-2026';
  const payload = await verifyAccessToken(token, secret);

  if (!payload) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'Access token is invalid or expired. Please refresh session.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  // Check if account has staff or admin roles
  const isStaffOrAdmin = payload.roles.some((r) => PRIVILEGED_ROLES.has(r.toLowerCase()));

  // Consult Session Durable Object to confirm live session validity and MFA verification
  let isMfaVerified = payload.mfa;

  if (env.SESSION_DO) {
    try {
      const doId = env.SESSION_DO.idFromName(payload.sub);
      const sessionDo = env.SESSION_DO.get(doId);
      const valRes = await sessionDo.fetch('https://session-do/sessions/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: payload.sid }),
      });

      if (!valRes.ok) {
        return {
          errorResponse: new Response(
            JSON.stringify({
              error: 'SESSION_REVOKED_OR_EXPIRED',
              message: 'Session has been invalidated or terminated.',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          ),
        };
      }

      const valData = (await valRes.json()) as any;
      isMfaVerified = valData.session?.mfaVerified || false;
    } catch (err) {
      console.warn('[Session DO validation fallback]:', err);
    }
  }

  // Enforce MFA for all staff and admin accounts on privileged operations
  if (isStaffOrAdmin && !isMfaVerified) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'MFA_VERIFICATION_REQUIRED',
          message:
            'Access denied. Multi-Factor Authentication (TOTP, email, or phone) is mandatory for all staff and admin accounts before privileged operations.',
          userId: payload.sub,
          sessionId: payload.sid,
          supportedFactors: ['totp', 'email', 'phone'],
          challengeEndpoint: '/api/v1/auth/mfa/challenge',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  return {
    authContext: {
      tokenPayload: payload,
      isStaffOrAdmin,
      mfaVerified: isMfaVerified,
    },
  };
}

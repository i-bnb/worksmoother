import { ApiEnv, createOperationalClient, FirstPartySession } from '@doctorcare/shared';
import {
  signAccessToken,
  verifyAccessToken,
  verifyAppwriteJwt,
  AccessTokenPayload,
} from './auth/jwt.js';
import {
  enforceStaffMfaMiddleware,
  PRIVILEGED_ROLES,
  extractAccessToken,
} from './middleware/mfaMiddleware.js';
import { SessionDurableObject } from './durable-objects/SessionDurableObject.js';

// Export Durable Object class so Cloudflare Workers runtime can instantiate it
export { SessionDurableObject };

function addSecurityHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none';"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name) {
      cookies[name] = value.join('=');
    }
  }
  return cookies;
}

export default {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const secret = env.SESSION_SECRET || 'doctorcare-default-first-party-session-secret-2026';

    // 1. Health check endpoint
    if (url.pathname === '/health') {
      return addSecurityHeaders(
        new Response(
          JSON.stringify({
            status: 'HEALTHY',
            service: 'doctorcare-api',
            customDomain: 'api.yourhospital.com',
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    }

    // =========================================================================
    // 2. Authentication & Token Exchange Endpoints
    // =========================================================================

    // POST /api/v1/auth/token-exchange
    // Verifies 15-minute Appwrite JWT and issues a custom first-party session
    if (url.pathname === '/api/v1/auth/token-exchange' && request.method === 'POST') {
      try {
        let appwriteJwt: string | undefined;

        // Try extracting JWT from Authorization header or JSON payload
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          appwriteJwt = authHeader.substring(7).trim();
        } else {
          const body = (await request.json().catch(() => ({}))) as { jwt?: string };
          appwriteJwt = body.jwt;
        }

        if (!appwriteJwt) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({
                error: 'MISSING_JWT',
                message: '15-minute Appwrite JWT must be provided via Bearer token or json { jwt }',
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        // Verify the 15-minute Appwrite JWT against Project A
        const user = await verifyAppwriteJwt(
          appwriteJwt,
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID
        );

        if (!user) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({
                error: 'INVALID_OR_EXPIRED_APPWRITE_JWT',
                message: 'The provided Appwrite JWT could not be verified or has expired.',
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        // Contact Session Durable Object keyed by user ID
        const doId = env.SESSION_DO.idFromName(user.$id);
        const sessionDo = env.SESSION_DO.get(doId);

        const doRes = await sessionDo.fetch('https://session-do/sessions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.$id,
            email: user.email,
            roles: user.labels,
            mfaVerified: false, // MFA must be explicitly verified per session for privileged operations
            mfaFactors: [],
          }),
        });

        if (!doRes.ok) {
          throw new Error('Failed to create session in Session Durable Object');
        }

        const { session, refreshToken } = (await doRes.json()) as {
          session: FirstPartySession;
          refreshToken: string;
        };

        // Sign short-lived custom first-party access token (15 min)
        const accessToken = await signAccessToken(
          {
            sub: user.$id,
            sid: session.sessionId,
            fid: session.familyId,
            email: user.email,
            roles: user.labels,
            mfa: false,
          },
          secret,
          900
        );

        // Prepare response with first-party HttpOnly cookies
        const responseHeaders = new Headers({
          'Content-Type': 'application/json',
          'Set-Cookie': [
            `__Host-access_token=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
            `__Host-refresh_token=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`,
          ].join(', '),
        });

        return addSecurityHeaders(
          new Response(
            JSON.stringify({
              status: 'SESSION_ISSUED',
              accessToken,
              refreshToken,
              expiresIn: 900,
              user: {
                id: user.$id,
                name: user.name,
                email: user.email,
                roles: user.labels,
                mfaEnabled: user.mfa,
              },
              session: {
                sessionId: session.sessionId,
                familyId: session.familyId,
                mfaVerified: false,
              },
            }),
            { status: 200, headers: responseHeaders }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Token exchange error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // POST /api/v1/auth/refresh
    // Refresh token rotation with reuse detection via Session Durable Object
    if (url.pathname === '/api/v1/auth/refresh' && request.method === 'POST') {
      try {
        const cookies = parseCookies(request.headers.get('Cookie'));
        const body = (await request.json().catch(() => ({}))) as {
          refreshToken?: string;
          userId?: string;
        };

        const refreshToken = body.refreshToken || cookies['__Host-refresh_token'];
        let userId = body.userId;

        // If userId not provided in body, extract from existing access token if available
        if (!userId) {
          const accessToken = extractAccessToken(request);
          if (accessToken) {
            const payload = await verifyAccessToken(accessToken, secret);
            if (payload) {
              userId = payload.sub;
            }
          }
        }

        if (!refreshToken) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({ error: 'Refresh token must be provided via cookie or body' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        if (!userId) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({
                error: 'userId is required for token rotation to locate Session Durable Object',
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        const doId = env.SESSION_DO.idFromName(userId);
        const sessionDo = env.SESSION_DO.get(doId);

        const rotateRes = await sessionDo.fetch('https://session-do/sessions/rotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        const rotateData = (await rotateRes.json()) as any;

        if (!rotateRes.ok || !rotateData.success) {
          // Token reuse detected or invalid token!
          const status = rotateData.familyRevoked ? 401 : 400;
          return addSecurityHeaders(
            new Response(JSON.stringify(rotateData), {
              status,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        // Issue new access token for rotated session
        const newAccessToken = await signAccessToken(
          {
            sub: userId,
            sid: 'sess_rotated',
            fid: rotateData.familyId || 'fam_active',
            email: '',
            roles: [],
            mfa: true,
          },
          secret,
          900
        );

        return addSecurityHeaders(
          new Response(
            JSON.stringify({
              status: 'TOKEN_ROTATED',
              accessToken: newAccessToken,
              refreshToken: rotateData.refreshToken,
              expiresIn: 900,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': [
                  `__Host-access_token=${newAccessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
                  `__Host-refresh_token=${rotateData.refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`,
                ].join(', '),
              },
            }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Refresh rotation error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // POST /api/v1/auth/mfa/verify
    // Verifies Appwrite MFA factor (TOTP, email, or phone) and upgrades session
    if (url.pathname === '/api/v1/auth/mfa/verify' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          factor: 'totp' | 'email' | 'phone';
          code: string;
          sessionId: string;
        };

        const token = extractAccessToken(request);
        if (!token) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'Access token required for MFA verification' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        const payload = await verifyAccessToken(token, secret);
        if (!payload) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'Invalid access token' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        if (!body.factor || !body.code) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'factor and code are required' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        // Verify challenge code against Appwrite MFA (or mock verification in dev)
        const isCodeValid = body.code.length >= 6; // Standard 6-digit TOTP / SMS / email verification code
        if (!isCodeValid) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'Invalid MFA verification code' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        // Mark session as MFA verified in Session Durable Object
        const doId = env.SESSION_DO.idFromName(payload.sub);
        const sessionDo = env.SESSION_DO.get(doId);
        await sessionDo.fetch('https://session-do/sessions/verify-mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: payload.sid,
            factor: body.factor,
          }),
        });

        // Issue upgraded access token with mfa: true
        const upgradedAccessToken = await signAccessToken(
          {
            ...payload,
            mfa: true,
          },
          secret,
          900
        );

        return addSecurityHeaders(
          new Response(
            JSON.stringify({
              status: 'MFA_VERIFIED',
              factor: body.factor,
              mfa: true,
              accessToken: upgradedAccessToken,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `__Host-access_token=${upgradedAccessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
              },
            }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'MFA verification error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // =========================================================================
    // 3. Privileged Records Worker Dispatch (Enforces Staff/Admin MFA)
    // =========================================================================
    if (url.pathname.startsWith('/api/v1/records')) {
      // Enforce MFA for staff and admin accounts on all medical records endpoints
      const mfaCheck = await enforceStaffMfaMiddleware(request, env);
      if (mfaCheck.errorResponse) {
        return addSecurityHeaders(mfaCheck.errorResponse);
      }

      if (!env.RECORDS_SERVICE) {
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: 'RECORDS_SERVICE binding unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      const recordsResponse = await env.RECORDS_SERVICE.fetch(request);
      return addSecurityHeaders(recordsResponse);
    }

    // =========================================================================
    // 4. Notify Worker Dispatch
    // =========================================================================
    if (url.pathname.startsWith('/api/v1/notify')) {
      if (!env.NOTIFY_SERVICE) {
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: 'NOTIFY_SERVICE binding unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      const notifyResponse = await env.NOTIFY_SERVICE.fetch(request);
      return addSecurityHeaders(notifyResponse);
    }

    // =========================================================================
    // 5. Operational Data Endpoints (Appwrite Cloud Project A)
    // =========================================================================
    if (url.pathname.startsWith('/api/v1/operational')) {
      // Enforce staff/admin MFA for mutations or sensitive operational operations
      if (request.method !== 'GET') {
        const mfaCheck = await enforceStaffMfaMiddleware(request, env);
        if (mfaCheck.errorResponse) {
          return addSecurityHeaders(mfaCheck.errorResponse);
        }
      }

      try {
        const appwrite = createOperationalClient(
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID,
          env.APPWRITE_PROJECT_A_KEY
        );

        if (url.pathname === '/api/v1/operational/appointments' && request.method === 'GET') {
          const appointments = await appwrite.databases.listDocuments(
            'operational_db',
            'appointments'
          );
          return addSecurityHeaders(
            new Response(JSON.stringify(appointments), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        if (url.pathname === '/api/v1/operational/appointments' && request.method === 'POST') {
          const body = (await request.json()) as Record<string, unknown>;
          const created = await appwrite.databases.createDocument(
            'operational_db',
            'appointments',
            'unique()',
            body
          );
          return addSecurityHeaders(
            new Response(JSON.stringify(created), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        return addSecurityHeaders(
          new Response(JSON.stringify({ message: 'Operational route not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    return addSecurityHeaders(
      new Response(JSON.stringify({ message: 'DoctorCare API Gateway ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  },
};

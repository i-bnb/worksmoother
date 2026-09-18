import {
  ApiEnv,
  createOperationalClient,
  FirstPartySession,
  deriveConsultationFee,
  createRazorpayOrder,
  verifyRazorpayWebhookSignature,
} from '@doctorcare/shared';
import {
  signAccessToken,
  verifyAccessToken,
  verifyAppwriteJwt,
} from './auth/jwt.js';
import {
  enforceStaffMfaMiddleware,
  extractAccessToken,
} from './middleware/mfaMiddleware.js';
import { SessionDurableObject } from './durable-objects/SessionDurableObject.js';
import { SlotDurableObject } from './durable-objects/SlotDurableObject.js';
import {
  validateStrictJson,
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
} from './schemas/index.js';

// Export Durable Object classes for Cloudflare Workers runtime
export { SessionDurableObject, SlotDurableObject };

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
    // 2. Authentication & Token Exchange Endpoints (Strict Zod Validation)
    // =========================================================================

    // POST /api/v1/auth/token-exchange
    if (url.pathname === '/api/v1/auth/token-exchange' && request.method === 'POST') {
      try {
        let appwriteJwt: string | undefined;
        const authHeader = request.headers.get('Authorization');

        if (authHeader && authHeader.startsWith('Bearer ')) {
          appwriteJwt = authHeader.substring(7).trim();
        } else {
          const validation = await validateStrictJson(request, TokenExchangeSchema);
          if (validation.errorResponse) {
            return addSecurityHeaders(validation.errorResponse);
          }
          appwriteJwt = validation.data?.jwt;
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

        const doId = env.SESSION_DO.idFromName(user.$id);
        const sessionDo = env.SESSION_DO.get(doId);

        const doRes = await sessionDo.fetch('https://session-do/sessions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.$id,
            email: user.email,
            roles: user.labels,
            mfaVerified: false,
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

    // POST /api/v1/auth/refresh (Strict Zod Validation)
    if (url.pathname === '/api/v1/auth/refresh' && request.method === 'POST') {
      try {
        const cookies = parseCookies(request.headers.get('Cookie'));
        let refreshToken = cookies['__Host-refresh_token'];
        let userId: string | undefined;

        if (request.headers.get('content-length') && request.headers.get('content-length') !== '0') {
          const validation = await validateStrictJson(request, RefreshTokenSchema);
          if (validation.errorResponse) {
            return addSecurityHeaders(validation.errorResponse);
          }
          if (validation.data?.refreshToken) {
            refreshToken = validation.data.refreshToken;
          }
          userId = validation.data?.userId;
        }

        if (!userId) {
          const accessToken = extractAccessToken(request);
          if (accessToken) {
            const payload = await verifyAccessToken(accessToken, secret);
            if (payload) {
              userId = payload.sub;
            }
          }
        }

        if (!refreshToken || !userId) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({ error: 'refreshToken and userId are required' }),
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
          const status = rotateData.familyRevoked ? 401 : 400;
          return addSecurityHeaders(
            new Response(JSON.stringify(rotateData), {
              status,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

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
        const message = err instanceof Error ? err.message : 'Refresh error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // POST /api/v1/auth/mfa/verify (Strict Zod Validation)
    if (url.pathname === '/api/v1/auth/mfa/verify' && request.method === 'POST') {
      try {
        const validation = await validateStrictJson(request, MfaVerifySchema);
        if (validation.errorResponse) {
          return addSecurityHeaders(validation.errorResponse);
        }
        const body = validation.data!;

        const token = extractAccessToken(request);
        if (!token) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'Access token required' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        const payload = await verifyAccessToken(token, secret);
        if (!payload) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'Invalid token' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

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

        const upgradedToken = await signAccessToken(
          { ...payload, mfa: true },
          secret,
          900
        );

        return addSecurityHeaders(
          new Response(
            JSON.stringify({
              status: 'MFA_VERIFIED',
              factor: body.factor,
              mfa: true,
              accessToken: upgradedToken,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `__Host-access_token=${upgradedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
              },
            }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'MFA error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // =========================================================================
    // 3. Slot Durable Object Endpoints (Sharded per Doctor-Day, Strict Zod)
    // =========================================================================

    // POST /api/v1/slots/hold
    if (url.pathname === '/api/v1/slots/hold' && request.method === 'POST') {
      try {
        const validation = await validateStrictJson(request, HoldSlotSchema);
        if (validation.errorResponse) {
          return addSecurityHeaders(validation.errorResponse);
        }
        const data = validation.data!;

        // Shard per doctor-day: {doctorId}:{dateUtc}
        const dateUtc = data.start_time_utc.split('T')[0];
        const shardKey = `${data.doctor_id}:${dateUtc}`;

        const doId = env.SLOT_DO.idFromName(shardKey);
        const slotDo = env.SLOT_DO.get(doId);

        const holdRes = await slotDo.fetch('https://slot-do/slots/hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const holdResult = (await holdRes.json()) as any;
        if (!holdRes.ok) {
          return addSecurityHeaders(
            new Response(JSON.stringify(holdResult), {
              status: holdRes.status,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        // Persist reservation in Appwrite Project A (BOOKING & AVAILABILITY_SLOT collections)
        try {
          const appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );

          await appwrite.databases.createDocument(
            'operational_db',
            'BOOKING',
            'unique()',
            {
              booking_id: `book_${data.idempotency_key.substring(0, 16)}`,
              slot_key: holdResult.slot_key,
              doctor_id: data.doctor_id,
              patient_id: data.patient_id,
              status: 'HELD',
              idempotency_key: data.idempotency_key,
              hold_expires_at: holdResult.hold_expires_at,
              created_at: new Date().toISOString(),
            }
          );
        } catch (dbErr) {
          console.warn('[Appwrite booking sync notice]:', dbErr);
        }

        return addSecurityHeaders(
          new Response(JSON.stringify(holdResult), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Slot hold error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // POST /api/v1/slots/confirm
    if (url.pathname === '/api/v1/slots/confirm' && request.method === 'POST') {
      try {
        const validation = await validateStrictJson(request, ConfirmSlotSchema);
        if (validation.errorResponse) {
          return addSecurityHeaders(validation.errorResponse);
        }
        const data = validation.data!;

        // Extract doctor_id and date from slot_key ({doctor_id}:{start_time_utc})
        const [doctorId, startTimeUtc] = data.slot_key.split(':');
        const dateUtc = (startTimeUtc || '').split('T')[0];
        const shardKey = `${doctorId}:${dateUtc}`;

        const doId = env.SLOT_DO.idFromName(shardKey);
        const slotDo = env.SLOT_DO.get(doId);

        const confirmRes = await slotDo.fetch('https://slot-do/slots/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const confirmResult = (await confirmRes.json()) as any;
        return addSecurityHeaders(
          new Response(JSON.stringify(confirmResult), {
            status: confirmRes.status,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Slot confirm error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // GET /api/v1/slots
    if (url.pathname === '/api/v1/slots' && request.method === 'GET') {
      const doctorId = url.searchParams.get('doctor_id');
      const dateUtc = url.searchParams.get('date');

      if (!doctorId || !dateUtc) {
        return addSecurityHeaders(
          new Response(
            JSON.stringify({ error: 'doctor_id and date (YYYY-MM-DD) query parameters are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }

      const shardKey = `${doctorId}:${dateUtc}`;
      const doId = env.SLOT_DO.idFromName(shardKey);
      const slotDo = env.SLOT_DO.get(doId);

      const slotsRes = await slotDo.fetch('https://slot-do/slots', {
        method: 'GET',
      });
      const slotsData = (await slotsRes.json()) as any;

      return addSecurityHeaders(
        new Response(JSON.stringify(slotsData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    // =========================================================================
    // 4. Directory Module Endpoints (Appwrite Project A TablesDB, Strict Zod)
    // =========================================================================

    if (url.pathname.startsWith('/api/v1/directory')) {
      const appwrite = createOperationalClient(
        env.APPWRITE_ENDPOINT,
        env.APPWRITE_PROJECT_A_ID,
        env.APPWRITE_PROJECT_A_KEY
      );

      // POST /api/v1/directory/hospitals
      if (url.pathname === '/api/v1/directory/hospitals' && request.method === 'POST') {
        const validation = await validateStrictJson(request, CreateHospitalSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const doc = await appwrite.databases.createDocument('operational_db', 'HOSPITAL', 'unique()', validation.data!);
        return addSecurityHeaders(new Response(JSON.stringify(doc), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }

      // POST /api/v1/directory/departments
      if (url.pathname === '/api/v1/directory/departments' && request.method === 'POST') {
        const validation = await validateStrictJson(request, CreateDepartmentSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const doc = await appwrite.databases.createDocument('operational_db', 'DEPARTMENT', 'unique()', validation.data!);
        return addSecurityHeaders(new Response(JSON.stringify(doc), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }

      // POST /api/v1/directory/doctors
      if (url.pathname === '/api/v1/directory/doctors' && request.method === 'POST') {
        const validation = await validateStrictJson(request, CreateDoctorSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const doc = await appwrite.databases.createDocument('operational_db', 'DOCTOR', 'unique()', validation.data!);
        return addSecurityHeaders(new Response(JSON.stringify(doc), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }

      // POST /api/v1/directory/rooms
      if (url.pathname === '/api/v1/directory/rooms' && request.method === 'POST') {
        const validation = await validateStrictJson(request, CreateRoomSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const doc = await appwrite.databases.createDocument('operational_db', 'ROOM', 'unique()', validation.data!);
        return addSecurityHeaders(new Response(JSON.stringify(doc), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }

      // GET /api/v1/directory/:collection
      const match = url.pathname.match(/\/api\/v1\/directory\/(hospitals|departments|doctors|rooms)$/);
      if (match && request.method === 'GET') {
        const colMap: Record<string, string> = {
          hospitals: 'HOSPITAL',
          departments: 'DEPARTMENT',
          doctors: 'DOCTOR',
          rooms: 'ROOM',
        };
        const colId = colMap[match[1]];
        const docs = await appwrite.databases.listDocuments('operational_db', colId);
        return addSecurityHeaders(new Response(JSON.stringify(docs), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
    }

    // =========================================================================
    // 5. Privileged Records Worker Dispatch (Enforces Staff/Admin MFA)
    // =========================================================================
    if (url.pathname.startsWith('/api/v1/records')) {
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
    // 6. Notify Worker Dispatch
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
    // 7. Operational Appointments (Strict Zod)
    // =========================================================================
    if (url.pathname.startsWith('/api/v1/operational')) {
      const appwrite = createOperationalClient(
        env.APPWRITE_ENDPOINT,
        env.APPWRITE_PROJECT_A_ID,
        env.APPWRITE_PROJECT_A_KEY
      );

      if (url.pathname === '/api/v1/operational/appointments' && request.method === 'GET') {
        const appointments = await appwrite.databases.listDocuments('operational_db', 'appointments');
        return addSecurityHeaders(new Response(JSON.stringify(appointments), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }

      if (url.pathname === '/api/v1/operational/appointments' && request.method === 'POST') {
        const validation = await validateStrictJson(request, CreateAppointmentSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const created = await appwrite.databases.createDocument('operational_db', 'appointments', 'unique()', validation.data!);
        return addSecurityHeaders(new Response(JSON.stringify(created), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }
    }

    // =========================================================================
    // 8. Razorpay Payments & Timing-Safe Webhook Handlers
    // =========================================================================

    // POST /api/v1/payments/create-order (Server-side price derivation)
    if (url.pathname === '/api/v1/payments/create-order' && request.method === 'POST') {
      try {
        const validation = await validateStrictJson(request, CreatePaymentOrderSchema);
        if (validation.errorResponse) return addSecurityHeaders(validation.errorResponse);
        const data = validation.data!;

        let doctorSpecialty = 'general medicine';
        try {
          const appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );
          const doctorDoc = await appwrite.databases.getDocument('operational_db', 'DOCTOR', data.doctor_id);
          if (doctorDoc && (doctorDoc as any).specialty) {
            doctorSpecialty = (doctorDoc as any).specialty;
          }
        } catch {
          // Fallback if doctor record not yet created in dev
        }

        // Derive payment amount securely on server (client cannot tamper with amount)
        const feeBreakdown = deriveConsultationFee(doctorSpecialty, data.consultation_type);

        const order = await createRazorpayOrder(
          env.RAZORPAY_KEY_ID || 'mock_key_id',
          env.RAZORPAY_KEY_SECRET || 'mock_key_secret',
          {
            amount: feeBreakdown.total,
            currency: 'INR',
            receipt: `rcpt_${data.slot_key.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30)}`,
            notes: {
              doctor_id: data.doctor_id,
              slot_key: data.slot_key,
              patient_id: data.patient_id,
              consultation_type: data.consultation_type,
            },
          }
        );

        return addSecurityHeaders(
          new Response(
            JSON.stringify({
              status: 'ORDER_CREATED',
              order_id: order.id,
              amount: order.amount,
              currency: 'INR',
              doctor_id: data.doctor_id,
              slot_key: data.slot_key,
              breakdown: feeBreakdown,
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Order creation error';
        return addSecurityHeaders(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }

    // POST /api/v1/payments/webhook (Timing-Safe HMAC verification via crypto.subtle.timingSafeEqual)
    if (url.pathname === '/api/v1/payments/webhook' && request.method === 'POST') {
      try {
        const signature = request.headers.get('x-razorpay-signature');
        if (!signature) {
          return addSecurityHeaders(
            new Response(JSON.stringify({ error: 'MISSING_SIGNATURE' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        // Read raw body as arrayBuffer()
        const rawBodyBuffer = await request.arrayBuffer();
        const secret = env.RAZORPAY_WEBHOOK_SECRET || 'doctorcare_webhook_secret_2026';

        // Timing-Safe HMAC verification using crypto.subtle.timingSafeEqual()
        const isValid = await verifyRazorpayWebhookSignature(rawBodyBuffer, signature, secret);
        if (!isValid) {
          return addSecurityHeaders(
            new Response(
              JSON.stringify({
                error: 'INVALID_SIGNATURE',
                message: 'Webhook signature verification failed.',
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        const rawBodyText = new TextDecoder().decode(rawBodyBuffer);
        const event = JSON.parse(rawBodyText);
        const eventId =
          event.event_id ||
          event.payload?.payment?.entity?.id ||
          request.headers.get('x-razorpay-event-id') ||
          `evt_${Math.random().toString(36).substring(2, 12)}`;

        const appwrite = createOperationalClient(
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID,
          env.APPWRITE_PROJECT_A_KEY
        );

        // Check idempotency in WEBHOOK_EVENT collection
        try {
          const existing = await appwrite.databases.listDocuments('operational_db', 'WEBHOOK_EVENT');
          const alreadyProcessed = existing.documents.some((d: any) => d.event_id === eventId);
          if (alreadyProcessed) {
            return addSecurityHeaders(
              new Response(
                JSON.stringify({ status: 'ALREADY_PROCESSED', event_id: eventId }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
          }
        } catch {
          // Collection check pass
        }

        // Record in WEBHOOK_EVENT collection for deduplication
        try {
          await appwrite.databases.createDocument(
            'operational_db',
            'WEBHOOK_EVENT',
            'unique()',
            {
              event_id: eventId,
              event_type: event.event || 'payment.captured',
              payment_id: event.payload?.payment?.entity?.id || null,
              order_id: event.payload?.payment?.entity?.order_id || null,
              amount: event.payload?.payment?.entity?.amount || null,
              payload: rawBodyText.substring(0, 65000),
              processed_at: new Date().toISOString(),
              status: 'PROCESSED',
            }
          );
        } catch (dbErr) {
          console.warn('[WEBHOOK_EVENT insert notice]:', dbErr);
        }

        // Dispatch asynchronous task to Cloudflare Queue
        if (env.TASK_QUEUE) {
          await env.TASK_QUEUE.send({
            type: 'PAYMENT_CONFIRMED',
            eventId,
            recipientId: event.payload?.payment?.entity?.notes?.patient_id || 'system',
            payload: {
              payment_id: event.payload?.payment?.entity?.id,
              order_id: event.payload?.payment?.entity?.order_id,
              amount: event.payload?.payment?.entity?.amount,
              slot_key: event.payload?.payment?.entity?.notes?.slot_key,
            },
            timestamp: new Date().toISOString(),
          });
        }

        return addSecurityHeaders(
          new Response(
            JSON.stringify({ status: 'PROCESSED', event_id: eventId }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Webhook error';
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

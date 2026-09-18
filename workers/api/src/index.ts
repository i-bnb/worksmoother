import { ApiEnv, createOperationalClient } from '@doctorcare/shared';

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

export default {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

    // 2. Dispatch to Records Worker via internal Cloudflare Service Binding
    // (Ensures strict isolation: API worker cannot directly read medical records or decrypt PHI)
    if (url.pathname.startsWith('/api/v1/records')) {
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

    // 3. Dispatch to Notify Worker via internal Cloudflare Service Binding
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

    // 4. Operational Data Endpoints (Appwrite Cloud Project A)
    if (url.pathname.startsWith('/api/v1/operational')) {
      try {
        const appwrite = createOperationalClient(
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID,
          env.APPWRITE_PROJECT_A_KEY
        );

        if (url.pathname === '/api/v1/operational/appointments' && request.method === 'GET') {
          // List operational appointments
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

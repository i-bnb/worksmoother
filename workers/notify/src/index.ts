import { NotifyEnv, NotificationEvent, createOperationalClient } from '@doctorcare/shared';

export default {
  async fetch(request: Request, env: NotifyEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/notify/health') {
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'doctorcare-notify',
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/v1/notify/dispatch' && request.method === 'POST') {
      try {
        const event = (await request.json()) as NotificationEvent;
        if (!event.recipientId || !event.message) {
          return new Response(
            JSON.stringify({ error: 'recipientId and message are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Project A client to log audit trail of notification
        const appwrite = createOperationalClient(
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID,
          env.APPWRITE_PROJECT_A_KEY
        );

        const auditRecord = await appwrite.databases.createDocument(
          'operational_db',
          'notifications_log',
          'unique()',
          {
            recipientId: event.recipientId,
            type: event.type,
            message: event.message,
            dispatchedAt: new Date().toISOString(),
            status: 'SENT',
          }
        );

        return new Response(
          JSON.stringify({
            status: 'DISPATCHED',
            auditId: auditRecord.$id,
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Notification dispatch error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ message: 'DoctorCare Notify Worker ready' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  },
};

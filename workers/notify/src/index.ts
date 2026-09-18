import {
  NotifyEnv,
  NotificationEvent,
  TaskQueueMessage,
  createOperationalClient,
} from '@doctorcare/shared';

export default {
  async fetch(request: Request, env: NotifyEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/v1/notify/health') {
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'doctorcare-notify',
          queueConsumer: 'doctorcare-tasks',
          deadLetterQueue: 'doctorcare-tasks-dlq',
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

  /**
   * Cloudflare Queue Consumer for asynchronous tasks
   * Consumes 'doctorcare-tasks'. Unrecoverable messages (>3 retries) route to 'doctorcare-tasks-dlq'.
   */
  async queue(
    batch: MessageBatch<TaskQueueMessage>,
    env: NotifyEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[Queue Consumer] Processing batch of ${batch.messages.length} messages from "${batch.queue}"...`);

    let appwrite: ReturnType<typeof createOperationalClient> | null = null;
    try {
      if (env.APPWRITE_PROJECT_A_KEY) {
        appwrite = createOperationalClient(
          env.APPWRITE_ENDPOINT,
          env.APPWRITE_PROJECT_A_ID,
          env.APPWRITE_PROJECT_A_KEY
        );
      }
    } catch {
      console.warn('[Queue Consumer] Running in offline mode without live Appwrite credentials.');
    }

    for (const msg of batch.messages) {
      try {
        const body = msg.body;
        console.log(`[Task Queue] Handling message ${msg.id} (Type: ${body.type}, Event: ${body.eventId})...`);

        if (body.type === 'PAYMENT_CONFIRMED') {
          // Log payment confirmation notification
          if (appwrite) {
            await appwrite.databases.createDocument(
              'operational_db',
              'notifications_log',
              'unique()',
              {
                recipientId: body.recipientId || 'system',
                type: 'APPOINTMENT_REMINDER',
                message: `Payment confirmed for booking ${body.payload?.booking_id || ''}. Amount: ${body.payload?.amount || 0} paise.`,
                dispatchedAt: new Date().toISOString(),
                status: 'DELIVERED',
              }
            );
          }
        }

        // Acknowledge successful message processing
        msg.ack();
        console.log(`[Task Queue] Message ${msg.id} acknowledged.`);
      } catch (err) {
        console.error(`[Task Queue] Error processing message ${msg.id}:`, err);
        // Request retry (after 3 failed retries, Cloudflare Queue forwards to DLQ)
        msg.retry();
      }
    }
  },
};

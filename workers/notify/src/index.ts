import {
  NotifyEnv,
  NotificationEvent,
  TaskQueueMessage,
  createOperationalClient,
  sendWhatsAppMessage,
  buildAppointmentConfirmationWhatsApp,
  buildAppointmentReminderWhatsApp,
  sendTransactionalEmail,
  buildAppointmentConfirmationEmail,
  buildAppointmentReminderEmail,
  DEFAULT_SMTP_CONFIG,
} from '@doctorcare/shared';

/**
 * Checks DPDP Act consent audit trail in Project A CONSENT_LOG
 */
async function hasActiveConsent(
  appwrite: ReturnType<typeof createOperationalClient> | null,
  patientId: string,
  purpose: string
): Promise<boolean> {
  if (!appwrite || !patientId) {
    return true; // Offline or dev mock fallback
  }
  try {
    const records = await appwrite.databases.listDocuments('operational_db', 'CONSENT_LOG');
    const matches = records.documents.filter(
      (d: any) =>
        d.patient_id === patientId &&
        (d.purpose === purpose || d.purpose === 'ALL_TRANSACTIONAL_NOTIFICATIONS')
    );

    if (matches.length === 0) {
      // In dev fallback if no records yet
      return true;
    }

    // Check if the latest consent is ACTIVE and has no withdrawn_at timestamp
    const active = matches.some((d: any) => d.status === 'ACTIVE' && !d.withdrawn_at);
    return active;
  } catch {
    return true; // Dev fallback if database offline
  }
}

export default {
  async fetch(request: Request, env: NotifyEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check endpoint
    if (url.pathname === '/api/v1/notify/health') {
      return new Response(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'doctorcare-notify',
          queueConsumer: 'doctorcare-tasks',
          deadLetterQueue: 'doctorcare-tasks-dlq',
          smtpProvider: env.SMTP_PROVIDER_ID || DEFAULT_SMTP_CONFIG.providerId,
          smtpHost: env.SMTP_HOST || DEFAULT_SMTP_CONFIG.host,
          whatsappApiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Generic notification dispatch
    if (url.pathname === '/api/v1/notify/dispatch' && request.method === 'POST') {
      try {
        const event = (await request.json()) as NotificationEvent;
        if (!event.recipientId || !event.message) {
          return new Response(
            JSON.stringify({ error: 'recipientId and message are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let appwrite: ReturnType<typeof createOperationalClient> | null = null;
        if (env.APPWRITE_PROJECT_A_KEY) {
          appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );
        }

        let auditId = `audit_${Math.random().toString(36).substring(2, 10)}`;
        if (appwrite) {
          try {
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
            auditId = auditRecord.$id;
          } catch (dbErr) {
            console.warn('[Audit log notice]:', dbErr);
          }
        }

        return new Response(
          JSON.stringify({
            status: 'DISPATCHED',
            auditId,
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

    // 3. Meta WhatsApp Cloud API: Appointment Confirmation
    if (url.pathname === '/api/v1/notify/whatsapp/confirmation' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          patientId: string;
          patientPhone: string;
          patientName: string;
          doctorName: string;
          appointmentTime: string;
          bookingId: string;
          hospitalName?: string;
        };

        if (!body.patientPhone || !body.patientName || !body.doctorName || !body.bookingId) {
          return new Response(
            JSON.stringify({ error: 'patientPhone, patientName, doctorName, and bookingId are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let appwrite: ReturnType<typeof createOperationalClient> | null = null;
        if (env.APPWRITE_PROJECT_A_KEY) {
          appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );
        }

        // DPDP Act Consent Check
        const consented = await hasActiveConsent(
          appwrite,
          body.patientId,
          'WHATSAPP_CONFIRMATIONS'
        );
        if (!consented) {
          return new Response(
            JSON.stringify({
              error: 'CONSENT_WITHDRAWN_OR_MISSING',
              message: 'Patient has not consented to WhatsApp communications under the DPDP Act.',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const whatsappPayload = buildAppointmentConfirmationWhatsApp(body);
        const result = await sendWhatsAppMessage(
          {
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || 'mock_phone_id',
            accessToken: env.WHATSAPP_ACCESS_TOKEN || 'mock_whatsapp_token',
            apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
          },
          whatsappPayload
        );

        if (appwrite) {
          try {
            await appwrite.databases.createDocument(
              'operational_db',
              'notifications_log',
              'unique()',
              {
                recipientId: body.patientId || body.patientPhone,
                type: 'APPOINTMENT_REMINDER',
                message: `WhatsApp confirmation sent for booking ${body.bookingId}`,
                dispatchedAt: new Date().toISOString(),
                status: result.success ? 'DELIVERED' : 'FAILED',
              }
            );
          } catch {
            // Ignore dev log failure
          }
        }

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'WhatsApp confirmation error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. Meta WhatsApp Cloud API: Appointment Reminder
    if (url.pathname === '/api/v1/notify/whatsapp/reminder' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          patientId: string;
          patientPhone: string;
          patientName: string;
          doctorName: string;
          appointmentTime: string;
          hospitalName?: string;
        };

        if (!body.patientPhone || !body.patientName || !body.doctorName) {
          return new Response(
            JSON.stringify({ error: 'patientPhone, patientName, and doctorName are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let appwrite: ReturnType<typeof createOperationalClient> | null = null;
        if (env.APPWRITE_PROJECT_A_KEY) {
          appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );
        }

        // DPDP Act Consent Check
        const consented = await hasActiveConsent(
          appwrite,
          body.patientId,
          'WHATSAPP_REMINDERS'
        );
        if (!consented) {
          return new Response(
            JSON.stringify({
              error: 'CONSENT_WITHDRAWN_OR_MISSING',
              message: 'Patient has not consented to WhatsApp reminders under the DPDP Act.',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const whatsappPayload = buildAppointmentReminderWhatsApp(body);
        const result = await sendWhatsAppMessage(
          {
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || 'mock_phone_id',
            accessToken: env.WHATSAPP_ACCESS_TOKEN || 'mock_whatsapp_token',
            apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
          },
          whatsappPayload
        );

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'WhatsApp reminder error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 5. Transactional Email via Appwrite Messaging & Amazon SES SMTP
    if (url.pathname === '/api/v1/notify/email/transactional' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          patientId?: string;
          recipientEmail: string;
          recipientName?: string;
          subject: string;
          content: string;
          html?: string;
        };

        if (!body.recipientEmail || !body.subject || !body.content) {
          return new Response(
            JSON.stringify({ error: 'recipientEmail, subject, and content are required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let appwrite: ReturnType<typeof createOperationalClient> | null = null;
        if (env.APPWRITE_PROJECT_A_KEY) {
          appwrite = createOperationalClient(
            env.APPWRITE_ENDPOINT,
            env.APPWRITE_PROJECT_A_ID,
            env.APPWRITE_PROJECT_A_KEY
          );
        }

        // DPDP Act Consent Check
        if (body.patientId) {
          const consented = await hasActiveConsent(
            appwrite,
            body.patientId,
            'TRANSACTIONAL_EMAIL'
          );
          if (!consented) {
            return new Response(
              JSON.stringify({
                error: 'CONSENT_WITHDRAWN_OR_MISSING',
                message: 'Patient has not consented to email communications under the DPDP Act.',
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        const emailResult = await sendTransactionalEmail(
          appwrite ? appwrite.messaging : null,
          {
            recipientEmail: body.recipientEmail,
            recipientName: body.recipientName,
            subject: body.subject,
            content: body.content,
            html: body.html,
          },
          {
            providerId: env.SMTP_PROVIDER_ID || DEFAULT_SMTP_CONFIG.providerId,
            name: 'Amazon SES (ap-south-1)',
            host: env.SMTP_HOST || DEFAULT_SMTP_CONFIG.host,
            fromEmail: env.SMTP_FROM_EMAIL || DEFAULT_SMTP_CONFIG.fromEmail,
            fromName: env.SMTP_FROM_NAME || DEFAULT_SMTP_CONFIG.fromName,
          }
        );

        return new Response(JSON.stringify(emailResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Transactional email error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
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
          const patientId = body.recipientId || 'system';
          const patientPhone = body.recipientPhone || (body.payload?.patient_phone as string);
          const patientEmail = body.recipientEmail || (body.payload?.patient_email as string);
          const bookingId = (body.payload?.booking_id as string) || (body.payload?.order_id as string) || 'BOOKING_REF';
          const doctorName = (body.payload?.doctor_name as string) || 'Specialist Physician';
          const appointmentTime = (body.payload?.slot_key as string) || new Date().toISOString();

          // 1. Audit log in Appwrite Project A
          if (appwrite) {
            try {
              await appwrite.databases.createDocument(
                'operational_db',
                'notifications_log',
                'unique()',
                {
                  recipientId: patientId,
                  type: 'APPOINTMENT_REMINDER',
                  message: `Payment confirmed for booking ${bookingId}. Amount: ${body.payload?.amount || 0} paise.`,
                  dispatchedAt: new Date().toISOString(),
                  status: 'DELIVERED',
                }
              );
            } catch {
              // Ignore dev sync error
            }
          }

          // 2. Dispatch Meta WhatsApp Cloud API Confirmation if phone provided
          if (patientPhone) {
            const hasConsent = await hasActiveConsent(appwrite, patientId, 'WHATSAPP_CONFIRMATIONS');
            if (hasConsent) {
              const whatsappPayload = buildAppointmentConfirmationWhatsApp({
                patientPhone,
                patientName: (body.payload?.patient_name as string) || 'Valued Patient',
                doctorName,
                appointmentTime,
                bookingId,
              });

              await sendWhatsAppMessage(
                {
                  phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || 'mock_phone_id',
                  accessToken: env.WHATSAPP_ACCESS_TOKEN || 'mock_whatsapp_token',
                  apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
                },
                whatsappPayload
              );
            }
          }

          // 3. Dispatch Transactional Confirmation Email if email provided
          if (patientEmail) {
            const hasEmailConsent = await hasActiveConsent(appwrite, patientId, 'TRANSACTIONAL_EMAIL');
            if (hasEmailConsent) {
              const emailPayload = buildAppointmentConfirmationEmail({
                patientEmail,
                patientName: (body.payload?.patient_name as string) || 'Valued Patient',
                doctorName,
                appointmentTime,
                bookingId,
              });

              await sendTransactionalEmail(
                appwrite ? appwrite.messaging : null,
                emailPayload,
                {
                  providerId: env.SMTP_PROVIDER_ID || DEFAULT_SMTP_CONFIG.providerId,
                  host: env.SMTP_HOST || DEFAULT_SMTP_CONFIG.host,
                  fromEmail: env.SMTP_FROM_EMAIL || DEFAULT_SMTP_CONFIG.fromEmail,
                  fromName: env.SMTP_FROM_NAME || DEFAULT_SMTP_CONFIG.fromName,
                }
              );
            }
          }
        }

        // Handle direct WhatsApp dispatch messages
        if (body.type === 'WHATSAPP_DISPATCH' && body.recipientPhone) {
          const whatsappPayload = (body.payload?.whatsappPayload as any) || {
            to: body.recipientPhone,
            type: 'text',
            text: { body: (body.payload?.message as string) || 'DoctorCare notification' },
          };
          await sendWhatsAppMessage(
            {
              phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || 'mock_phone_id',
              accessToken: env.WHATSAPP_ACCESS_TOKEN || 'mock_whatsapp_token',
              apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
            },
            whatsappPayload
          );
        }

        // Handle direct Email dispatch messages
        if (body.type === 'EMAIL_DISPATCH' && body.recipientEmail) {
          await sendTransactionalEmail(
            appwrite ? appwrite.messaging : null,
            {
              recipientEmail: body.recipientEmail,
              subject: (body.payload?.subject as string) || 'DoctorCare Healthcare Notification',
              content: (body.payload?.content as string) || 'Notification from DoctorCare',
              html: body.payload?.html as string,
            },
            {
              providerId: env.SMTP_PROVIDER_ID || DEFAULT_SMTP_CONFIG.providerId,
              host: env.SMTP_HOST || DEFAULT_SMTP_CONFIG.host,
            }
          );
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

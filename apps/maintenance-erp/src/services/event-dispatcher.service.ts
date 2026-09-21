import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { DomainEventCreateDto } from '../schemas/domain-event.schema.js';
import { NotificationRuleService, NotificationRuleRecord } from './notification-rule.service.js';
import { RecipientResolverService } from './recipient-resolver.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';
import { TemplateEngineService } from './template-engine.service.js';
import { ProviderRegistry } from './communication-provider.service.js';
import { RetryPolicyService } from './retry-policy.service.js';

export class EventDispatcherService {
  /**
   * Pure idempotency key generation.
   */
  static generateIdempotencyKey(
    companyId: string,
    eventId: string,
    recipient: string,
    channel: string,
    eventType: string
  ): string {
    const raw = `${companyId}:${eventId}:${recipient}:${channel}:${eventType}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  }

  /**
   * Transactionally publishes a domain event into the outbox table.
   */
  static async publishEvent(
    client: SupabaseClient,
    dto: DomainEventCreateDto
  ): Promise<{ eventId: string }> {
    const { data, error } = await client.rpc('publish_domain_event', {
      p_company_id: dto.companyId,
      p_event_type: dto.eventType,
      p_entity_type: dto.entityType,
      p_entity_id: dto.entityId,
      p_payload: dto.payload || {},
      p_actor_id: dto.actorId || null,
    });

    if (error) {
      // Fallback insert if RPC not executed in test
      const { data: inserted, error: iErr } = await client
        .from('domain_events')
        .insert({
          company_id: dto.companyId,
          event_type: dto.eventType,
          entity_type: dto.entityType,
          entity_id: dto.entityId,
          actor_id: dto.actorId || null,
          payload: dto.payload || {},
          status: 'pending',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (iErr) throw new Error(`Failed to publish domain event: ${iErr.message}`);
      return { eventId: inserted.id };
    }

    return { eventId: data };
  }

  /**
   * Processes a batch of pending outbox domain events.
   */
  static async processOutboxBatch(
    client: SupabaseClient,
    companyId: string,
    batchSize = 20
  ) {
    // 1. Fetch tenant communication settings
    const tenantSettings = await NotificationPreferenceService.getTenantSettings(client, companyId);

    // 2. Fetch active notification rules
    const rules = (await NotificationRuleService.listRules(client, companyId)) as NotificationRuleRecord[];

    // 3. Claim pending events
    const { data: events, error: evErr } = await client.rpc('process_outbox_batch', {
      p_company_id: companyId,
      p_batch_size: batchSize,
    });

    let claimedEvents = events;
    if (evErr || !claimedEvents) {
      // Fallback fetch
      const { data: fbEvents } = await client
        .from('domain_events')
        .select('*')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(batchSize);
      claimedEvents = fbEvents || [];
    }

    const processedEvents: string[] = [];
    const notificationsGenerated: string[] = [];

    for (const ev of claimedEvents) {
      try {
        const payload = ev.payload || {};
        const matchingRules = NotificationRuleService.filterMatchingRules(rules, ev.event_type, payload);

        for (const rule of matchingRules) {
          // Resolve target recipients
          const recipients = await RecipientResolverService.resolveRecipients(
            client,
            companyId,
            rule.recipient_type,
            rule.recipient_role,
            ev.entity_type,
            ev.entity_id,
            payload
          );

          for (const recipient of recipients) {
            const contactIdentifier = recipient.email || recipient.phone || recipient.userId || 'system';

            // Check preferences
            let userPrefs: any[] = [];
            if (recipient.userId) {
              userPrefs = await NotificationPreferenceService.getUserPreferences(
                client,
                companyId,
                recipient.userId
              );
            }

            const allowed = NotificationPreferenceService.isNotificationAllowed({
              eventType: ev.event_type,
              channel: rule.channel,
              tenantSettings,
              userPreferences: userPrefs,
              isUrgent: payload.priority === 'urgent' || payload.priority === 'critical',
            });

            if (!allowed) continue;

            // Render message template
            let title = `${rule.name}`;
            let bodyText = `Notification for ${ev.event_type}`;

            if ((rule as any).template) {
              const tmpl = (rule as any).template;
              const renderCtx = {
                ...payload,
                recipient_name: recipient.name,
                technician_name: recipient.name,
                customer_name: recipient.name,
              };

              if (tmpl.subject) {
                title = TemplateEngineService.render(tmpl.subject, renderCtx).rendered;
              }
              bodyText = TemplateEngineService.render(tmpl.body, renderCtx).rendered;
            }

            // Generate idempotency key
            const idempotencyKey = this.generateIdempotencyKey(
              companyId,
              ev.id,
              contactIdentifier,
              rule.channel,
              ev.event_type
            );

            // Create notification item in outbox queue
            const { data: notif, error: notifErr } = await client
              .from('notifications')
              .insert({
                company_id: companyId,
                user_id: recipient.userId || null,
                recipient_contact: contactIdentifier,
                recipient_type: recipient.recipientType,
                channel: rule.channel,
                event_type: ev.event_type,
                title,
                body: bodyText,
                status: 'pending',
                idempotency_key: idempotencyKey,
                reference_table: ev.entity_type,
                reference_id: ev.entity_id,
                metadata: {
                  event_id: ev.id,
                  rule_id: rule.id,
                  ...payload,
                },
              })
              .select('id')
              .maybeSingle();

            if (notif && !notifErr) {
              notificationsGenerated.push(notif.id);
            }
          }
        }

        // Mark domain event processed
        await client
          .from('domain_events')
          .update({
            status: 'processed',
            processed_at: new Date().toISOString(),
          })
          .eq('id', ev.id);

        processedEvents.push(ev.id);
      } catch (err: any) {
        await client
          .from('domain_events')
          .update({
            status: 'failed',
            error_message: err.message,
            retry_count: (ev.retry_count || 0) + 1,
          })
          .eq('id', ev.id);
      }
    }

    return {
      claimedCount: claimedEvents.length,
      processedCount: processedEvents.length,
      notificationsGeneratedCount: notificationsGenerated.length,
      processedEvents,
    };
  }

  /**
   * Dispatches a single pending notification to its target external channel or in-app feed.
   */
  static async dispatchNotification(client: SupabaseClient, notificationId: string) {
    const { data: notif, error: fetchErr } = await client
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (fetchErr || !notif) throw new Error('Notification not found');

    const companyId = notif.company_id;
    const tenantSettings = await NotificationPreferenceService.getTenantSettings(client, companyId);

    const nowIso = new Date().toISOString();

    // In-app notifications require no external provider call
    if (notif.channel === 'in_app') {
      await client
        .from('notifications')
        .update({
          status: 'delivered',
          sent_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', notificationId);

      return { success: true, channel: 'in_app', status: 'delivered' };
    }

    let deliveryResult: any;

    try {
      if (notif.channel === 'email') {
        const providerName = tenantSettings.email_provider || 'mock';
        const provider = ProviderRegistry.getEmailProvider(providerName);
        deliveryResult = await provider.sendEmail({
          to: notif.recipient_contact,
          subject: notif.title,
          text: notif.body,
          metadata: notif.metadata,
        });
      } else if (notif.channel === 'sms') {
        const providerName = tenantSettings.sms_provider || 'mock';
        const provider = ProviderRegistry.getSmsProvider(providerName);
        deliveryResult = await provider.sendSms({
          to: notif.recipient_contact,
          message: notif.body,
          metadata: notif.metadata,
        });
      } else if (notif.channel === 'whatsapp') {
        const providerName = tenantSettings.whatsapp_provider || 'mock';
        const provider = ProviderRegistry.getWhatsAppProvider(providerName);
        deliveryResult = await provider.sendWhatsApp({
          to: notif.recipient_contact,
          message: notif.body,
          metadata: notif.metadata,
        });
      }

      // Log delivery audit record in message_log
      await client.from('message_log').insert({
        company_id: companyId,
        notification_id: notificationId,
        channel: notif.channel,
        recipient: notif.recipient_contact,
        payload: { title: notif.title, body: notif.body, metadata: notif.metadata },
        status: deliveryResult?.status || 'sent',
        provider: tenantSettings[`${notif.channel}_provider`] || 'mock',
        provider_message_id: deliveryResult?.providerMessageId || null,
        provider_response: deliveryResult?.providerResponse || null,
        delivered_at: deliveryResult?.success ? nowIso : null,
        error_message: deliveryResult?.error || null,
        created_at: nowIso,
      });

      if (deliveryResult?.success) {
        await client
          .from('notifications')
          .update({
            status: deliveryResult.status,
            sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', notificationId);

        return { success: true, channel: notif.channel, status: deliveryResult.status };
      } else {
        throw new Error(deliveryResult?.error || 'Provider delivery failed');
      }
    } catch (err: any) {
      // Evaluate retry policy
      const retryEval = RetryPolicyService.evaluateRetry({
        currentAttempt: notif.retry_count || 1,
        maxAttempts: notif.max_retries || 5,
        error: err.message,
      });

      const nextStatus = retryEval.shouldRetry ? 'pending' : 'failed';

      await client
        .from('notifications')
        .update({
          status: nextStatus,
          retry_count: retryEval.nextAttempt,
          error_message: err.message,
          failed_at: retryEval.shouldRetry ? null : nowIso,
          updated_at: nowIso,
        })
        .eq('id', notificationId);

      return {
        success: false,
        channel: notif.channel,
        error: err.message,
        willRetry: retryEval.shouldRetry,
      };
    }
  }
}

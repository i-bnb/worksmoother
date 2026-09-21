import { SupabaseClient } from '@supabase/supabase-js';
import { ManualCommunicationDto } from '../schemas/notification.schema.js';
import { ProviderRegistry } from './communication-provider.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';

export class CommunicationHistoryService {
  /**
   * Retrieves communication delivery history for a specific ERP entity.
   */
  static async getEntityCommunicationHistory(
    client: SupabaseClient,
    companyId: string,
    entityType: string,
    entityId: string
  ) {
    const { data, error } = await client
      .from('notifications')
      .select(`
        id,
        recipient_contact,
        recipient_type,
        channel,
        title,
        body,
        status,
        sent_at,
        read_at,
        created_at,
        error_message,
        message_log:message_log(
          id,
          provider,
          provider_message_id,
          delivered_at,
          status,
          error_message
        )
      `)
      .eq('company_id', companyId)
      .eq('reference_table', entityType)
      .eq('reference_id', entityId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch communication history: ${error.message}`);
    return data || [];
  }

  /**
   * Retrieves all delivery logs for a company with optional filters.
   */
  static async getDeliveryLogs(
    client: SupabaseClient,
    companyId: string,
    filters: {
      channel?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = client
      .from('message_log')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId);

    if (filters.channel) query = query.eq('channel', filters.channel);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Failed to fetch delivery logs: ${error.message}`);

    return {
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  /**
   * Dispatches a manual communication message to a recipient.
   */
  static async sendManualCommunication(
    client: SupabaseClient,
    dto: ManualCommunicationDto
  ) {
    const nowIso = new Date().toISOString();
    const tenantSettings = await NotificationPreferenceService.getTenantSettings(client, dto.companyId);

    // 1. Create notification record
    const { data: notif, error: notifErr } = await client
      .from('notifications')
      .insert({
        company_id: dto.companyId,
        user_id: dto.userId || null,
        recipient_contact: dto.recipientContact,
        recipient_type: dto.recipientType,
        channel: dto.channel,
        title: dto.subject || `Message to ${dto.recipientContact}`,
        body: dto.message,
        status: 'pending',
        reference_table: dto.entityType || null,
        reference_id: dto.entityId || null,
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (notifErr || !notif) {
      throw new Error(`Failed to record manual notification: ${notifErr?.message}`);
    }

    // 2. Dispatch
    if (dto.channel === 'in_app') {
      await client
        .from('notifications')
        .update({ status: 'delivered', sent_at: nowIso, updated_at: nowIso })
        .eq('id', notif.id);

      return {
        notificationId: notif.id,
        status: 'delivered',
        channel: 'in_app',
      };
    }

    let deliveryResult: any;

    if (dto.channel === 'email') {
      const provider = ProviderRegistry.getEmailProvider(tenantSettings.email_provider || 'mock');
      deliveryResult = await provider.sendEmail({
        to: dto.recipientContact,
        subject: dto.subject || 'ERP Notification',
        text: dto.message,
        metadata: dto.metadata,
      });
    } else if (dto.channel === 'sms') {
      const provider = ProviderRegistry.getSmsProvider(tenantSettings.sms_provider || 'mock');
      deliveryResult = await provider.sendSms({
        to: dto.recipientContact,
        message: dto.message,
        metadata: dto.metadata,
      });
    } else if (dto.channel === 'whatsapp') {
      const provider = ProviderRegistry.getWhatsAppProvider(tenantSettings.whatsapp_provider || 'mock');
      deliveryResult = await provider.sendWhatsApp({
        to: dto.recipientContact,
        message: dto.message,
        metadata: dto.metadata,
      });
    }

    // 3. Log delivery audit
    await client.from('message_log').insert({
      company_id: dto.companyId,
      notification_id: notif.id,
      channel: dto.channel,
      recipient: dto.recipientContact,
      payload: { subject: dto.subject, message: dto.message },
      status: deliveryResult?.status || 'sent',
      provider: tenantSettings[`${dto.channel}_provider`] || 'mock',
      provider_message_id: deliveryResult?.providerMessageId || null,
      provider_response: deliveryResult?.providerResponse || null,
      delivered_at: deliveryResult?.success ? nowIso : null,
      error_message: deliveryResult?.error || null,
      created_at: nowIso,
    });

    const finalStatus = deliveryResult?.success ? deliveryResult.status : 'failed';

    await client
      .from('notifications')
      .update({
        status: finalStatus,
        sent_at: deliveryResult?.success ? nowIso : null,
        failed_at: deliveryResult?.success ? null : nowIso,
        error_message: deliveryResult?.error || null,
        updated_at: nowIso,
      })
      .eq('id', notif.id);

    return {
      notificationId: notif.id,
      status: finalStatus,
      channel: dto.channel,
      providerMessageId: deliveryResult?.providerMessageId,
    };
  }
}

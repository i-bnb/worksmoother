import { SupabaseClient } from '@supabase/supabase-js';
import {
  NotificationPreferenceDto,
  NotificationPreferenceBatchUpdateDto,
  CommunicationSettingsUpdateDto,
  sanitizeProviderConfig,
} from '../schemas/communication-settings.schema.js';
import { NotificationChannel } from '../schemas/notification.schema.js';
import { ErpEventType } from '../schemas/domain-event.schema.js';

export class NotificationPreferenceService {
  /**
   * Pure evaluation: Determines whether a notification is permitted to be delivered
   * based on tenant channel gates and user opt-in/opt-out preferences.
   */
  static isNotificationAllowed(params: {
    eventType: ErpEventType;
    channel: NotificationChannel;
    tenantSettings?: {
      inAppEnabled?: boolean;
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      whatsappEnabled?: boolean;
    };
    userPreferences?: Array<{
      eventType: string;
      channel: string;
      isEnabled: boolean;
    }>;
    isUrgent?: boolean;
  }): boolean {
    const { eventType, channel, tenantSettings, userPreferences, isUrgent } = params;

    // 1. Tenant Channel Enablement Gate
    if (tenantSettings) {
      if (channel === 'in_app' && tenantSettings.inAppEnabled === false) return false;
      if (channel === 'email' && tenantSettings.emailEnabled === false) return false;
      if (channel === 'sms' && tenantSettings.smsEnabled === false) return false;
      if (channel === 'whatsapp' && tenantSettings.whatsappEnabled === false) return false;
    }

    // 2. Urgent / Mandatory alerts bypass individual user opt-outs for in_app or email
    if (isUrgent && ['in_app', 'email'].includes(channel)) {
      return true;
    }

    // 3. User Preference Check
    if (userPreferences && userPreferences.length > 0) {
      const match = userPreferences.find(
        (p) => p.eventType === eventType && p.channel === channel
      );
      if (match && match.isEnabled === false) {
        return false;
      }
    }

    return true;
  }

  /**
   * Retrieves all notification preferences for a user in a company.
   */
  static async getUserPreferences(
    client: SupabaseClient,
    companyId: string,
    userId: string
  ) {
    const { data, error } = await client
      .from('notification_preferences')
      .select('*')
      .eq('company_id', companyId)
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to fetch notification preferences: ${error.message}`);
    return data || [];
  }

  /**
   * Upserts a single user preference.
   */
  static async updateUserPreference(
    client: SupabaseClient,
    dto: NotificationPreferenceDto
  ) {
    const { data, error } = await client
      .from('notification_preferences')
      .upsert(
        {
          company_id: dto.companyId,
          user_id: dto.userId,
          event_type: dto.eventType,
          channel: dto.channel,
          is_enabled: dto.isEnabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id, user_id, event_type, channel' }
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to update preference: ${error.message}`);
    return data;
  }

  /**
   * Batch upserts user preferences.
   */
  static async batchUpdatePreferences(
    client: SupabaseClient,
    dto: NotificationPreferenceBatchUpdateDto
  ) {
    const rows = dto.preferences.map((p) => ({
      company_id: dto.companyId,
      user_id: dto.userId,
      event_type: p.eventType,
      channel: p.channel,
      is_enabled: p.isEnabled,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await client
      .from('notification_preferences')
      .upsert(rows, { onConflict: 'company_id, user_id, event_type, channel' })
      .select();

    if (error) throw new Error(`Failed to batch update preferences: ${error.message}`);
    return data;
  }

  /**
   * Retrieves tenant communication settings (with masked credentials).
   */
  static async getTenantSettings(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('communication_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch communication settings: ${error.message}`);

    if (!data) {
      // Default settings fallback
      return {
        company_id: companyId,
        in_app_enabled: true,
        email_enabled: true,
        sms_enabled: false,
        whatsapp_enabled: false,
        email_provider: 'mock',
        sms_provider: 'mock',
        whatsapp_provider: 'mock',
        provider_config: {},
      };
    }

    return {
      ...data,
      provider_config: sanitizeProviderConfig(data.provider_config),
    };
  }

  /**
   * Updates tenant communication settings.
   */
  static async updateTenantSettings(
    client: SupabaseClient,
    dto: CommunicationSettingsUpdateDto
  ) {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.inAppEnabled !== undefined) updates.in_app_enabled = dto.inAppEnabled;
    if (dto.emailEnabled !== undefined) updates.email_enabled = dto.emailEnabled;
    if (dto.smsEnabled !== undefined) updates.sms_enabled = dto.smsEnabled;
    if (dto.whatsappEnabled !== undefined) updates.whatsapp_enabled = dto.whatsappEnabled;
    if (dto.emailProvider) updates.email_provider = dto.emailProvider;
    if (dto.smsProvider) updates.sms_provider = dto.smsProvider;
    if (dto.whatsappProvider) updates.whatsapp_provider = dto.whatsappProvider;
    if (dto.emailFromAddress !== undefined) updates.email_from_address = dto.emailFromAddress;
    if (dto.emailFromName !== undefined) updates.email_from_name = dto.emailFromName;
    if (dto.smsSenderId !== undefined) updates.sms_sender_id = dto.smsSenderId;
    if (dto.whatsappPhoneNumberId !== undefined) updates.whatsapp_phone_number_id = dto.whatsappPhoneNumberId;
    if (dto.providerConfig !== undefined) updates.provider_config = dto.providerConfig;

    const { data, error } = await client
      .from('communication_settings')
      .upsert(
        {
          company_id: dto.companyId,
          ...updates,
        },
        { onConflict: 'company_id' }
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to update communication settings: ${error.message}`);

    return {
      ...data,
      provider_config: sanitizeProviderConfig(data.provider_config),
    };
  }
}

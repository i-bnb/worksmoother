import { NotificationChannel } from './notification.schema.js';
import { ErpEventType, ALL_ERP_EVENT_TYPES } from './domain-event.schema.js';

export interface NotificationPreferenceDto {
  companyId: string;
  userId: string;
  eventType: ErpEventType;
  channel: NotificationChannel;
  isEnabled: boolean;
}

export interface NotificationPreferenceBatchUpdateDto {
  companyId: string;
  userId: string;
  preferences: Array<{
    eventType: ErpEventType;
    channel: NotificationChannel;
    isEnabled: boolean;
  }>;
}

export interface CommunicationSettingsUpdateDto {
  companyId: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
  emailProvider?: string;
  smsProvider?: string;
  whatsappProvider?: string;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
  smsSenderId?: string | null;
  whatsappPhoneNumberId?: string | null;
  providerConfig?: Record<string, any>;
}

export function validatePreferenceUpdate(body: any): NotificationPreferenceDto {
  if (!body) throw new Error('Preference body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');
  const userId = body.userId || body.user_id;
  if (!userId) throw new Error('userId is required');

  const eventType = body.eventType || body.event_type;
  if (!eventType || !ALL_ERP_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid eventType: ${eventType}`);
  }

  const channel = body.channel as NotificationChannel;
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  if (!channel || !validChannels.includes(channel)) {
    throw new Error(`Invalid channel: ${channel}`);
  }

  const isEnabled = body.isEnabled !== undefined ? Boolean(body.isEnabled) : true;

  return {
    companyId,
    userId,
    eventType,
    channel,
    isEnabled,
  };
}

export function validatePreferenceBatchUpdate(body: any): NotificationPreferenceBatchUpdateDto {
  if (!body) throw new Error('Batch preference body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');
  const userId = body.userId || body.user_id;
  if (!userId) throw new Error('userId is required');

  if (!Array.isArray(body.preferences)) {
    throw new Error('preferences must be an array');
  }

  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  const preferences = body.preferences.map((p: any, idx: number) => {
    if (!p.eventType || !ALL_ERP_EVENT_TYPES.includes(p.eventType)) {
      throw new Error(`Invalid eventType at index ${idx}: ${p.eventType}`);
    }
    if (!p.channel || !validChannels.includes(p.channel)) {
      throw new Error(`Invalid channel at index ${idx}: ${p.channel}`);
    }
    return {
      eventType: p.eventType as ErpEventType,
      channel: p.channel as NotificationChannel,
      isEnabled: p.isEnabled !== undefined ? Boolean(p.isEnabled) : true,
    };
  });

  return {
    companyId,
    userId,
    preferences,
  };
}

export function validateCommunicationSettingsUpdate(body: any): CommunicationSettingsUpdateDto {
  if (!body) throw new Error('Settings body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  return {
    companyId,
    inAppEnabled: body.inAppEnabled !== undefined ? Boolean(body.inAppEnabled) : undefined,
    emailEnabled: body.emailEnabled !== undefined ? Boolean(body.emailEnabled) : undefined,
    smsEnabled: body.smsEnabled !== undefined ? Boolean(body.smsEnabled) : undefined,
    whatsappEnabled: body.whatsappEnabled !== undefined ? Boolean(body.whatsappEnabled) : undefined,
    emailProvider: body.emailProvider || body.email_provider,
    smsProvider: body.smsProvider || body.sms_provider,
    whatsappProvider: body.whatsappProvider || body.whatsapp_provider,
    emailFromAddress: body.emailFromAddress || body.email_from_address,
    emailFromName: body.emailFromName || body.email_from_name,
    smsSenderId: body.smsSenderId || body.sms_sender_id,
    whatsappPhoneNumberId: body.whatsappPhoneNumberId || body.whatsapp_phone_number_id,
    providerConfig: body.providerConfig || body.provider_config,
  };
}

/**
 * Strips or masks secrets in provider configuration before returning via API
 */
export function sanitizeProviderConfig(config: Record<string, any> = {}): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(config)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('key') ||
      lower.includes('token') ||
      lower.includes('auth')
    ) {
      sanitized[key] = '••••••••';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

import { NotificationChannel } from './notification.schema.js';
import { ErpEventType, ALL_ERP_EVENT_TYPES } from './domain-event.schema.js';

export interface MessageTemplateCreateDto {
  companyId: string;
  name: string;
  channel: NotificationChannel;
  eventType?: ErpEventType | null;
  subject?: string | null;
  body: string;
  variables?: string[];
  language?: string;
  isActive?: boolean;
  userId?: string | null;
}

export interface MessageTemplateUpdateDto {
  name?: string;
  subject?: string | null;
  body?: string;
  variables?: string[];
  language?: string;
  isActive?: boolean;
  userId?: string | null;
}

export function validateMessageTemplateCreate(body: any): MessageTemplateCreateDto {
  if (!body) throw new Error('Template body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  const name = body.name?.trim();
  if (!name) throw new Error('name is required');

  const channel = body.channel as NotificationChannel;
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  if (!channel || !validChannels.includes(channel)) {
    throw new Error(`channel must be one of: ${validChannels.join(', ')}`);
  }

  const templateBody = body.body?.trim();
  if (!templateBody) throw new Error('template body is required');

  const eventType = body.eventType || body.event_type || null;
  if (eventType && !ALL_ERP_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid eventType: ${eventType}`);
  }

  return {
    companyId,
    name,
    channel,
    eventType,
    subject: body.subject?.trim() || null,
    body: templateBody,
    variables: Array.isArray(body.variables) ? body.variables : [],
    language: body.language || 'en',
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    userId: body.userId || body.user_id || null,
  };
}

export function validateMessageTemplateUpdate(body: any): MessageTemplateUpdateDto {
  if (!body) throw new Error('Update body is required');

  return {
    name: body.name?.trim(),
    subject: body.subject !== undefined ? body.subject?.trim() : undefined,
    body: body.body?.trim(),
    variables: Array.isArray(body.variables) ? body.variables : undefined,
    language: body.language,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    userId: body.userId || body.user_id || null,
  };
}

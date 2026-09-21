import { NotificationChannel } from './notification.schema.js';
import { ErpEventType, ALL_ERP_EVENT_TYPES } from './domain-event.schema.js';

export type RecipientType = 'technician' | 'customer' | 'account_manager' | 'service_manager' | 'user' | 'role';

export interface NotificationRuleCreateDto {
  companyId: string;
  name: string;
  description?: string | null;
  eventType: ErpEventType;
  recipientType: RecipientType;
  recipientRole?: string | null;
  channel: NotificationChannel;
  templateId?: string | null;
  conditions?: Array<{
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
    value: any;
  }>;
  isActive?: boolean;
  priority?: number;
}

export interface NotificationRuleUpdateDto {
  name?: string;
  description?: string | null;
  recipientType?: RecipientType;
  recipientRole?: string | null;
  channel?: NotificationChannel;
  templateId?: string | null;
  conditions?: Array<{
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
    value: any;
  }>;
  isActive?: boolean;
  priority?: number;
}

export interface ReminderRuleCreateDto {
  companyId: string;
  name: string;
  entityType: 'service_appointment' | 'amc_contract' | 'invoice' | 'rental_contract';
  offsetMinutes: number; // negative for advance reminder
  channel: NotificationChannel;
  templateId?: string | null;
  isActive?: boolean;
}

export function validateNotificationRuleCreate(body: any): NotificationRuleCreateDto {
  if (!body) throw new Error('Rule body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  const name = body.name?.trim();
  if (!name) throw new Error('name is required');

  const eventType = body.eventType || body.event_type;
  if (!eventType || !ALL_ERP_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid eventType: ${eventType}`);
  }

  const validRecipientTypes: RecipientType[] = [
    'technician',
    'customer',
    'account_manager',
    'service_manager',
    'user',
    'role',
  ];
  const recipientType = body.recipientType || body.recipient_type;
  if (!recipientType || !validRecipientTypes.includes(recipientType)) {
    throw new Error(`recipientType must be one of: ${validRecipientTypes.join(', ')}`);
  }

  const channel = body.channel as NotificationChannel;
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  if (!channel || !validChannels.includes(channel)) {
    throw new Error(`channel must be one of: ${validChannels.join(', ')}`);
  }

  return {
    companyId,
    name,
    description: body.description || null,
    eventType,
    recipientType,
    recipientRole: body.recipientRole || body.recipient_role || null,
    channel,
    templateId: body.templateId || body.template_id || null,
    conditions: Array.isArray(body.conditions) ? body.conditions : [],
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    priority: body.priority !== undefined ? Number(body.priority) : 10,
  };
}

export function validateNotificationRuleUpdate(body: any): NotificationRuleUpdateDto {
  if (!body) throw new Error('Update body is required');

  return {
    name: body.name?.trim(),
    description: body.description !== undefined ? body.description : undefined,
    recipientType: body.recipientType || body.recipient_type,
    recipientRole: body.recipientRole || body.recipient_role,
    channel: body.channel,
    templateId: body.templateId || body.template_id,
    conditions: Array.isArray(body.conditions) ? body.conditions : undefined,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    priority: body.priority !== undefined ? Number(body.priority) : undefined,
  };
}

export function validateReminderRuleCreate(body: any): ReminderRuleCreateDto {
  if (!body) throw new Error('Reminder rule body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  const name = body.name?.trim();
  if (!name) throw new Error('name is required');

  const validEntityTypes = ['service_appointment', 'amc_contract', 'invoice', 'rental_contract'];
  const entityType = body.entityType || body.entity_type;
  if (!entityType || !validEntityTypes.includes(entityType)) {
    throw new Error(`entityType must be one of: ${validEntityTypes.join(', ')}`);
  }

  if (body.offsetMinutes === undefined && body.offset_minutes === undefined) {
    throw new Error('offsetMinutes is required');
  }
  const offsetMinutes = Number(body.offsetMinutes !== undefined ? body.offsetMinutes : body.offset_minutes);

  const channel = body.channel as NotificationChannel;
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  if (!channel || !validChannels.includes(channel)) {
    throw new Error(`channel must be one of: ${validChannels.join(', ')}`);
  }

  return {
    companyId,
    name,
    entityType,
    offsetMinutes,
    channel,
    templateId: body.templateId || body.template_id || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

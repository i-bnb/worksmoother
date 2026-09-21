export type NotificationChannel = 'in_app' | 'push' | 'whatsapp' | 'email' | 'sms';
export type NotificationStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationListQueryDto {
  companyId: string;
  userId?: string;
  unreadOnly?: boolean;
  channel?: NotificationChannel;
  entityType?: string;
  entityId?: string;
  page: number;
  limit: number;
}

export interface ManualCommunicationDto {
  companyId: string;
  recipientContact: string;
  recipientType: 'customer' | 'technician' | 'employee' | 'other';
  channel: NotificationChannel;
  subject?: string | null;
  message: string;
  templateId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, any>;
  userId?: string | null;
}

export function validateNotificationListQuery(query: any): NotificationListQueryDto {
  if (!query) throw new Error('Query parameters are required');
  const companyId = query.companyId || query.company_id;
  if (!companyId) throw new Error('companyId is required');

  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit || '20', 10)));

  return {
    companyId,
    userId: query.userId || query.user_id,
    unreadOnly: query.unreadOnly === 'true' || query.unreadOnly === true || query.unread_only === 'true',
    channel: query.channel,
    entityType: query.entityType || query.entity_type,
    entityId: query.entityId || query.entity_id,
    page,
    limit,
  };
}

export function validateManualCommunication(body: any): ManualCommunicationDto {
  if (!body) throw new Error('Communication body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  const recipientContact = body.recipientContact || body.recipient_contact || body.recipient;
  if (!recipientContact) throw new Error('recipientContact is required');

  const channel = body.channel as NotificationChannel;
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'whatsapp', 'push'];
  if (!channel || !validChannels.includes(channel)) {
    throw new Error(`channel must be one of: ${validChannels.join(', ')}`);
  }

  const message = body.message || body.body;
  if (!message || !message.trim()) {
    throw new Error('message body is required');
  }

  return {
    companyId,
    recipientContact: recipientContact.trim(),
    recipientType: body.recipientType || body.recipient_type || 'customer',
    channel,
    subject: body.subject || null,
    message: message.trim(),
    templateId: body.templateId || body.template_id || null,
    entityType: body.entityType || body.entity_type || null,
    entityId: body.entityId || body.entity_id || null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    userId: body.userId || body.user_id || null,
  };
}

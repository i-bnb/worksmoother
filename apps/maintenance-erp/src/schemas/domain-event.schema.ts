export type ErpEventType =
  | 'CUSTOMER_CREATED'
  | 'SERVICE_REQUEST_CREATED'
  | 'WORK_ORDER_CREATED'
  | 'WORK_ORDER_ASSIGNED'
  | 'WORK_ORDER_SCHEDULED'
  | 'WORK_ORDER_DISPATCHED'
  | 'TECHNICIAN_EN_ROUTE'
  | 'TECHNICIAN_CHECKED_IN'
  | 'TECHNICIAN_CHECKED_OUT'
  | 'WORK_ORDER_COMPLETED'
  | 'WORK_ORDER_CANCELLED'
  | 'QUOTE_CREATED'
  | 'QUOTE_APPROVED'
  | 'QUOTE_REJECTED'
  | 'INVOICE_CREATED'
  | 'INVOICE_OVERDUE'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'AMC_EXPIRING'
  | 'AMC_EXPIRED'
  | 'RENTAL_STARTING'
  | 'RENTAL_OVERDUE'
  | 'RENTAL_RETURNED'
  | 'LEAVE_REQUEST_CREATED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'SLA_AT_RISK'
  | 'SLA_BREACHED'
  | 'PARTS_READY'
  | 'PARTS_UNAVAILABLE'
  | 'SUPPLIER_CREATED'
  | 'PURCHASE_REQUEST_CREATED'
  | 'PURCHASE_REQUEST_APPROVED'
  | 'PURCHASE_REQUEST_REJECTED'
  | 'PURCHASE_ORDER_CREATED'
  | 'PURCHASE_ORDER_APPROVED'
  | 'GOODS_RECEIPT_CREATED'
  | 'BILL_MATCHED'
  | 'BILL_MATCH_EXCEPTION'
  | 'SUPPLIER_PAYMENT_PROCESSED'
  | 'SUPPLIER_PAYMENT_REVERSED';

export const ALL_ERP_EVENT_TYPES: ErpEventType[] = [
  'CUSTOMER_CREATED',
  'SERVICE_REQUEST_CREATED',
  'WORK_ORDER_CREATED',
  'WORK_ORDER_ASSIGNED',
  'WORK_ORDER_SCHEDULED',
  'WORK_ORDER_DISPATCHED',
  'TECHNICIAN_EN_ROUTE',
  'TECHNICIAN_CHECKED_IN',
  'TECHNICIAN_CHECKED_OUT',
  'WORK_ORDER_COMPLETED',
  'WORK_ORDER_CANCELLED',
  'QUOTE_CREATED',
  'QUOTE_APPROVED',
  'QUOTE_REJECTED',
  'INVOICE_CREATED',
  'INVOICE_OVERDUE',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'AMC_EXPIRING',
  'AMC_EXPIRED',
  'RENTAL_STARTING',
  'RENTAL_OVERDUE',
  'RENTAL_RETURNED',
  'LEAVE_REQUEST_CREATED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'SLA_AT_RISK',
  'SLA_BREACHED',
  'PARTS_READY',
  'PARTS_UNAVAILABLE',
  'SUPPLIER_CREATED',
  'PURCHASE_REQUEST_CREATED',
  'PURCHASE_REQUEST_APPROVED',
  'PURCHASE_REQUEST_REJECTED',
  'PURCHASE_ORDER_CREATED',
  'PURCHASE_ORDER_APPROVED',
  'GOODS_RECEIPT_CREATED',
  'BILL_MATCHED',
  'BILL_MATCH_EXCEPTION',
  'SUPPLIER_PAYMENT_PROCESSED',
  'SUPPLIER_PAYMENT_REVERSED',
];

export interface DomainEventCreateDto {
  companyId: string;
  eventType: ErpEventType;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  payload: Record<string, any>;
}

export interface OutboxProcessQueryDto {
  companyId: string;
  batchSize?: number;
}

export function validateDomainEventCreate(body: any): DomainEventCreateDto {
  if (!body) throw new Error('Event body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');
  const eventType = body.eventType || body.event_type;
  if (!eventType) throw new Error('eventType is required');
  if (!ALL_ERP_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid eventType: ${eventType}`);
  }
  const entityType = body.entityType || body.entity_type;
  if (!entityType) throw new Error('entityType is required');
  const entityId = body.entityId || body.entity_id;
  if (!entityId) throw new Error('entityId is required');

  return {
    companyId,
    eventType,
    entityType,
    entityId,
    actorId: body.actorId || body.actor_id || null,
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
  };
}

export function validateOutboxProcessQuery(query: any): OutboxProcessQueryDto {
  if (!query) throw new Error('Query parameters are required');
  const companyId = query.companyId || query.company_id;
  if (!companyId) throw new Error('companyId is required');

  let batchSize = 20;
  if (query.batchSize || query.batch_size) {
    batchSize = Math.max(1, Math.min(100, parseInt(query.batchSize || query.batch_size, 10)));
  }

  return {
    companyId,
    batchSize,
  };
}

/**
 * =============================================================================
 * Customer Quotations & Payment Intents Schemas
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

export interface CustomerQuotationApproveDto {
  signatoryName: string;
  notes?: string | null;
}

export interface CustomerQuotationRejectDto {
  rejectionReason: string;
}

export type PaymentProvider = 'stripe' | 'razorpay' | 'mock' | 'bank_transfer';
export type PaymentMethod = 'card' | 'bank_transfer' | 'upi';

export interface PaymentIntentCreateDto {
  companyId: string;
  customerId: string;
  invoiceId: string;
  paymentMethod?: PaymentMethod;
  provider?: PaymentProvider;
  metadata?: Record<string, any>;
}

export interface PaymentIntentWebhookDto {
  event: string;
  providerIntentId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  amount?: number;
  currency?: string;
  signature?: string;
  metadata?: Record<string, any>;
}

export interface CustomerSafeQuotationLineDto {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface CustomerSafeQuotationDto {
  id: string;
  quotationNumber: string;
  version: number;
  quotationDate: string;
  validUntil: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  status: string;
  termsAndConditions?: string | null;
  customerSignatoryName?: string | null;
  customerApprovalNotes?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  lines: CustomerSafeQuotationLineDto[];
}

export interface CustomerSafeInvoiceDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  amountDue: number;
  status: string;
  workOrderNumber?: string | null;
  quotationNumber?: string | null;
  isOverdue: boolean;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }>;
}

export function validateCustomerQuotationApprove(body: any): CustomerQuotationApproveDto {
  if (!body) throw new Error('Quotation approval body is required');
  const signatoryName = (body.signatoryName || body.signatory_name || '').trim();
  if (!signatoryName) throw new Error('Signatory name is required to approve quotation');

  return {
    signatoryName,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function validateCustomerQuotationReject(body: any): CustomerQuotationRejectDto {
  if (!body) throw new Error('Quotation rejection body is required');
  const rejectionReason = (body.rejectionReason || body.rejection_reason || body.reason || '').trim();
  if (!rejectionReason) throw new Error('A rejection reason is required');

  return { rejectionReason };
}

export function validatePaymentIntentCreate(body: any): PaymentIntentCreateDto {
  if (!body) throw new Error('Payment intent body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const invoiceId = body.invoiceId || body.invoice_id;

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!invoiceId) throw new Error('invoiceId is required');

  const rawProvider = (body.provider || 'mock').toLowerCase();
  const validProviders: PaymentProvider[] = ['stripe', 'razorpay', 'mock', 'bank_transfer'];
  if (!validProviders.includes(rawProvider as PaymentProvider)) {
    throw new Error(`Invalid payment provider: ${rawProvider}`);
  }

  const rawMethod = (body.paymentMethod || body.payment_method || 'card').toLowerCase();
  const validMethods: PaymentMethod[] = ['card', 'bank_transfer', 'upi'];
  if (!validMethods.includes(rawMethod as PaymentMethod)) {
    throw new Error(`Invalid payment method: ${rawMethod}`);
  }

  return {
    companyId,
    customerId,
    invoiceId,
    provider: rawProvider as PaymentProvider,
    paymentMethod: rawMethod as PaymentMethod,
    metadata: body.metadata || {},
  };
}

export function validatePaymentIntentWebhook(body: any): PaymentIntentWebhookDto {
  if (!body) throw new Error('Webhook body is required');
  const providerIntentId = body.providerIntentId || body.provider_intent_id || body.id;
  const rawStatus = (body.status || '').toLowerCase();

  if (!providerIntentId) throw new Error('providerIntentId is required');

  const validStatuses = ['succeeded', 'failed', 'cancelled'];
  if (!validStatuses.includes(rawStatus)) {
    throw new Error(`Invalid webhook payment status: ${rawStatus}`);
  }

  return {
    event: body.event || 'payment_intent.updated',
    providerIntentId,
    status: rawStatus as 'succeeded' | 'failed' | 'cancelled',
    amount: body.amount !== undefined ? Number(body.amount) : undefined,
    currency: body.currency,
    signature: body.signature,
    metadata: body.metadata || {},
  };
}

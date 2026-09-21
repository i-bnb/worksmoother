/**
 * =============================================================================
 * Financial Refunds Validation Schema (Customer & Supplier Disbursements)
 * Maintenance Management ERP — Phase 11 Advanced Finance
 * =============================================================================
 */

export interface RefundCreateDto {
  companyId: string;
  branchId?: string | null;
  refundType: 'customer_refund' | 'supplier_refund';
  partyId: string; // customerId or supplierId
  sourceType: 'credit_note' | 'advance_payment' | 'overpayment';
  sourceId: string; // credit note ID or payment ID
  bankAccountId: string;
  amount: number;
  currency?: string;
  refundDate?: string;
  paymentMethod?: string;
  referenceNumber?: string | null;
  reason: string;
  idempotencyKey?: string | null;
}

export function validateRefundCreate(body: any): RefundCreateDto {
  if (!body) throw new Error('Refund payload is required');
  const companyId = body.companyId || body.company_id;
  const refundType = (body.refundType || body.refund_type || '').toLowerCase();
  const partyId = body.partyId || body.party_id || body.customerId || body.customer_id || body.supplierId || body.supplier_id;
  const sourceType = (body.sourceType || body.source_type || '').toLowerCase();
  const sourceId = body.sourceId || body.source_id;
  const bankAccountId = body.bankAccountId || body.bank_account_id;
  const amount = Number(body.amount);
  const reason = (body.reason || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!['customer_refund', 'supplier_refund'].includes(refundType)) {
    throw new Error('refundType must be either customer_refund or supplier_refund');
  }
  if (!partyId) throw new Error('partyId (customer or supplier ID) is required');
  if (!['credit_note', 'advance_payment', 'overpayment'].includes(sourceType)) {
    throw new Error('sourceType must be credit_note, advance_payment, or overpayment');
  }
  if (!sourceId) throw new Error('sourceId is required');
  if (!bankAccountId) throw new Error('bankAccountId is required');
  if (isNaN(amount) || amount <= 0) throw new Error('Refund amount must be greater than 0');
  if (!reason) throw new Error('A reason is mandatory for financial refund disbursements');

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    refundType: refundType as 'customer_refund' | 'supplier_refund',
    partyId,
    sourceType: sourceType as any,
    sourceId,
    bankAccountId,
    amount,
    currency: body.currency || 'INR',
    refundDate: body.refundDate || body.refund_date || new Date().toISOString().split('T')[0],
    paymentMethod: body.paymentMethod || body.payment_method || 'bank_transfer',
    referenceNumber: body.referenceNumber || body.reference_number || null,
    reason,
    idempotencyKey: body.idempotencyKey || body.idempotency_key || null,
  };
}

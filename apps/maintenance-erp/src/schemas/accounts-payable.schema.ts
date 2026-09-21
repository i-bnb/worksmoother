/**
 * =============================================================================
 * Accounts Payable, 3-Way Matching & Disbursement Validation Schemas
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

export interface SupplierBillLineDto {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  expenseAccountId?: string | null;
  costCenterId?: string | null;
}

export interface SupplierBillCreateDto {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  poId?: string | null;
  goodsReceiptId?: string | null;
  vendorInvoiceNumber?: string | null;
  billDate?: string;
  dueDate?: string;
  currency?: string;
  notes?: string | null;
  lines: SupplierBillLineDto[];
}

export interface ThreeWayMatchRequestDto {
  billId: string;
  priceTolerancePercent?: number;
  quantityTolerancePercent?: number;
}

export interface SupplierPaymentCreateDto {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  billId?: string | null;
  amount: number;
  currency?: string;
  paymentDate?: string;
  paymentMethodId?: string | null;
  bankAccountId?: string | null;
  referenceNumber?: string | null;
  paymentType?: 'standard' | 'advance' | 'refund';
  notes?: string | null;
}

export interface SupplierPaymentReversalDto {
  paymentId: string;
  reversalReason: string;
}

export interface SupplierAgingQueryDto {
  companyId: string;
  asOfDate?: string;
  supplierId?: string;
}

export function validateSupplierBillCreate(body: any): SupplierBillCreateDto {
  if (!body) throw new Error('Supplier bill body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');

  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one item line is required for a supplier bill');
  }

  const validatedLines: SupplierBillLineDto[] = lines.map((l: any, idx: number) => {
    const desc = (l.description || '').trim();
    const qty = Number(l.quantity);
    const unitPrice = Number(l.unitPrice !== undefined ? l.unitPrice : l.unit_price);

    if (!desc) throw new Error(`Line ${idx + 1}: Description is required`);
    if (isNaN(qty) || qty <= 0) throw new Error(`Line ${idx + 1}: Quantity must be greater than 0`);
    if (isNaN(unitPrice) || unitPrice < 0) throw new Error(`Line ${idx + 1}: Unit price must be >= 0`);

    return {
      itemId: l.itemId || l.item_id || null,
      description: desc,
      quantity: qty,
      unitPrice,
      taxRate: l.taxRate !== undefined ? Number(l.taxRate) : 5.0,
      expenseAccountId: l.expenseAccountId || l.expense_account_id || null,
      costCenterId: l.costCenterId || l.cost_center_id || null,
    };
  });

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    supplierId,
    poId: body.poId || body.po_id || null,
    goodsReceiptId: body.goodsReceiptId || body.goods_receipt_id || null,
    vendorInvoiceNumber: body.vendorInvoiceNumber || body.vendor_invoice_number || null,
    billDate: body.billDate || body.bill_date || new Date().toISOString().split('T')[0],
    dueDate: body.dueDate || body.due_date || undefined,
    currency: body.currency || 'AED',
    notes: body.notes ? String(body.notes).trim() : null,
    lines: validatedLines,
  };
}

export function validateThreeWayMatchRequest(body: any): ThreeWayMatchRequestDto {
  if (!body) throw new Error('3-Way Match body is required');
  const billId = body.billId || body.bill_id;
  if (!billId) throw new Error('billId is required for 3-way matching');

  return {
    billId,
    priceTolerancePercent: body.priceTolerancePercent !== undefined ? Number(body.priceTolerancePercent) : 1.0,
    quantityTolerancePercent: body.quantityTolerancePercent !== undefined ? Number(body.quantityTolerancePercent) : 2.0,
  };
}

export function validateSupplierPaymentCreate(body: any): SupplierPaymentCreateDto {
  if (!body) throw new Error('Supplier payment body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;
  const amount = Number(body.amount);

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');
  if (isNaN(amount) || amount <= 0) throw new Error('Payment amount must be greater than 0');

  const paymentType = (body.paymentType || body.payment_type || 'standard').toLowerCase();
  const validTypes = ['standard', 'advance', 'refund'];
  if (!validTypes.includes(paymentType)) {
    throw new Error(`Invalid payment type: ${paymentType}`);
  }

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    supplierId,
    billId: body.billId || body.bill_id || null,
    amount,
    currency: body.currency || 'AED',
    paymentDate: body.paymentDate || body.payment_date || new Date().toISOString().split('T')[0],
    paymentMethodId: body.paymentMethodId || body.payment_method_id || null,
    bankAccountId: body.bankAccountId || body.bank_account_id || null,
    referenceNumber: body.referenceNumber || body.reference_number || null,
    paymentType: paymentType as any,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function validateSupplierPaymentReversal(body: any): SupplierPaymentReversalDto {
  if (!body) throw new Error('Payment reversal body is required');
  const paymentId = body.paymentId || body.payment_id;
  const reversalReason = (body.reversalReason || body.reversal_reason || body.reason || '').trim();

  if (!paymentId) throw new Error('paymentId is required');
  if (!reversalReason) throw new Error('A reversalReason is mandatory for reversing a supplier payment');

  return {
    paymentId,
    reversalReason,
  };
}

export function validateSupplierAgingQuery(query: any): SupplierAgingQueryDto {
  if (!query) throw new Error('Aging query parameters are required');
  const companyId = query.companyId || query.company_id;
  if (!companyId) throw new Error('companyId is required');

  return {
    companyId,
    asOfDate: query.asOfDate || query.as_of_date || new Date().toISOString().split('T')[0],
    supplierId: query.supplierId || query.supplier_id || undefined,
  };
}

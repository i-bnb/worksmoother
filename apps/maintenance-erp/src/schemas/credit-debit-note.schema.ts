/**
 * =============================================================================
 * Credit Notes & Debit Notes (Customer & Supplier) Validation Schemas
 * Maintenance Management ERP — Phase 11 Advanced Finance
 * =============================================================================
 */

export interface NoteLineDto {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  hsnSacCode?: string | null;
  expenseAccountId?: string | null;
}

export interface CustomerCreditNoteCreateDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  invoiceId?: string | null;
  workOrderId?: string | null;
  creditNoteDate?: string;
  creditNoteType?: 'sales_return' | 'post_sale_discount' | 'rate_difference' | 'cancellation' | 'goodwill';
  currency?: string;
  reason: string;
  lines: NoteLineDto[];
}

export interface ApplyCreditNoteDto {
  creditNoteId: string;
  invoiceId: string;
  amountToApply: number;
}

export interface DebitNoteCreateDto {
  companyId: string;
  branchId?: string | null;
  partyType: 'customer' | 'supplier';
  customerId?: string | null;
  supplierId?: string | null;
  referenceInvoiceId?: string | null;
  referenceBillId?: string | null;
  debitNoteDate?: string;
  currency?: string;
  reason: string;
  lines: NoteLineDto[];
}

export interface SupplierCreditNoteCreateDto {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  billId?: string | null;
  poId?: string | null;
  creditNoteDate?: string;
  vendorCreditNoteNumber?: string | null;
  currency?: string;
  reason: string;
  lines: NoteLineDto[];
}

export interface ApplySupplierCreditNoteDto {
  supplierCreditNoteId: string;
  billId: string;
  amountToApply: number;
}

// ---------------------------------------------------------------------------
// Helpers & Validators
// ---------------------------------------------------------------------------

function validateLines(rawLines: any[]): NoteLineDto[] {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('At least one line item is required');
  }

  return rawLines.map((line: any, idx: number) => {
    const description = (line.description || '').trim();
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice ?? line.unit_price);

    if (!description) throw new Error(`Line ${idx + 1}: description is required`);
    if (isNaN(quantity) || quantity <= 0) throw new Error(`Line ${idx + 1}: quantity must be greater than 0`);
    if (isNaN(unitPrice) || unitPrice < 0) throw new Error(`Line ${idx + 1}: unitPrice cannot be negative`);

    return {
      itemId: line.itemId || line.item_id || null,
      description,
      quantity,
      unitPrice,
      taxRate: line.taxRate !== undefined ? Number(line.taxRate) : (line.tax_rate !== undefined ? Number(line.tax_rate) : 0),
      cgstRate: line.cgstRate !== undefined ? Number(line.cgstRate) : (line.cgst_rate !== undefined ? Number(line.cgst_rate) : 0),
      sgstRate: line.sgstRate !== undefined ? Number(line.sgstRate) : (line.sgst_rate !== undefined ? Number(line.sgst_rate) : 0),
      igstRate: line.igstRate !== undefined ? Number(line.igstRate) : (line.igst_rate !== undefined ? Number(line.igst_rate) : 0),
      hsnSacCode: line.hsnSacCode || line.hsn_sac_code || null,
      expenseAccountId: line.expenseAccountId || line.expense_account_id || null,
    };
  });
}

export function validateCustomerCreditNoteCreate(body: any): CustomerCreditNoteCreateDto {
  if (!body) throw new Error('Credit note body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const reason = (body.reason || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!reason) throw new Error('reason is required for credit note creation');

  const lines = validateLines(body.lines);

  const creditNoteType = (body.creditNoteType || body.credit_note_type || 'sales_return').toLowerCase();
  const validTypes = ['sales_return', 'post_sale_discount', 'rate_difference', 'cancellation', 'goodwill'];
  if (!validTypes.includes(creditNoteType)) {
    throw new Error(`Invalid creditNoteType: ${creditNoteType}`);
  }

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    customerId,
    invoiceId: body.invoiceId || body.invoice_id || null,
    workOrderId: body.workOrderId || body.work_order_id || null,
    creditNoteDate: body.creditNoteDate || body.credit_note_date || new Date().toISOString().split('T')[0],
    creditNoteType: creditNoteType as any,
    currency: body.currency || 'INR',
    reason,
    lines,
  };
}

export function validateApplyCreditNote(body: any): ApplyCreditNoteDto {
  if (!body) throw new Error('Apply credit note body is required');
  const creditNoteId = body.creditNoteId || body.credit_note_id;
  const invoiceId = body.invoiceId || body.invoice_id;
  const amountToApply = Number(body.amountToApply ?? body.amount_to_apply ?? body.amount);

  if (!creditNoteId) throw new Error('creditNoteId is required');
  if (!invoiceId) throw new Error('invoiceId is required');
  if (isNaN(amountToApply) || amountToApply <= 0) {
    throw new Error('amountToApply must be greater than 0');
  }

  return {
    creditNoteId,
    invoiceId,
    amountToApply,
  };
}

export function validateDebitNoteCreate(body: any): DebitNoteCreateDto {
  if (!body) throw new Error('Debit note body is required');
  const companyId = body.companyId || body.company_id;
  const partyType = (body.partyType || body.party_type || '').toLowerCase();
  const reason = (body.reason || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!['customer', 'supplier'].includes(partyType)) {
    throw new Error('partyType must be customer or supplier');
  }
  if (!reason) throw new Error('reason is required for debit note creation');

  const customerId = body.customerId || body.customer_id || null;
  const supplierId = body.supplierId || body.supplier_id || null;

  if (partyType === 'customer' && !customerId) {
    throw new Error('customerId is required when partyType is customer');
  }
  if (partyType === 'supplier' && !supplierId) {
    throw new Error('supplierId is required when partyType is supplier');
  }

  const lines = validateLines(body.lines);

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    partyType: partyType as 'customer' | 'supplier',
    customerId,
    supplierId,
    referenceInvoiceId: body.referenceInvoiceId || body.reference_invoice_id || null,
    referenceBillId: body.referenceBillId || body.reference_bill_id || null,
    debitNoteDate: body.debitNoteDate || body.debit_note_date || new Date().toISOString().split('T')[0],
    currency: body.currency || 'INR',
    reason,
    lines,
  };
}

export function validateSupplierCreditNoteCreate(body: any): SupplierCreditNoteCreateDto {
  if (!body) throw new Error('Supplier credit note body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;
  const reason = (body.reason || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');
  if (!reason) throw new Error('reason is required for supplier credit note creation');

  const lines = validateLines(body.lines);

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    supplierId,
    billId: body.billId || body.bill_id || null,
    poId: body.poId || body.po_id || null,
    creditNoteDate: body.creditNoteDate || body.credit_note_date || new Date().toISOString().split('T')[0],
    vendorCreditNoteNumber: body.vendorCreditNoteNumber || body.vendor_credit_note_number || null,
    currency: body.currency || 'INR',
    reason,
    lines,
  };
}

export function validateApplySupplierCreditNote(body: any): ApplySupplierCreditNoteDto {
  if (!body) throw new Error('Apply supplier credit note body is required');
  const supplierCreditNoteId = body.supplierCreditNoteId || body.supplier_credit_note_id;
  const billId = body.billId || body.bill_id;
  const amountToApply = Number(body.amountToApply ?? body.amount_to_apply ?? body.amount);

  if (!supplierCreditNoteId) throw new Error('supplierCreditNoteId is required');
  if (!billId) throw new Error('billId is required');
  if (isNaN(amountToApply) || amountToApply <= 0) {
    throw new Error('amountToApply must be greater than 0');
  }

  return {
    supplierCreditNoteId,
    billId,
    amountToApply,
  };
}

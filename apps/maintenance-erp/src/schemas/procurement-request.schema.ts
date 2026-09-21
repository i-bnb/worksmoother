/**
 * =============================================================================
 * Purchase Request & Supplier Quotation Validation Schemas
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

export interface PurchaseRequestItemDto {
  itemId?: string | null;
  description: string;
  quantity: number;
  unit?: string;
  estimatedUnitPrice?: number;
  requiredDate?: string | null;
  notes?: string | null;
}

export interface PurchaseRequestCreateDto {
  companyId: string;
  workOrderId?: string | null;
  serviceRequestId?: string | null;
  amcContractId?: string | null;
  rentalContractId?: string | null;
  departmentId?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  requiredDate?: string | null;
  notes?: string | null;
  items: PurchaseRequestItemDto[];
}

export interface PurchaseRequestApprovalDto {
  decision: 'approved' | 'rejected';
  comment?: string | null;
  approvalLevel?: number;
}

export interface SupplierQuotationItemDto {
  itemId?: string | null;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  taxRate?: number;
  discountAmount?: number;
}

export interface SupplierQuotationCreateDto {
  companyId: string;
  supplierId: string;
  purchaseRequestId?: string | null;
  quoteNumber: string;
  quoteDate?: string;
  validUntil: string;
  currency?: string;
  freightCharges?: number;
  otherCharges?: number;
  leadTimeDays?: number;
  warrantyTerms?: string | null;
  paymentTerms?: string | null;
  termsAndConditions?: string | null;
  attachments?: string[];
  items: SupplierQuotationItemDto[];
}

export function validatePurchaseRequestCreate(body: any): PurchaseRequestCreateDto {
  if (!body) throw new Error('Purchase request body is required');
  const companyId = body.companyId || body.company_id;
  if (!companyId) throw new Error('companyId is required');

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item line is required for a purchase request');
  }

  const validatedItems: PurchaseRequestItemDto[] = items.map((it: any, idx: number) => {
    const desc = (it.description || '').trim();
    const qty = Number(it.quantity);
    if (!desc) throw new Error(`Item ${idx + 1}: Description is required`);
    if (isNaN(qty) || qty <= 0) throw new Error(`Item ${idx + 1}: Quantity must be greater than 0`);

    return {
      itemId: it.itemId || it.item_id || null,
      description: desc,
      quantity: qty,
      unit: it.unit || 'pcs',
      estimatedUnitPrice: it.estimatedUnitPrice !== undefined ? Number(it.estimatedUnitPrice) : 0,
      requiredDate: it.requiredDate || it.required_date || null,
      notes: it.notes ? String(it.notes).trim() : null,
    };
  });

  const priority = (body.priority || 'medium').toLowerCase();
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (!validPriorities.includes(priority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }

  return {
    companyId,
    workOrderId: body.workOrderId || body.work_order_id || null,
    serviceRequestId: body.serviceRequestId || body.service_request_id || null,
    amcContractId: body.amcContractId || body.amc_contract_id || null,
    rentalContractId: body.rentalContractId || body.rental_contract_id || null,
    departmentId: body.departmentId || body.department_id || null,
    priority: priority as any,
    requiredDate: body.requiredDate || body.required_date || null,
    notes: body.notes ? String(body.notes).trim() : null,
    items: validatedItems,
  };
}

export function validatePurchaseRequestApproval(body: any): PurchaseRequestApprovalDto {
  if (!body) throw new Error('Approval body is required');
  const decision = (body.decision || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('Approval decision must be either "approved" or "rejected"');
  }

  return {
    decision: decision as 'approved' | 'rejected',
    comment: body.comment ? String(body.comment).trim() : null,
    approvalLevel: body.approvalLevel !== undefined ? Number(body.approvalLevel) : 1,
  };
}

export function validateSupplierQuotationCreate(body: any): SupplierQuotationCreateDto {
  if (!body) throw new Error('Supplier quotation body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;
  const quoteNumber = (body.quoteNumber || body.quote_number || '').trim();
  const validUntil = body.validUntil || body.valid_until;

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');
  if (!quoteNumber) throw new Error('quoteNumber is required');
  if (!validUntil) throw new Error('validUntil date is required');

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item line is required for a supplier quotation');
  }

  const validatedItems: SupplierQuotationItemDto[] = items.map((it: any, idx: number) => {
    const desc = (it.description || '').trim();
    const qty = Number(it.quantity);
    const unitPrice = Number(it.unitPrice !== undefined ? it.unitPrice : it.unit_price);

    if (!desc) throw new Error(`Item ${idx + 1}: Description is required`);
    if (isNaN(qty) || qty <= 0) throw new Error(`Item ${idx + 1}: Quantity must be greater than 0`);
    if (isNaN(unitPrice) || unitPrice < 0) throw new Error(`Item ${idx + 1}: Unit price must be >= 0`);

    return {
      itemId: it.itemId || it.item_id || null,
      description: desc,
      quantity: qty,
      unit: it.unit || 'pcs',
      unitPrice,
      taxRate: it.taxRate !== undefined ? Number(it.taxRate) : 5.0,
      discountAmount: it.discountAmount !== undefined ? Number(it.discountAmount) : 0,
    };
  });

  return {
    companyId,
    supplierId,
    purchaseRequestId: body.purchaseRequestId || body.purchase_request_id || null,
    quoteNumber,
    quoteDate: body.quoteDate || body.quote_date || new Date().toISOString().split('T')[0],
    validUntil,
    currency: body.currency || 'AED',
    freightCharges: body.freightCharges !== undefined ? Number(body.freightCharges) : 0,
    otherCharges: body.otherCharges !== undefined ? Number(body.otherCharges) : 0,
    leadTimeDays: body.leadTimeDays !== undefined ? Number(body.leadTimeDays) : 7,
    warrantyTerms: body.warrantyTerms || body.warranty_terms || null,
    paymentTerms: body.paymentTerms || body.payment_terms || null,
    termsAndConditions: body.termsAndConditions || body.terms_and_conditions || null,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    items: validatedItems,
  };
}

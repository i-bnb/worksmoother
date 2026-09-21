/**
 * =============================================================================
 * Purchase Order, Revisions & Approval Rule Validation Schemas
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

export interface PurchaseOrderItemDto {
  itemId: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  discountPercent?: number;
}

export interface PurchaseOrderCreateDto {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  purchaseRequestId?: string | null;
  supplierQuotationId?: string | null;
  orderDate?: string;
  expectedDate?: string | null;
  currency?: string;
  freightCharges?: number;
  otherCharges?: number;
  discountAmount?: number;
  shippingAddress?: string | null;
  billingAddress?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  lines: PurchaseOrderItemDto[];
}

export interface PurchaseOrderUpdateDto {
  expectedDate?: string | null;
  shippingAddress?: string | null;
  billingAddress?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  changeReason: string;
  lines?: PurchaseOrderItemDto[];
}

export interface PurchaseOrderAcknowledgementDto {
  status: 'acknowledged' | 'partially_accepted' | 'rejected';
  notes?: string | null;
  expectedDeliveryDate?: string | null;
}

export interface ProcurementApprovalRuleDto {
  companyId: string;
  ruleName: string;
  minAmount: number;
  maxAmount?: number | null;
  departmentId?: string | null;
  category?: string | null;
  requiredRole: string;
  approvalLevel?: number;
}

export function validatePurchaseOrderCreate(body: any): PurchaseOrderCreateDto {
  if (!body) throw new Error('Purchase order body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');

  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one item line is required for a purchase order');
  }

  const validatedLines: PurchaseOrderItemDto[] = lines.map((l: any, idx: number) => {
    const itemId = l.itemId || l.item_id;
    const qty = Number(l.quantity);
    const unitPrice = Number(l.unitPrice !== undefined ? l.unitPrice : l.unit_price);

    if (!itemId) throw new Error(`Line ${idx + 1}: itemId is required`);
    if (isNaN(qty) || qty <= 0) throw new Error(`Line ${idx + 1}: Quantity must be greater than 0`);
    if (isNaN(unitPrice) || unitPrice < 0) throw new Error(`Line ${idx + 1}: Unit price must be >= 0`);

    return {
      itemId,
      quantity: qty,
      unitPrice,
      taxRate: l.taxRate !== undefined ? Number(l.taxRate) : 5.0,
      discountPercent: l.discountPercent !== undefined ? Number(l.discountPercent) : 0,
    };
  });

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    supplierId,
    purchaseRequestId: body.purchaseRequestId || body.purchase_request_id || null,
    supplierQuotationId: body.supplierQuotationId || body.supplier_quotation_id || null,
    orderDate: body.orderDate || body.order_date || new Date().toISOString().split('T')[0],
    expectedDate: body.expectedDate || body.expected_date || null,
    currency: body.currency || 'AED',
    freightCharges: body.freightCharges !== undefined ? Number(body.freightCharges) : 0,
    otherCharges: body.otherCharges !== undefined ? Number(body.otherCharges) : 0,
    discountAmount: body.discountAmount !== undefined ? Number(body.discountAmount) : 0,
    shippingAddress: body.shippingAddress || body.shipping_address || null,
    billingAddress: body.billingAddress || body.billing_address || null,
    paymentTerms: body.paymentTerms || body.payment_terms || null,
    notes: body.notes ? String(body.notes).trim() : null,
    lines: validatedLines,
  };
}

export function validatePurchaseOrderUpdate(body: any): PurchaseOrderUpdateDto {
  if (!body) throw new Error('Purchase order update body is required');
  const changeReason = (body.changeReason || body.change_reason || '').trim();
  if (!changeReason) {
    throw new Error('A changeReason is mandatory when updating an existing Purchase Order');
  }

  return {
    expectedDate: body.expectedDate || body.expected_date || null,
    shippingAddress: body.shippingAddress || body.shipping_address || null,
    billingAddress: body.billingAddress || body.billing_address || null,
    paymentTerms: body.paymentTerms || body.payment_terms || null,
    notes: body.notes ? String(body.notes).trim() : null,
    changeReason,
    lines: Array.isArray(body.lines) ? body.lines : undefined,
  };
}

export function validatePurchaseOrderAcknowledgement(body: any): PurchaseOrderAcknowledgementDto {
  if (!body) throw new Error('Acknowledgement body is required');
  const status = (body.status || '').toLowerCase();
  const valid = ['acknowledged', 'partially_accepted', 'rejected'];
  if (!valid.includes(status)) {
    throw new Error(`Invalid acknowledgement status: ${status}. Must be one of ${valid.join(', ')}`);
  }

  return {
    status: status as any,
    notes: body.notes ? String(body.notes).trim() : null,
    expectedDeliveryDate: body.expectedDeliveryDate || body.expected_delivery_date || null,
  };
}

export function validateProcurementApprovalRule(body: any): ProcurementApprovalRuleDto {
  if (!body) throw new Error('Procurement approval rule body is required');
  const companyId = body.companyId || body.company_id;
  const ruleName = (body.ruleName || body.rule_name || '').trim();
  const minAmount = Number(body.minAmount !== undefined ? body.minAmount : body.min_amount);

  if (!companyId) throw new Error('companyId is required');
  if (!ruleName) throw new Error('ruleName is required');
  if (isNaN(minAmount) || minAmount < 0) throw new Error('minAmount must be >= 0');

  return {
    companyId,
    ruleName,
    minAmount,
    maxAmount: body.maxAmount !== undefined ? Number(body.maxAmount) : null,
    departmentId: body.departmentId || body.department_id || null,
    category: body.category || null,
    requiredRole: body.requiredRole || body.required_role || 'operations_manager',
    approvalLevel: body.approvalLevel !== undefined ? Number(body.approvalLevel) : 1,
  };
}

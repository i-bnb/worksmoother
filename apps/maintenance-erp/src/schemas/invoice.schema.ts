export interface InvoiceItemCreateDto {
  lineType?: 'service' | 'part' | 'material' | 'labour';
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  taxRate?: number;
  isInclusive?: boolean;
  isExempt?: boolean;
  quotationLineId?: string | null;
  workOrderLineId?: string | null;
  jobMaterialMovementId?: string | null;
  hsnSacCode?: string | null;
}

export interface InvoiceCreateDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  siteId?: string | null;
  workOrderId?: string | null;
  quotationId?: string | null;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  discountAmount?: number;
  additionalCharges?: number;
  roundingAdjustment?: number;
  notes?: string | null;
  termsAndConditions?: string | null;
  lines: InvoiceItemCreateDto[];
  idempotencyKey?: string | null;
  supplierState?: string | null;
  customerState?: string | null;
}

export interface InvoiceDetailDto {
  id: string;
  invoiceNumber: string;
  status: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  amountCredited: number;
  amountDue: number;
  lines: any[];
}

export function validateInvoiceCreate(body: any): InvoiceCreateDto {
  if (!body) throw new Error('Invoice request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new Error('Invoice must contain at least one billable line item');
  }

  for (let i = 0; i < body.lines.length; i++) {
    const l = body.lines[i];
    if (!l.description || typeof l.description !== 'string') {
      throw new Error(`Line ${i + 1}: description is required`);
    }
    if (typeof l.quantity !== 'number' || l.quantity <= 0) {
      throw new Error(`Line ${i + 1}: quantity must be a positive number`);
    }
    if (typeof l.unitPrice !== 'number' || l.unitPrice < 0) {
      throw new Error(`Line ${i + 1}: unitPrice must be non-negative`);
    }
  }

  return body as InvoiceCreateDto;
}

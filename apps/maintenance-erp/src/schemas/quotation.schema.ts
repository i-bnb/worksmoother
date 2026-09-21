export interface QuotationItemCreateDto {
  lineType?: 'service' | 'part' | 'material' | 'labour';
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
  isInclusive?: boolean;
  isExempt?: boolean;
  hsnSacCode?: string | null;
}

export interface QuotationCreateDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  siteId?: string | null;
  workOrderId?: string | null;
  validUntil?: string | null;
  currency?: string;
  discountPercent?: number;
  discountAmount?: number;
  additionalCharges?: number;
  notes?: string | null;
  termsAndConditions?: string | null;
  lines: QuotationItemCreateDto[];
  idempotencyKey?: string | null;
  supplierState?: string | null;
  customerState?: string | null;
}

export interface QuotationUpdateDto {
  validUntil?: string | null;
  discountPercent?: number;
  discountAmount?: number;
  additionalCharges?: number;
  notes?: string | null;
  termsAndConditions?: string | null;
  lines?: QuotationItemCreateDto[];
}

export interface QuotationDetailDto {
  id: string;
  quotationNumber: string;
  version: number;
  status: string;
  customerId: string;
  quotationDate: string;
  validUntil: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
  lines: any[];
}

export function validateQuotationCreate(body: any): QuotationCreateDto {
  if (!body) throw new Error('Quotation request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new Error('Quotation must contain at least one line item');
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
    if (l.discountPercent !== undefined && (l.discountPercent < 0 || l.discountPercent > 100)) {
      throw new Error(`Line ${i + 1}: discountPercent must be between 0 and 100`);
    }
  }

  return body as QuotationCreateDto;
}

import { SupabaseClient } from '@supabase/supabase-js';
import { QuotationCalculationService, QuotationLineInput } from './quotation-calculation.service.js';

export interface CreateQuotationDto {
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
  lines: QuotationLineInput[];
  idempotencyKey?: string | null;
  supplierState?: string | null;
  customerState?: string | null;
}

export class QuotationService {
  /**
   * Creates a draft quotation after performing server-side deterministic calculations.
   */
  static async createQuotation(client: SupabaseClient, dto: CreateQuotationDto) {
    // 1. Run Calculation Engine
    const calculated = QuotationCalculationService.calculate({
      lines: dto.lines,
      headerDiscountPercent: dto.discountPercent,
      headerDiscountAmount: dto.discountAmount,
      additionalCharges: dto.additionalCharges,
      supplierState: dto.supplierState,
      customerState: dto.customerState,
    });

    // 2. Prepare payload for transactional RPC or insert
    const linePayload = calculated.lines.map((l, index) => ({
      line_number: index + 1,
      line_type: l.lineType,
      item_id: l.itemId,
      description: l.description,
      quantity: l.quantity.toNumber(),
      unit_price: l.unitPrice.toNumber(),
      discount_percent: l.discountPercent,
      discount_amount: l.discountAmount.toNumber(),
      tax_rate: l.taxRate,
      taxable_amount: l.taxableAmount.toNumber(),
      tax_amount: l.taxAmount.toNumber(),
      line_total: l.lineTotal.toNumber(),
      cgst_rate: l.cgstRate,
      cgst_amount: l.cgstAmount.toNumber(),
      sgst_rate: l.sgstRate,
      sgst_amount: l.sgstAmount.toNumber(),
      igst_rate: l.igstRate,
      igst_amount: l.igstAmount.toNumber(),
      hsn_sac_code: l.hsnSacCode,
    }));

    const { data, error } = await client.rpc('create_quotation', {
      p_customer_id: dto.customerId,
      p_lines: linePayload,
      p_site_id: dto.siteId || null,
      p_work_order_id: dto.workOrderId || null,
      p_valid_until: dto.validUntil || null,
      p_currency: dto.currency || 'INR',
      p_discount_percent: dto.discountPercent || 0,
      p_notes: dto.notes || null,
      p_terms_and_conditions: dto.termsAndConditions || null,
      p_idempotency_key: dto.idempotencyKey || null,
    });

    if (error) {
      throw new Error(`Quotation creation failed: ${error.message}`);
    }

    return {
      ...data,
      calculatedTotals: {
        subtotal: calculated.subtotal.toNumber(),
        discountAmount: calculated.discountAmount.toNumber(),
        taxableAmount: calculated.taxableAmount.toNumber(),
        taxAmount: calculated.taxAmount.toNumber(),
        grandTotal: calculated.grandTotal.toNumber(),
        cgstTotal: calculated.cgstTotal.toNumber(),
        sgstTotal: calculated.sgstTotal.toNumber(),
        igstTotal: calculated.igstTotal.toNumber(),
      },
    };
  }

  static async submitQuotation(client: SupabaseClient, quotationId: string) {
    const { data, error } = await client.rpc('submit_quotation', {
      p_quotation_id: quotationId,
    });
    if (error) throw new Error(`Quotation submit failed: ${error.message}`);
    return data;
  }

  static async approveQuotation(client: SupabaseClient, quotationId: string) {
    const { data, error } = await client.rpc('approve_quotation', {
      p_quotation_id: quotationId,
    });
    if (error) throw new Error(`Quotation approval failed: ${error.message}`);
    return data;
  }

  static async acceptQuotation(client: SupabaseClient, quotationId: string) {
    const { data, error } = await client.rpc('accept_quotation', {
      p_quotation_id: quotationId,
    });
    if (error) throw new Error(`Quotation accept failed: ${error.message}`);
    return data;
  }

  static async rejectQuotation(client: SupabaseClient, quotationId: string, reason: string) {
    const { data, error } = await client
      .from('quotations')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', quotationId)
      .select()
      .single();

    if (error) throw new Error(`Quotation reject failed: ${error.message}`);
    return data;
  }

  static async reviseQuotation(client: SupabaseClient, quotationId: string, modifications: any = {}) {
    const { data, error } = await client.rpc('revise_quotation', {
      p_quotation_id: quotationId,
      p_modifications: modifications,
    });
    if (error) throw new Error(`Quotation revision failed: ${error.message}`);
    return data;
  }

  static async convertToInvoice(
    client: SupabaseClient,
    quotationId: string,
    options: { dueDate?: string | null; notes?: string | null; idempotencyKey?: string | null } = {}
  ) {
    const { data, error } = await client.rpc('convert_quotation_to_invoice', {
      p_quotation_id: quotationId,
      p_due_date: options.dueDate || null,
      p_notes: options.notes || null,
      p_idempotency_key: options.idempotencyKey || null,
    });

    if (error) throw new Error(`Conversion to invoice failed: ${error.message}`);
    return data;
  }
}

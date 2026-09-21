import { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceCalculationService, InvoiceLineInput } from './invoice-calculation.service.js';

export interface CreateInvoiceDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  siteId?: string | null;
  workOrderId?: string | null;
  quotationId?: string | null;
  salesOrderId?: string | null;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  discountAmount?: number;
  additionalCharges?: number;
  roundingAdjustment?: number;
  notes?: string | null;
  termsAndConditions?: string | null;
  lines: InvoiceLineInput[];
  idempotencyKey?: string | null;
  supplierState?: string | null;
  customerState?: string | null;
}

export class InvoiceService {
  /**
   * Creates a commercial invoice with server-side arbitrary-precision calculation.
   */
  static async createInvoice(client: SupabaseClient, dto: CreateInvoiceDto) {
    // 1. Calculate totals deterministic
    const calculated = InvoiceCalculationService.calculate({
      lines: dto.lines,
      discountAmount: dto.discountAmount,
      additionalCharges: dto.additionalCharges,
      roundingAdjustment: dto.roundingAdjustment,
      supplierState: dto.supplierState,
      customerState: dto.customerState,
    });

    // 2. Insert Header
    const { data: header, error: headErr } = await client
      .from('invoices')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        customer_id: dto.customerId,
        site_id: dto.siteId || null,
        work_order_id: dto.workOrderId || null,
        quotation_id: dto.quotationId || null,
        sales_order_id: dto.salesOrderId || null,
        invoice_date: dto.invoiceDate || new Date().toISOString().slice(0, 10),
        due_date: dto.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        currency: dto.currency || 'INR',
        subtotal: calculated.subtotal.toNumber(),
        discount_amount: calculated.discountAmount.toNumber(),
        taxable_amount: calculated.taxableAmount.toNumber(),
        tax_amount: calculated.taxAmount.toNumber(),
        rounding_adjustment: calculated.roundingAdjustment.toNumber(),
        grand_total: calculated.grandTotal.toNumber(),
        amount_paid: 0.0,
        amount_credited: 0.0,
        status: 'draft',
        notes: dto.notes || null,
        terms_and_conditions: dto.termsAndConditions || null,
        idempotency_key: dto.idempotencyKey || null,
      })
      .select()
      .single();

    if (headErr) throw new Error(`Invoice header creation failed: ${headErr.message}`);

    // 3. Insert Lines
    const linesToInsert = calculated.lines.map((line, idx) => ({
      invoice_id: header.id,
      line_number: idx + 1,
      line_type: line.lineType,
      item_id: line.itemId,
      description: line.description,
      quantity: line.quantity.toNumber(),
      unit_price: line.unitPrice.toNumber(),
      discount_amount: line.discountAmount.toNumber(),
      tax_rate: line.taxRate,
      taxable_amount: line.taxableAmount.toNumber(),
      tax_amount: line.taxAmount.toNumber(),
      line_total: line.lineTotal.toNumber(),
      quotation_line_id: line.quotationLineId,
      work_order_line_id: line.workOrderLineId,
      job_material_movement_id: line.jobMaterialMovementId,
      cgst_rate: line.cgstRate,
      cgst_amount: line.cgstAmount.toNumber(),
      sgst_rate: line.sgstRate,
      sgst_amount: line.sgstAmount.toNumber(),
      igst_rate: line.igstRate,
      igst_amount: line.igstAmount.toNumber(),
      hsn_sac_code: line.hsnSacCode,
    }));

    const { error: lineErr } = await client.from('invoice_lines').insert(linesToInsert);
    if (lineErr) throw new Error(`Invoice lines creation failed: ${lineErr.message}`);

    return {
      ...header,
      lines: linesToInsert,
      calculatedTotals: {
        subtotal: calculated.subtotal.toNumber(),
        taxAmount: calculated.taxAmount.toNumber(),
        grandTotal: calculated.grandTotal.toNumber(),
        balanceDue: calculated.balanceDue.toNumber(),
      },
    };
  }

  /**
   * Generates invoice directly from billable components of a completed Work Order.
   */
  static async createFromWorkOrder(
    client: SupabaseClient,
    workOrderId: string,
    options: { dueDate?: string | null; notes?: string | null; idempotencyKey?: string | null } = {}
  ) {
    const { data, error } = await client.rpc('create_invoice_from_work_order', {
      p_work_order_id: workOrderId,
      p_due_date: options.dueDate || null,
      p_notes: options.notes || null,
      p_idempotency_key: options.idempotencyKey || null,
    });

    if (error) throw new Error(`Work order invoice generation failed: ${error.message}`);
    return data;
  }

  /**
   * Issues draft invoice, activating immutability and generating posting eligibility.
   */
  static async issueInvoice(client: SupabaseClient, invoiceId: string) {
    const { data, error } = await client.rpc('issue_invoice', {
      p_invoice_id: invoiceId,
    });
    if (error) throw new Error(`Invoice issue failed: ${error.message}`);
    return data;
  }

  /**
   * Voids an issued invoice provided no payments have been collected.
   */
  static async voidInvoice(client: SupabaseClient, invoiceId: string, reason: string) {
    const { data, error } = await client.rpc('void_invoice', {
      p_invoice_id: invoiceId,
      p_reason: reason,
    });
    if (error) throw new Error(`Invoice void failed: ${error.message}`);
    return data;
  }

  /**
   * Retrieves an invoice with its lines, payment allocations, and live balance.
   */
  static async getInvoice(client: SupabaseClient, invoiceId: string) {
    const { data, error } = await client
      .from('invoices')
      .select('*, invoice_lines(*), payment_allocations(*)')
      .eq('id', invoiceId)
      .single();

    if (error) throw new Error(`Invoice fetch failed: ${error.message}`);
    return data;
  }
}

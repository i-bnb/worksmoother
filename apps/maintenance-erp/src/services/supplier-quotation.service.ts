/**
 * =============================================================================
 * Supplier Quotation & Multi-Vendor Procurement Comparison Service
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { SupplierQuotationCreateDto } from '../schemas/procurement-request.schema.js';

export interface QuotationComparisonMatrix {
  purchaseRequestId?: string | null;
  items: Array<{
    itemId?: string | null;
    description: string;
    quantity: number;
    supplierQuotes: Array<{
      supplierId: string;
      supplierName: string;
      quotationId: string;
      quoteNumber: string;
      unitPrice: number;
      lineTotal: number;
      leadTimeDays: number;
      warrantyTerms?: string | null;
    }>;
  }>;
  supplierSummaries: Array<{
    supplierId: string;
    supplierName: string;
    quotationId: string;
    quoteNumber: string;
    grandTotal: number;
    freightCharges: number;
    leadTimeDays: number;
    validUntil: string;
  }>;
}

export class SupplierQuotationService {
  /**
   * Registers a supplier proposal / commercial quotation with line items.
   */
  static async createSupplierQuotation(
    client: SupabaseClient,
    dto: SupplierQuotationCreateDto,
    userId?: string
  ) {
    // 1. Calculate line totals and grand total
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    const calculatedLines = dto.items.map((it) => {
      const lineSub = it.quantity * it.unitPrice;
      const discount = it.discountAmount || 0;
      const taxable = Math.max(0, lineSub - discount);
      const tax = (taxable * (it.taxRate || 5.0)) / 100.0;
      const total = taxable + tax;

      subtotal += lineSub;
      totalDiscount += discount;
      totalTax += tax;

      return {
        ...it,
        taxAmount: Math.round(tax * 1000) / 1000,
        lineTotal: Math.round(total * 1000) / 1000,
      };
    });

    const freight = dto.freightCharges || 0;
    const other = dto.otherCharges || 0;
    const grandTotal = subtotal - totalDiscount + totalTax + freight + other;

    // 2. Insert header
    const { data: quote, error: qErr } = await client
      .from('supplier_quotations')
      .insert({
        company_id: dto.companyId,
        supplier_id: dto.supplierId,
        purchase_request_id: dto.purchaseRequestId || null,
        quote_number: dto.quoteNumber,
        quote_date: dto.quoteDate || new Date().toISOString().split('T')[0],
        valid_until: dto.validUntil,
        currency: dto.currency || 'AED',
        subtotal: Math.round(subtotal * 1000) / 1000,
        discount_amount: Math.round(totalDiscount * 1000) / 1000,
        tax_amount: Math.round(totalTax * 1000) / 1000,
        freight_charges: Math.round(freight * 1000) / 1000,
        other_charges: Math.round(other * 1000) / 1000,
        grand_total: Math.round(grandTotal * 1000) / 1000,
        lead_time_days: dto.leadTimeDays || 7,
        warranty_terms: dto.warrantyTerms || null,
        payment_terms: dto.paymentTerms || null,
        terms_and_conditions: dto.termsAndConditions || null,
        attachments: dto.attachments || [],
        status: 'received',
        created_by: userId || null,
      })
      .select('*')
      .single();

    if (qErr) throw new Error(`Failed to create supplier quotation: ${qErr.message}`);

    // 3. Insert line items
    const linesPayload = calculatedLines.map((l) => ({
      quotation_id: quote.id,
      item_id: l.itemId || null,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit || 'pcs',
      unit_price: l.unitPrice,
      tax_rate: l.taxRate || 5.0,
      tax_amount: l.taxAmount,
      discount_amount: l.discountAmount || 0,
      line_total: l.lineTotal,
    }));

    const { error: lineErr } = await client
      .from('supplier_quotation_items')
      .insert(linesPayload);

    if (lineErr) throw new Error(`Failed to create quotation items: ${lineErr.message}`);

    return quote;
  }

  /**
   * Generates a multi-vendor comparison matrix for procurement decision-making.
   */
  static async compareSupplierQuotations(
    client: SupabaseClient,
    companyId: string,
    purchaseRequestId: string
  ): Promise<QuotationComparisonMatrix> {
    const { data: quotes, error } = await client
      .from('supplier_quotations')
      .select(`
        id,
        quote_number,
        supplier_id,
        grand_total,
        freight_charges,
        lead_time_days,
        valid_until,
        warranty_terms,
        payment_terms,
        suppliers (id, name),
        supplier_quotation_items (*)
      `)
      .eq('company_id', companyId)
      .eq('purchase_request_id', purchaseRequestId);

    if (error) throw new Error(`Failed to fetch quotation comparisons: ${error.message}`);

    const quoteList = quotes || [];
    const itemMap = new Map<string, any>();
    const supplierSummaries: QuotationComparisonMatrix['supplierSummaries'] = [];

    for (const q of quoteList) {
      const sup = q.suppliers as any;
      const supName = sup?.name || 'Unknown Supplier';

      supplierSummaries.push({
        supplierId: q.supplier_id,
        supplierName: supName,
        quotationId: q.id,
        quoteNumber: q.quote_number,
        grandTotal: Number(q.grand_total),
        freightCharges: Number(q.freight_charges || 0),
        leadTimeDays: Number(q.lead_time_days || 0),
        validUntil: q.valid_until,
      });

      const items = (q.supplier_quotation_items as any[]) || [];
      for (const it of items) {
        const key = it.item_id ? `item_${it.item_id}` : `desc_${it.description.toLowerCase().trim()}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            itemId: it.item_id,
            description: it.description,
            quantity: Number(it.quantity),
            supplierQuotes: [],
          });
        }

        itemMap.get(key).supplierQuotes.push({
          supplierId: q.supplier_id,
          supplierName: supName,
          quotationId: q.id,
          quoteNumber: q.quote_number,
          unitPrice: Number(it.unit_price),
          lineTotal: Number(it.line_total),
          leadTimeDays: Number(q.lead_time_days || 0),
          warrantyTerms: q.warranty_terms,
        });
      }
    }

    return {
      purchaseRequestId,
      items: Array.from(itemMap.values()),
      supplierSummaries,
    };
  }
}

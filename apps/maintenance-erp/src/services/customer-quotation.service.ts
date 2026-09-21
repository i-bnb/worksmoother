/**
 * =============================================================================
 * Customer Quotations & Approval Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  CustomerQuotationApproveDto,
  CustomerQuotationRejectDto,
  CustomerSafeQuotationDto,
} from '../schemas/customer-payment.schema.js';

export class CustomerQuotationService {
  /**
   * Lists customer-facing quotations.
   * Internal draft or pending-internal-review quotes are strictly filtered out.
   */
  static async listQuotations(
    client: SupabaseClient,
    customerId: string,
    filter?: { status?: string }
  ): Promise<CustomerSafeQuotationDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('quotations')
      .select(`
        id,
        quotation_number,
        version,
        quotation_date,
        valid_until,
        currency,
        subtotal,
        discount_amount,
        tax_amount,
        grand_total,
        status,
        terms_and_conditions,
        customer_signatory_name,
        customer_approval_notes,
        accepted_at,
        rejected_at,
        rejection_reason,
        quotation_lines (
          id,
          line_type,
          description,
          quantity,
          unit_price,
          discount_amount,
          tax_amount,
          total_amount
        )
      `)
      .eq('customer_id', customerId)
      .in('status', ['sent', 'approved', 'accepted', 'rejected', 'expired']);

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    const { data: quotes, error } = await query.order('quotation_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to list customer quotations: ${error.message}`);
    }

    return (quotes || []).map((q: any) => ({
      id: q.id,
      quotationNumber: q.quotation_number,
      version: q.version,
      quotationDate: q.quotation_date,
      validUntil: q.valid_until,
      currency: q.currency,
      subtotal: Number(q.subtotal),
      discountAmount: Number(q.discount_amount),
      taxAmount: Number(q.tax_amount),
      grandTotal: Number(q.grand_total),
      status: q.status,
      termsAndConditions: q.terms_and_conditions,
      customerSignatoryName: q.customer_signatory_name,
      customerApprovalNotes: q.customer_approval_notes,
      acceptedAt: q.accepted_at,
      rejectedAt: q.rejected_at,
      rejectionReason: q.rejection_reason,
      lines: ((q.quotation_lines as any[]) || []).map((l: any) => ({
        id: l.id,
        lineType: l.line_type,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        discountAmount: Number(l.discount_amount || 0),
        taxAmount: Number(l.tax_amount || 0),
        totalAmount: Number(l.total_amount),
      })),
    }));
  }

  /**
   * Retrieves single quotation detail for the customer.
   */
  static async getQuotationDetail(
    client: SupabaseClient,
    customerId: string,
    quotationId: string
  ): Promise<CustomerSafeQuotationDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!quotationId) throw new Error('quotationId is required');

    const { data: q, error } = await client
      .from('quotations')
      .select(`
        id,
        quotation_number,
        version,
        quotation_date,
        valid_until,
        currency,
        subtotal,
        discount_amount,
        tax_amount,
        grand_total,
        status,
        terms_and_conditions,
        customer_signatory_name,
        customer_approval_notes,
        accepted_at,
        rejected_at,
        rejection_reason,
        quotation_lines (
          id,
          line_type,
          description,
          quantity,
          unit_price,
          discount_amount,
          tax_amount,
          total_amount
        )
      `)
      .eq('id', quotationId)
      .eq('customer_id', customerId)
      .single();

    if (error || !q) {
      throw new Error('Quotation not found or does not belong to your account');
    }

    // Shield internal drafts from customer view
    if (q.status === 'draft' || q.status === 'submitted' || q.status === 'pending_approval') {
      throw new Error('Quotation is undergoing internal review and is not yet available');
    }

    return {
      id: q.id,
      quotationNumber: q.quotation_number,
      version: q.version,
      quotationDate: q.quotation_date,
      validUntil: q.valid_until,
      currency: q.currency,
      subtotal: Number(q.subtotal),
      discountAmount: Number(q.discount_amount),
      taxAmount: Number(q.tax_amount),
      grandTotal: Number(q.grand_total),
      status: q.status,
      termsAndConditions: q.terms_and_conditions,
      customerSignatoryName: q.customer_signatory_name,
      customerApprovalNotes: q.customer_approval_notes,
      acceptedAt: q.accepted_at,
      rejectedAt: q.rejected_at,
      rejectionReason: q.rejection_reason,
      lines: ((q.quotation_lines as any[]) || []).map((l: any) => ({
        id: l.id,
        lineType: l.line_type,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        discountAmount: Number(l.discount_amount || 0),
        taxAmount: Number(l.tax_amount || 0),
        totalAmount: Number(l.total_amount),
      })),
    };
  }

  /**
   * Atomically approves a quotation from the customer portal.
   */
  static async approveQuotation(
    client: SupabaseClient,
    companyId: string,
    customerId: string,
    quotationId: string,
    dto: CustomerQuotationApproveDto,
    userId?: string
  ): Promise<{ quotationId: string; status: string; acceptedAt: string }> {
    // Try RPC first
    const { data: rpcResult, error: rpcErr } = await client.rpc('approve_portal_quotation', {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_quote_id: quotationId,
      p_user_id: userId || '00000000-0000-0000-0000-000000000000',
      p_signatory_name: dto.signatoryName,
      p_notes: dto.notes || null,
    });

    if (!rpcErr && rpcResult) {
      return {
        quotationId: rpcResult.quotation_id,
        status: rpcResult.status,
        acceptedAt: rpcResult.accepted_at,
      };
    }

    // Fallback: Direct transactional query
    const { data: quote, error: findErr } = await client
      .from('quotations')
      .select('id, quotation_number, status, valid_until')
      .eq('id', quotationId)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .single();

    if (findErr || !quote) {
      throw new Error('Quotation not found or does not belong to your account');
    }

    if (quote.status !== 'sent' && quote.status !== 'approved') {
      throw new Error(`Quotation cannot be approved in its current status: ${quote.status}`);
    }

    const today = new Date().toISOString().split('T')[0];
    if (quote.valid_until < today) {
      throw new Error(`Quotation has expired on ${quote.valid_until}`);
    }

    const acceptedAt = new Date().toISOString();
    const { error: updateErr } = await client
      .from('quotations')
      .update({
        status: 'accepted',
        accepted_at: acceptedAt,
        customer_signatory_name: dto.signatoryName,
        customer_approval_notes: dto.notes || null,
        updated_at: acceptedAt,
      })
      .eq('id', quotationId);

    if (updateErr) {
      throw new Error(`Failed to approve quotation: ${updateErr.message}`);
    }

    return {
      quotationId,
      status: 'accepted',
      acceptedAt,
    };
  }

  /**
   * Atomically rejects a quotation from the customer portal.
   */
  static async rejectQuotation(
    client: SupabaseClient,
    companyId: string,
    customerId: string,
    quotationId: string,
    dto: CustomerQuotationRejectDto,
    userId?: string
  ): Promise<{ quotationId: string; status: string; rejectedAt: string }> {
    // Try RPC first
    const { data: rpcResult, error: rpcErr } = await client.rpc('reject_portal_quotation', {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_quote_id: quotationId,
      p_user_id: userId || '00000000-0000-0000-0000-000000000000',
      p_rejection_reason: dto.rejectionReason,
    });

    if (!rpcErr && rpcResult) {
      return {
        quotationId: rpcResult.quotation_id,
        status: rpcResult.status,
        rejectedAt: rpcResult.rejected_at,
      };
    }

    // Fallback: Direct query
    const { data: quote, error: findErr } = await client
      .from('quotations')
      .select('id, quotation_number, status')
      .eq('id', quotationId)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .single();

    if (findErr || !quote) {
      throw new Error('Quotation not found or does not belong to your account');
    }

    if (quote.status !== 'sent' && quote.status !== 'approved') {
      throw new Error(`Quotation cannot be rejected in its current status: ${quote.status}`);
    }

    const rejectedAt = new Date().toISOString();
    const { error: updateErr } = await client
      .from('quotations')
      .update({
        status: 'rejected',
        rejected_at: rejectedAt,
        rejection_reason: dto.rejectionReason,
        updated_at: rejectedAt,
      })
      .eq('id', quotationId);

    if (updateErr) {
      throw new Error(`Failed to reject quotation: ${updateErr.message}`);
    }

    return {
      quotationId,
      status: 'rejected',
      rejectedAt,
    };
  }
}

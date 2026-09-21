/**
 * =============================================================================
 * Customer Invoicing & Payment Intent Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PaymentIntentCreateDto,
  PaymentIntentWebhookDto,
  CustomerSafeInvoiceDto,
} from '../schemas/customer-payment.schema.js';

export interface PaymentIntentResult {
  intentId: string;
  providerIntentId: string;
  providerClientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export class CustomerPaymentService {
  /**
   * Lists commercial invoices for the customer.
   */
  static async listInvoices(
    client: SupabaseClient,
    customerId: string,
    filter?: { status?: string; unpaidOnly?: boolean }
  ): Promise<CustomerSafeInvoiceDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        currency,
        subtotal,
        discount_amount,
        tax_amount,
        grand_total,
        amount_paid,
        amount_credited,
        amount_due,
        status,
        work_orders (
          work_order_number
        ),
        quotations (
          quotation_number
        ),
        invoice_lines (
          id,
          description,
          quantity,
          unit_price,
          total_amount
        )
      `)
      .eq('customer_id', customerId)
      .not('status', 'eq', 'draft');

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.unpaidOnly) {
      query = query.in('status', ['issued', 'partially_paid', 'overdue']);
    }

    const { data: invoices, error } = await query.order('invoice_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to list customer invoices: ${error.message}`);
    }

    const today = new Date().toISOString().split('T')[0];

    return (invoices || []).map((inv: any) => {
      const wo = inv.work_orders as any;
      const quote = inv.quotations as any;
      const amountDue = Number(inv.amount_due !== undefined ? inv.amount_due : Number(inv.grand_total) - Number(inv.amount_paid || 0));
      const isOverdue = inv.due_date < today && amountDue > 0;

      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        currency: inv.currency,
        subtotal: Number(inv.subtotal),
        discountAmount: Number(inv.discount_amount),
        taxAmount: Number(inv.tax_amount),
        grandTotal: Number(inv.grand_total),
        amountPaid: Number(inv.amount_paid),
        amountDue,
        status: isOverdue ? 'overdue' : inv.status,
        workOrderNumber: wo?.work_order_number,
        quotationNumber: quote?.quotation_number,
        isOverdue,
        lines: ((inv.invoice_lines as any[]) || []).map((l: any) => ({
          id: l.id,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unit_price),
          totalAmount: Number(l.total_amount),
        })),
      };
    });
  }

  /**
   * Retrieves detail of a single invoice for the customer.
   */
  static async getInvoiceDetail(
    client: SupabaseClient,
    customerId: string,
    invoiceId: string
  ): Promise<CustomerSafeInvoiceDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!invoiceId) throw new Error('invoiceId is required');

    const { data: inv, error } = await client
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        currency,
        subtotal,
        discount_amount,
        tax_amount,
        grand_total,
        amount_paid,
        amount_credited,
        amount_due,
        status,
        work_orders (
          work_order_number
        ),
        quotations (
          quotation_number
        ),
        invoice_lines (
          id,
          description,
          quantity,
          unit_price,
          total_amount
        )
      `)
      .eq('id', invoiceId)
      .eq('customer_id', customerId)
      .single();

    if (error || !inv) {
      throw new Error('Invoice not found or does not belong to your account');
    }

    if (inv.status === 'draft') {
      throw new Error('Invoice is in draft status and not available for customer view');
    }

    const today = new Date().toISOString().split('T')[0];
    const wo = inv.work_orders as any;
    const quote = inv.quotations as any;
    const amountDue = Number(inv.amount_due !== undefined ? inv.amount_due : Number(inv.grand_total) - Number(inv.amount_paid || 0));
    const isOverdue = inv.due_date < today && amountDue > 0;

    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      currency: inv.currency,
      subtotal: Number(inv.subtotal),
      discountAmount: Number(inv.discount_amount),
      taxAmount: Number(inv.tax_amount),
      grandTotal: Number(inv.grand_total),
      amountPaid: Number(inv.amount_paid),
      amountDue,
      status: isOverdue ? 'overdue' : inv.status,
      workOrderNumber: wo?.work_order_number,
      quotationNumber: quote?.quotation_number,
      isOverdue,
      lines: ((inv.invoice_lines as any[]) || []).map((l: any) => ({
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        totalAmount: Number(l.total_amount),
      })),
    };
  }

  /**
   * Initiates an online checkout session / payment intent for an invoice.
   * Calculates payable amount strictly from server-side amount_due (Never trusts client amount).
   */
  static async createPaymentIntent(
    client: SupabaseClient,
    dto: PaymentIntentCreateDto,
    userId?: string
  ): Promise<PaymentIntentResult> {
    const invoice = await this.getInvoiceDetail(client, dto.customerId, dto.invoiceId);

    if (invoice.amountDue <= 0 || invoice.status === 'paid') {
      throw new Error('This invoice has already been fully paid');
    }

    const providerIntentId = `pi_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    const clientSecret = `${providerIntentId}_secret_${Math.random().toString(36).substring(2, 8)}`;

    const { data: intent, error } = await client
      .from('payment_intents')
      .insert({
        company_id: dto.companyId,
        customer_id: dto.customerId,
        invoice_id: dto.invoiceId,
        amount: invoice.amountDue,
        currency: invoice.currency,
        provider: dto.provider || 'mock',
        provider_intent_id: providerIntentId,
        provider_client_secret: clientSecret,
        status: 'created',
        payment_method: dto.paymentMethod || 'card',
        metadata: dto.metadata || {},
        created_by: userId || null,
      })
      .select('id, amount, currency, status, provider_intent_id, provider_client_secret')
      .single();

    if (error) {
      throw new Error(`Failed to create payment intent: ${error.message}`);
    }

    return {
      intentId: intent.id,
      providerIntentId: intent.provider_intent_id,
      providerClientSecret: intent.provider_client_secret,
      amount: Number(intent.amount),
      currency: intent.currency,
      status: intent.status,
    };
  }

  /**
   * Processes verified payment gateway webhook event idempotently.
   */
  static async processPaymentWebhook(
    client: SupabaseClient,
    dto: PaymentIntentWebhookDto
  ): Promise<{ success: boolean; invoiceId?: string; status: string }> {
    const { data: intent, error: intentErr } = await client
      .from('payment_intents')
      .select('id, company_id, customer_id, invoice_id, amount, currency, status')
      .eq('provider_intent_id', dto.providerIntentId)
      .single();

    if (intentErr || !intent) {
      throw new Error(`Payment intent not found for provider intent ID: ${dto.providerIntentId}`);
    }

    // Idempotency check: if intent already succeeded, return immediately
    if (intent.status === 'succeeded') {
      return {
        success: true,
        invoiceId: intent.invoice_id,
        status: 'already_processed',
      };
    }

    // Update payment intent status
    await client
      .from('payment_intents')
      .update({
        status: dto.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intent.id);

    if (dto.status === 'succeeded') {
      // Look up invoice to update amount_paid
      const { data: inv } = await client
        .from('invoices')
        .select('id, grand_total, amount_paid')
        .eq('id', intent.invoice_id)
        .single();

      if (inv) {
        const newPaid = Number(inv.amount_paid || 0) + Number(intent.amount);
        const grandTotal = Number(inv.grand_total || 0);
        const newStatus = newPaid >= grandTotal ? 'paid' : 'partially_paid';

        await client
          .from('invoices')
          .update({
            amount_paid: newPaid,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', intent.invoice_id);
      }

      // Publish domain event
      try {
        await client.from('domain_events').insert({
          company_id: intent.company_id,
          event_type: 'CUSTOMER_PAYMENT_CAPTURED',
          entity_type: 'invoice',
          entity_id: intent.invoice_id,
          payload: {
            customer_id: intent.customer_id,
            amount: intent.amount,
            currency: intent.currency,
            provider_intent_id: dto.providerIntentId,
          },
        });
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      invoiceId: intent.invoice_id,
      status: dto.status,
    };
  }
}

import { SupabaseClient } from '@supabase/supabase-js';

export interface RecordPaymentDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  amount: number;
  paymentMethod?: string;
  paymentMethodId?: string | null;
  paymentDate?: string;
  referenceNumber?: string | null;
  bankName?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  autoAllocateToInvoiceId?: string | null;
}

export class PaymentService {
  /**
   * Records a customer receipt and optionally allocates it immediately to an open invoice.
   */
  static async recordPayment(client: SupabaseClient, dto: RecordPaymentDto) {
    if (dto.amount <= 0) {
      throw new Error(`Payment amount must be strictly positive: ${dto.amount}`);
    }

    // 1. Insert Payment Header
    const { data: payment, error: payErr } = await client
      .from('payments')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        customer_id: dto.customerId,
        amount: dto.amount,
        payment_method: dto.paymentMethod || 'bank_transfer',
        payment_method_id: dto.paymentMethodId || null,
        payment_date: dto.paymentDate || new Date().toISOString().slice(0, 10),
        reference_number: dto.referenceNumber || null,
        bank_name: dto.bankName || null,
        status: 'received',
        notes: dto.notes || null,
        idempotency_key: dto.idempotencyKey || null,
      })
      .select()
      .single();

    if (payErr) throw new Error(`Payment recording failed: ${payErr.message}`);

    // 2. If an invoice was specified for immediate allocation, allocate it
    let allocationResult = null;
    if (dto.autoAllocateToInvoiceId) {
      allocationResult = await PaymentService.allocatePayment(
        client,
        payment.id,
        dto.autoAllocateToInvoiceId,
        dto.amount
      );
    }

    return {
      payment,
      allocation: allocationResult,
    };
  }

  /**
   * Allocates an available payment amount against an open invoice.
   */
  static async allocatePayment(
    client: SupabaseClient,
    paymentId: string,
    invoiceId: string,
    amount: number
  ) {
    const { data, error } = await client.rpc('allocate_payment', {
      p_payment_id: paymentId,
      p_invoice_id: invoiceId,
      p_allocated_amount: amount,
    });

    if (error) throw new Error(`Payment allocation failed: ${error.message}`);
    return data;
  }

  /**
   * Unallocates payment from an invoice.
   */
  static async unallocatePayment(
    client: SupabaseClient,
    paymentId: string,
    invoiceId: string
  ) {
    const { data, error } = await client.rpc('unallocate_payment', {
      p_payment_id: paymentId,
      p_invoice_id: invoiceId,
    });

    if (error) throw new Error(`Payment unallocation failed: ${error.message}`);
    return data;
  }

  /**
   * Reverses a payment completely, unallocating from open invoices and restoring balances.
   */
  static async reversePayment(
    client: SupabaseClient,
    paymentId: string,
    reason: string
  ) {
    const { data, error } = await client.rpc('reverse_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
    });

    if (error) throw new Error(`Payment reversal failed: ${error.message}`);
    return data;
  }

  /**
   * Returns a live consolidated billing summary for a customer.
   */
  static async getCustomerBillingSummary(client: SupabaseClient, customerId: string) {
    const { data, error } = await client.rpc('get_customer_billing_summary', {
      p_customer_id: customerId,
    });

    if (error) throw new Error(`Customer billing summary failed: ${error.message}`);
    return data;
  }
}

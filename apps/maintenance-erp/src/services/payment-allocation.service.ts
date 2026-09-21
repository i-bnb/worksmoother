import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface InvoiceAllocationInput {
  invoiceId: string;
  amount: number;
}

export class PaymentAllocationService {
  /**
   * Allocates a single payment across multiple customer invoices with strict bounds checks.
   */
  static async allocatePaymentMultiInvoice(
    client: SupabaseClient,
    companyId: string,
    paymentId: string,
    allocations: InvoiceAllocationInput[],
    userId?: string
  ) {
    if (!allocations || allocations.length === 0) {
      throw new Error('At least one invoice allocation is required');
    }

    // 1. Fetch Payment
    const { data: payment, error: pErr } = await client
      .from('payments')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', paymentId)
      .single();

    if (pErr || !payment) {
      throw new Error(`Payment not found: ${pErr?.message || paymentId}`);
    }

    if (payment.status === 'void' || payment.status === 'reversed') {
      throw new Error(`Cannot allocate a ${payment.status} payment`);
    }

    const unallocatedDec = new Decimal(payment.unallocated_amount !== undefined ? payment.unallocated_amount : (payment.amount - (payment.allocated_amount || 0)));

    let sumAllocDec = Decimal.zero();
    for (const alloc of allocations) {
      const amtDec = new Decimal(alloc.amount);
      if (amtDec.lessThanOrEqualTo(0)) {
        throw new Error(`Allocation amount for invoice ${alloc.invoiceId} must be positive`);
      }
      sumAllocDec = sumAllocDec.plus(amtDec);
    }

    if (sumAllocDec.greaterThan(unallocatedDec)) {
      throw new Error(
        `Total allocation amount (${sumAllocDec.toNumber()}) exceeds payment unallocated balance (${unallocatedDec.toNumber()})`
      );
    }

    const now = new Date().toISOString();
    const results = [];

    // 2. Process each invoice allocation
    for (const alloc of allocations) {
      const allocDec = new Decimal(alloc.amount);

      const { data: invoice, error: iErr } = await client
        .from('invoices')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', alloc.invoiceId)
        .single();

      if (iErr || !invoice) {
        throw new Error(`Invoice not found: ${alloc.invoiceId}`);
      }

      if (invoice.status === 'void' || invoice.status === 'cancelled') {
        throw new Error(`Cannot allocate payment to a ${invoice.status} invoice (${invoice.invoice_number})`);
      }

      const grandTotalDec = new Decimal(invoice.grand_total || 0);
      const currentPaidDec = new Decimal(invoice.amount_paid || 0);
      const currentDueDec = grandTotalDec.minus(currentPaidDec);

      if (allocDec.greaterThan(currentDueDec)) {
        throw new Error(
          `Allocation amount (${allocDec.toNumber()}) exceeds outstanding balance (${currentDueDec.toNumber()}) on invoice ${invoice.invoice_number}`
        );
      }

      const newPaidDec = currentPaidDec.plus(allocDec);
      const newDueDec = grandTotalDec.minus(newPaidDec);
      const newStatus = newDueDec.isZero() ? 'paid' : 'partially_paid';

      // Update invoice
      await client
        .from('invoices')
        .update({
          amount_paid: newPaidDec.toNumber(),
          status: newStatus,
          updated_at: now,
        })
        .eq('id', invoice.id);

      // Record payment_allocation
      const { data: allocRecord, error: aErr } = await client
        .from('payment_allocations')
        .insert({
          company_id: companyId,
          payment_id: payment.id,
          invoice_id: invoice.id,
          allocated_amount: allocDec.toNumber(),
          allocation_date: now,
          created_by: userId || null,
        })
        .select('*')
        .single();

      if (aErr) {
        throw new Error(`Failed to record payment allocation for invoice ${invoice.invoice_number}: ${aErr.message}`);
      }

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        allocatedAmount: allocDec.toNumber(),
        remainingDue: newDueDec.toNumber(),
        newStatus,
      });
    }

    // 3. Update payment allocated_amount
    const newAllocatedPaymentDec = new Decimal(payment.allocated_amount || 0).plus(sumAllocDec);
    await client
      .from('payments')
      .update({
        allocated_amount: newAllocatedPaymentDec.toNumber(),
        updated_at: now,
      })
      .eq('id', payment.id);

    return {
      paymentId: payment.id,
      totalAllocated: sumAllocDec.toNumber(),
      remainingUnallocated: unallocatedDec.minus(sumAllocDec).toNumber(),
      allocations: results,
    };
  }

  /**
   * Waterfalls an unallocated advance payment across outstanding open invoices.
   */
  static async waterfallAdvancePayment(
    client: SupabaseClient,
    companyId: string,
    paymentId: string,
    userId?: string
  ) {
    const { data: payment } = await client
      .from('payments')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', paymentId)
      .single();

    if (!payment) throw new Error(`Payment not found: ${paymentId}`);

    let unallocatedDec = new Decimal(payment.unallocated_amount !== undefined ? payment.unallocated_amount : (payment.amount - (payment.allocated_amount || 0)));
    if (unallocatedDec.lessThanOrEqualTo(0)) {
      throw new Error('Payment has no unallocated funds to distribute');
    }

    // Fetch unpaid or partially paid invoices for the customer ordered by due date
    const { data: openInvoices } = await client
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .eq('customer_id', payment.customer_id)
      .in('status', ['issued', 'partially_paid'])
      .order('due_date', { ascending: true });

    if (!openInvoices || openInvoices.length === 0) {
      return {
        message: 'No open invoices found for this customer',
        totalAllocated: 0,
        remainingUnallocated: unallocatedDec.toNumber(),
        allocations: [],
      };
    }

    const allocationsToExecute: InvoiceAllocationInput[] = [];

    for (const inv of openInvoices) {
      if (unallocatedDec.isZero()) break;

      const grandTotalDec = new Decimal(inv.grand_total || 0);
      const currentPaidDec = new Decimal(inv.amount_paid || 0);
      const dueDec = grandTotalDec.minus(currentPaidDec);

      if (dueDec.greaterThan(0)) {
        const canPayDec = Decimal.min(unallocatedDec, dueDec);
        allocationsToExecute.push({
          invoiceId: inv.id,
          amount: canPayDec.toNumber(),
        });
        unallocatedDec = unallocatedDec.minus(canPayDec);
      }
    }

    if (allocationsToExecute.length === 0) {
      return {
        message: 'No eligible outstanding balance to allocate',
        totalAllocated: 0,
        remainingUnallocated: unallocatedDec.toNumber(),
        allocations: [],
      };
    }

    return this.allocatePaymentMultiInvoice(client, companyId, paymentId, allocationsToExecute, userId);
  }
}

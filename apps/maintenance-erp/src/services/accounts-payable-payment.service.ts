import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  SupplierPaymentCreateDto,
  SupplierPaymentReversalDto,
  validateSupplierPaymentCreate,
  validateSupplierPaymentReversal,
} from '../schemas/accounts-payable.schema.js';
import { DocumentNumberService } from './document-number.service.js';
import { JournalPostingService } from './journal-posting.service.js';
import { EventDispatcherService } from './event-dispatcher.service.js';

export class AccountsPayablePaymentService {
  /**
   * Records a supplier payment (standard disbursement, advance, or partial bill settlement).
   */
  static async recordPayment(
    client: SupabaseClient,
    rawDto: SupplierPaymentCreateDto,
    userId?: string,
    autoPostToGl = false
  ) {
    const dto = validateSupplierPaymentCreate(rawDto);
    const amountDec = new Decimal(dto.amount);
    const now = new Date().toISOString();

    // 1. Generate unique payment number
    const paymentNumber = await DocumentNumberService.generate(client, dto.companyId, 'PAY');

    // 2. If paying a specific bill, validate and lock the bill
    let updatedBill = null;
    if (dto.billId) {
      const { data: bill, error: bErr } = await client
        .from('supplier_bills')
        .select('*')
        .eq('id', dto.billId)
        .single();

      if (bErr || !bill) {
        throw new Error(`Supplier bill not found: ${bErr?.message || dto.billId}`);
      }

      if (bill.status === 'cancelled') {
        throw new Error('Cannot apply payment to a cancelled supplier bill');
      }

      const grandTotalDec = new Decimal(bill.grand_total || 0);
      const currentPaidDec = new Decimal(bill.amount_paid || 0);
      const currentDueDec = new Decimal(bill.amount_due !== undefined ? bill.amount_due : grandTotalDec.minus(currentPaidDec));

      if (currentDueDec.lessThanOrEqualTo(0)) {
        throw new Error('Supplier bill is already fully settled');
      }

      if (amountDec.greaterThan(currentDueDec)) {
        throw new Error(
          `Payment amount (${amountDec.toNumber()}) exceeds outstanding bill balance (${currentDueDec.toNumber()})`
        );
      }

      const newPaidDec = currentPaidDec.plus(amountDec);
      const newDueDec = Decimal.max(0, grandTotalDec.minus(newPaidDec));
      const newStatus = newDueDec.lessThanOrEqualTo(0) ? 'paid' : 'partially_paid';

      // Update bill
      const { data: bUpdated, error: buErr } = await client
        .from('supplier_bills')
        .update({
          amount_paid: newPaidDec.toNumber(),
          amount_due: newDueDec.toNumber(),
          status: newStatus,
          updated_at: now,
        })
        .eq('id', bill.id)
        .select()
        .single();

      if (buErr) {
        throw new Error(`Failed to update supplier bill balance: ${buErr.message}`);
      }
      updatedBill = bUpdated;
    }

    // 3. Create the payment record
    const { data: payment, error: pErr } = await client
      .from('supplier_payments')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        supplier_id: dto.supplierId,
        bill_id: dto.billId || null,
        payment_number: paymentNumber,
        payment_date: dto.paymentDate,
        amount: amountDec.toNumber(),
        currency: dto.currency || 'AED',
        payment_method_id: dto.paymentMethodId || null,
        bank_account_id: dto.bankAccountId || null,
        reference_number: dto.referenceNumber || null,
        payment_type: dto.paymentType || 'standard',
        status: 'posted',
        notes: dto.notes || null,
        created_by: userId || null,
        created_at: now,
      })
      .select()
      .single();

    if (pErr) {
      throw new Error(`Failed to record supplier payment: ${pErr.message}`);
    }

    // 4. Optionally post to GL
    let glEntry = null;
    if (autoPostToGl) {
      try {
        glEntry = await JournalPostingService.postSupplierPaymentToGl(client, payment.id);
      } catch (err: any) {
        console.warn(`Supplier payment GL posting warning: ${err.message}`);
      }
    }

    // 5. Emit domain event
    await EventDispatcherService.publishEvent(client, {
      companyId: dto.companyId,
      eventType: 'SUPPLIER_PAYMENT_PROCESSED',
      entityType: 'supplier_payment',
      entityId: payment.id,
      actorId: userId,
      payload: {
        paymentId: payment.id,
        paymentNumber,
        supplierId: dto.supplierId,
        billId: dto.billId,
        amount: amountDec.toNumber(),
        paymentType: dto.paymentType,
      },
    }).catch(() => {
      // non-fatal
    });

    return {
      payment,
      updatedBill,
      glEntry,
    };
  }

  /**
   * Applies an unapplied advance payment against an outstanding supplier bill.
   */
  static async applyAdvanceToBill(
    client: SupabaseClient,
    advancePaymentId: string,
    billId: string,
    amountToApply: number,
    userId?: string
  ) {
    const applyDec = new Decimal(amountToApply);
    if (applyDec.lessThanOrEqualTo(0)) {
      throw new Error('Application amount must be greater than 0');
    }

    // 1. Fetch and validate advance payment
    const { data: advance, error: advErr } = await client
      .from('supplier_payments')
      .select('*')
      .eq('id', advancePaymentId)
      .single();

    if (advErr || !advance) {
      throw new Error(`Advance payment not found: ${advErr?.message || advancePaymentId}`);
    }

    if (advance.payment_type !== 'advance') {
      throw new Error('Specified payment is not marked as an advance payment');
    }

    if (advance.reversed_at) {
      throw new Error('Cannot apply a reversed advance payment');
    }

    const advanceAmountDec = new Decimal(advance.amount);

    // Check previously applied amounts for this advance
    const { data: previousApps } = await client
      .from('supplier_payments')
      .select('amount')
      .eq('advance_id', advancePaymentId)
      .is('reversed_at', null);

    const previouslyAppliedDec = (previousApps || []).reduce(
      (sum: Decimal, p: any) => sum.plus(new Decimal(p.amount || 0)),
      new Decimal(0)
    );

    const availableAdvanceDec = advanceAmountDec.minus(previouslyAppliedDec);
    if (applyDec.greaterThan(availableAdvanceDec)) {
      throw new Error(
        `Application amount (${applyDec.toNumber()}) exceeds available advance balance (${availableAdvanceDec.toNumber()})`
      );
    }

    // 2. Fetch and validate bill
    const { data: bill, error: bErr } = await client
      .from('supplier_bills')
      .select('*')
      .eq('id', billId)
      .single();

    if (bErr || !bill) {
      throw new Error(`Supplier bill not found: ${bErr?.message || billId}`);
    }

    if (bill.supplier_id !== advance.supplier_id) {
      throw new Error('Supplier of advance payment does not match supplier of the bill');
    }

    const currentDueDec = new Decimal(bill.amount_due || 0);
    if (applyDec.greaterThan(currentDueDec)) {
      throw new Error(
        `Application amount (${applyDec.toNumber()}) exceeds bill balance due (${currentDueDec.toNumber()})`
      );
    }

    // 3. Create a settlement linkage payment record
    const applicationPaymentNumber = await DocumentNumberService.generate(
      client,
      advance.company_id,
      'SPAY'
    );

    const now = new Date().toISOString();
    const { data: appPayment, error: appErr } = await client
      .from('supplier_payments')
      .insert({
        company_id: advance.company_id,
        branch_id: advance.branch_id,
        supplier_id: advance.supplier_id,
        bill_id: bill.id,
        advance_id: advance.id,
        payment_number: applicationPaymentNumber,
        payment_date: now.split('T')[0],
        amount: applyDec.toNumber(),
        currency: advance.currency,
        payment_type: 'standard',
        status: 'posted',
        notes: `Applied from Advance ${advance.payment_number}`,
        created_by: userId || null,
        created_at: now,
      })
      .select()
      .single();

    if (appErr) {
      throw new Error(`Failed to record advance application: ${appErr.message}`);
    }

    // 4. Update the bill balance
    const newPaidDec = new Decimal(bill.amount_paid || 0).plus(applyDec);
    const newDueDec = Decimal.max(0, new Decimal(bill.grand_total || 0).minus(newPaidDec));
    const newStatus = newDueDec.lessThanOrEqualTo(0) ? 'paid' : 'partially_paid';

    const { data: updatedBill, error: ubErr } = await client
      .from('supplier_bills')
      .update({
        amount_paid: newPaidDec.toNumber(),
        amount_due: newDueDec.toNumber(),
        status: newStatus,
        updated_at: now,
      })
      .eq('id', bill.id)
      .select()
      .single();

    if (ubErr) {
      throw new Error(`Failed to update bill balance on advance application: ${ubErr.message}`);
    }

    return {
      applicationPayment: appPayment,
      advanceId: advance.id,
      remainingAdvanceBalance: availableAdvanceDec.minus(applyDec).toNumber(),
      updatedBill,
    };
  }

  /**
   * Reverses a supplier payment, restoring the bill balance and recording an audit trail.
   */
  static async reversePayment(
    client: SupabaseClient,
    rawDto: SupplierPaymentReversalDto,
    userId?: string
  ) {
    const dto = validateSupplierPaymentReversal(rawDto);
    const now = new Date().toISOString();

    // 1. Fetch payment
    const { data: payment, error: pErr } = await client
      .from('supplier_payments')
      .select('*')
      .eq('id', dto.paymentId)
      .single();

    if (pErr || !payment) {
      throw new Error(`Supplier payment not found: ${pErr?.message || dto.paymentId}`);
    }

    if (payment.reversed_at) {
      throw new Error(`Payment was already reversed on ${payment.reversed_at}`);
    }

    // 2. Mark payment as reversed
    const { data: reversedPayment, error: rErr } = await client
      .from('supplier_payments')
      .update({
        reversed_at: now,
        reversed_by: userId || null,
        reversal_reason: dto.reversalReason,
        status: 'cancelled',
      })
      .eq('id', payment.id)
      .select()
      .single();

    if (rErr) {
      throw new Error(`Failed to mark payment as reversed: ${rErr.message}`);
    }

    // 3. If tied to a bill, reinstate bill balance
    let reinstatedBill = null;
    if (payment.bill_id) {
      const { data: bill } = await client
        .from('supplier_bills')
        .select('*')
        .eq('id', payment.bill_id)
        .single();

      if (bill) {
        const paymentAmountDec = new Decimal(payment.amount || 0);
        const currentPaidDec = new Decimal(bill.amount_paid || 0);
        const newPaidDec = Decimal.max(0, currentPaidDec.minus(paymentAmountDec));
        const grandTotalDec = new Decimal(bill.grand_total || 0);
        const newDueDec = grandTotalDec.minus(newPaidDec);
        const newStatus = newPaidDec.greaterThan(0) ? 'partially_paid' : 'posted';

        const { data: bUpdated, error: buErr } = await client
          .from('supplier_bills')
          .update({
            amount_paid: newPaidDec.toNumber(),
            amount_due: newDueDec.toNumber(),
            status: newStatus,
            updated_at: now,
          })
          .eq('id', bill.id)
          .select()
          .single();

        if (!buErr) {
          reinstatedBill = bUpdated;
        }
      }
    }

    // 4. Emit domain event
    await EventDispatcherService.publishEvent(client, {
      companyId: payment.company_id,
      eventType: 'SUPPLIER_PAYMENT_REVERSED',
      entityType: 'supplier_payment',
      entityId: payment.id,
      actorId: userId,
      payload: {
        paymentId: payment.id,
        paymentNumber: payment.payment_number,
        reversalReason: dto.reversalReason,
        supplierId: payment.supplier_id,
        billId: payment.bill_id,
        amount: payment.amount,
      },
    }).catch(() => {
      // non-fatal
    });

    return {
      reversedPayment,
      reinstatedBill,
    };
  }

  /**
   * Retrieves supplier payment history with optional bill, method, and supplier details.
   */
  static async listPayments(
    client: SupabaseClient,
    companyId: string,
    filters: {
      supplierId?: string;
      billId?: string;
      paymentType?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    let query = client
      .from('supplier_payments')
      .select('*, supplier:suppliers(id, name, code), bill:supplier_bills(id, bill_number, grand_total)')
      .eq('company_id', companyId)
      .order('payment_date', { ascending: false });

    if (filters.supplierId) {
      query = query.eq('supplier_id', filters.supplierId);
    }
    if (filters.billId) {
      query = query.eq('bill_id', filters.billId);
    }
    if (filters.paymentType) {
      query = query.eq('payment_type', filters.paymentType);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list supplier payments: ${error.message}`);
    }
    return data || [];
  }
}

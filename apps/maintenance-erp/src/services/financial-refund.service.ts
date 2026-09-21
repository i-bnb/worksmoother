import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  RefundCreateDto,
  validateRefundCreate,
} from '../schemas/refund.schema.js';
import { DocumentNumberService } from './document-number.service.js';
import { JournalPostingService, JournalLineInput } from './journal-posting.service.js';

export class FinancialRefundService {
  /**
   * Processes a customer or supplier refund originating from credit notes or advance overpayments.
   * Guarantees idempotency and strict balance ceiling checks.
   */
  static async processRefund(
    client: SupabaseClient,
    rawDto: RefundCreateDto,
    userId?: string,
    glAccounts?: {
      arOrApAccountId: string;
      bankGlAccountId: string;
    }
  ) {
    const dto = validateRefundCreate(rawDto);
    const refundAmtDec = new Decimal(dto.amount);
    const now = new Date().toISOString();

    // 1. Idempotency Check
    if (dto.idempotencyKey) {
      const { data: existingRefund } = await client
        .from('financial_refunds')
        .select('*')
        .eq('company_id', dto.companyId)
        .eq('idempotency_key', dto.idempotencyKey)
        .maybeSingle();

      if (existingRefund) {
        return {
          refund: existingRefund,
          isDuplicate: true,
        };
      }
    }

    // 2. Validate Bank Account
    const { data: bankAccount, error: bErr } = await client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', dto.companyId)
      .eq('id', dto.bankAccountId)
      .single();

    if (bErr || !bankAccount) {
      throw new Error(`Bank account not found: ${bErr?.message || dto.bankAccountId}`);
    }

    const bankBalanceDec = new Decimal(bankAccount.current_balance || 0);

    // 3. Source Verification and Ceiling Bounds Check
    if (dto.refundType === 'customer_refund') {
      // In customer refund, ERP pays money to the customer
      if (bankBalanceDec.lessThan(refundAmtDec)) {
        throw new Error(
          `Insufficient funds in bank account "${bankAccount.account_name}" for refund disbursement. Balance: ${bankBalanceDec.toNumber()}, Refund: ${refundAmtDec.toNumber()}`
        );
      }

      if (dto.sourceType === 'credit_note') {
        const { data: cn, error: cnErr } = await client
          .from('credit_notes')
          .select('*')
          .eq('company_id', dto.companyId)
          .eq('id', dto.sourceId)
          .single();

        if (cnErr || !cn) throw new Error(`Customer credit note not found: ${dto.sourceId}`);

        const remainingDec = new Decimal(cn.amount_remaining !== undefined ? cn.amount_remaining : (cn.grand_total - (cn.amount_applied || 0) - (cn.refunded_amount || 0)));
        if (refundAmtDec.greaterThan(remainingDec)) {
          throw new Error(
            `Refund amount (${refundAmtDec.toNumber()}) exceeds credit note refundable balance (${remainingDec.toNumber()})`
          );
        }

        const newRefundedDec = new Decimal(cn.refunded_amount || 0).plus(refundAmtDec);
        const isFullyCleared = remainingDec.minus(refundAmtDec).isZero();

        await client
          .from('credit_notes')
          .update({
            refunded_amount: newRefundedDec.toNumber(),
            status: isFullyCleared ? 'refunded' : cn.status,
            updated_at: now,
          })
          .eq('id', cn.id);
      } else if (dto.sourceType === 'advance_payment' || dto.sourceType === 'overpayment') {
        const { data: payment, error: pErr } = await client
          .from('payments')
          .select('*')
          .eq('company_id', dto.companyId)
          .eq('id', dto.sourceId)
          .single();

        if (pErr || !payment) throw new Error(`Customer payment not found: ${dto.sourceId}`);

        const unallocatedDec = new Decimal(payment.unallocated_amount !== undefined ? payment.unallocated_amount : (payment.amount - (payment.allocated_amount || 0)));
        if (refundAmtDec.greaterThan(unallocatedDec)) {
          throw new Error(
            `Refund amount (${refundAmtDec.toNumber()}) exceeds customer unallocated payment balance (${unallocatedDec.toNumber()})`
          );
        }

        const newAllocatedDec = new Decimal(payment.allocated_amount || 0).plus(refundAmtDec);
        await client
          .from('payments')
          .update({
            allocated_amount: newAllocatedDec.toNumber(),
            updated_at: now,
          })
          .eq('id', payment.id);
      }
    } else {
      // Supplier Refund: ERP receives money back from supplier
      if (dto.sourceType === 'credit_note') {
        const { data: scn, error: scErr } = await client
          .from('supplier_credit_notes')
          .select('*')
          .eq('company_id', dto.companyId)
          .eq('id', dto.sourceId)
          .single();

        if (scErr || !scn) throw new Error(`Supplier credit note not found: ${dto.sourceId}`);

        const remainingDec = new Decimal(scn.amount_remaining !== undefined ? scn.amount_remaining : (scn.grand_total - (scn.amount_applied || 0) - (scn.refunded_amount || 0)));
        if (refundAmtDec.greaterThan(remainingDec)) {
          throw new Error(
            `Refund amount (${refundAmtDec.toNumber()}) exceeds supplier credit note balance (${remainingDec.toNumber()})`
          );
        }

        const newRefundedDec = new Decimal(scn.refunded_amount || 0).plus(refundAmtDec);
        const isFullyCleared = remainingDec.minus(refundAmtDec).isZero();

        await client
          .from('supplier_credit_notes')
          .update({
            refunded_amount: newRefundedDec.toNumber(),
            status: isFullyCleared ? 'refunded' : scn.status,
            updated_at: now,
          })
          .eq('id', scn.id);
      }
    }

    // 4. Update Bank Account Balance
    const newBankBalance = dto.refundType === 'customer_refund'
      ? bankBalanceDec.minus(refundAmtDec).toNumber()
      : bankBalanceDec.plus(refundAmtDec).toNumber();

    await client
      .from('bank_accounts')
      .update({
        current_balance: newBankBalance,
        updated_at: now,
      })
      .eq('id', dto.bankAccountId);

    // 5. Generate Refund Number
    const refundNumber = await DocumentNumberService.generate(client, dto.companyId, 'REF');

    // 6. Post Double-Entry GL Journal
    let journalEntryId: string | null = null;
    const bankGlAccount = glAccounts?.bankGlAccountId || bankAccount.gl_account_id;

    if (glAccounts?.arOrApAccountId && bankGlAccount) {
      const journalLines: JournalLineInput[] = [];

      if (dto.refundType === 'customer_refund') {
        // Customer Refund:
        // Debit: Accounts Receivable / Customer Advance (reversing credit balance)
        journalLines.push({
          accountId: glAccounts.arOrApAccountId,
          debit: refundAmtDec,
          credit: Decimal.zero(),
          customerId: dto.partyId,
          description: `Customer Refund ${refundNumber}`,
        });

        // Credit: Bank Account (cash disbursed)
        journalLines.push({
          accountId: bankGlAccount,
          debit: Decimal.zero(),
          credit: refundAmtDec,
          description: `Bank disbursement for refund ${refundNumber}`,
        });
      } else {
        // Supplier Refund:
        // Debit: Bank Account (cash received)
        journalLines.push({
          accountId: bankGlAccount,
          debit: refundAmtDec,
          credit: Decimal.zero(),
          description: `Bank receipt for supplier refund ${refundNumber}`,
        });

        // Credit: Accounts Payable / Supplier Advance (reducing advance or credit)
        journalLines.push({
          accountId: glAccounts.arOrApAccountId,
          debit: Decimal.zero(),
          credit: refundAmtDec,
          supplierId: dto.partyId,
          description: `Supplier Refund ${refundNumber}`,
        });
      }

      const journalResult = await JournalPostingService.createJournalEntry(client, {
        companyId: dto.companyId,
        journalDate: dto.refundDate || now.split('T')[0],
        description: `Financial Refund ${refundNumber} (${dto.refundType})`,
        referenceType: 'refund',
        referenceId: null,
        lines: journalLines,
        autoPost: true,
      });

      journalEntryId = journalResult.journal.id;
    }

    // 7. Insert financial_refunds record
    const refundPayload = {
      company_id: dto.companyId,
      branch_id: dto.branchId,
      refund_number: refundNumber,
      refund_type: dto.refundType,
      party_id: dto.partyId,
      source_type: dto.sourceType,
      source_id: dto.sourceId,
      bank_account_id: dto.bankAccountId,
      refund_date: dto.refundDate || now.split('T')[0],
      currency: dto.currency || 'INR',
      amount: refundAmtDec.toNumber(),
      payment_method: dto.paymentMethod || 'bank_transfer',
      reference_number: dto.referenceNumber || null,
      reason: dto.reason,
      status: 'completed',
      is_posted_to_gl: !!journalEntryId,
      gl_journal_entry_id: journalEntryId,
      idempotency_key: dto.idempotencyKey || null,
      created_by: userId || null,
    };

    const { data: refundRecord, error: refErr } = await client
      .from('financial_refunds')
      .insert(refundPayload)
      .select('*')
      .single();

    if (refErr || !refundRecord) {
      throw new Error(`Failed to record financial refund: ${refErr?.message}`);
    }

    return {
      refund: refundRecord,
      newBankBalance,
      journalEntryId,
      isDuplicate: false,
    };
  }
}

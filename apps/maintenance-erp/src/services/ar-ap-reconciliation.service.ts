import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface ArReconciliationResult {
  asOfDate: string;
  totalInvoiced: number;
  totalPaid: number;
  openInvoiceReceivables: number;
  unappliedCreditNotes: number;
  unallocatedCustomerPayments: number;
  netSubledgerBalance: number;
  glControlAccountBalance: number;
  variance: number;
  isReconciled: boolean;
}

export interface ApReconciliationResult {
  asOfDate: string;
  totalBilled: number;
  totalPaid: number;
  openBillPayables: number;
  unappliedSupplierCreditNotes: number;
  unallocatedSupplierAdvances: number;
  netSubledgerBalance: number;
  glControlAccountBalance: number;
  variance: number;
  isReconciled: boolean;
}

export interface CashPositionAccount {
  id: string;
  accountName: string;
  bankName: string;
  accountNumberMasked: string;
  accountType: string;
  currency: string;
  bookBalance: number;
  statementBalance: number;
  clearedBalance: number;
  unclearedDifference: number;
  lastReconciledDate?: string | null;
}

export interface CashPositionReport {
  companyId: string;
  asOfTimestamp: string;
  totalBookCash: number;
  totalClearedCash: number;
  totalStatementCash: number;
  totalUnclearedDifference: number;
  accounts: CashPositionAccount[];
  byType: Record<string, number>;
}

export class ArApReconciliationService {
  /**
   * Reconciles Accounts Receivable subledger against General Ledger AR control account.
   */
  static async reconcileArSubledger(
    client: SupabaseClient,
    companyId: string,
    arControlAccountId?: string,
    asOfDate?: string
  ): Promise<ArReconciliationResult> {
    const targetDate = asOfDate || new Date().toISOString().split('T')[0];

    // 1. Fetch Invoices
    const { data: invoices, error: invErr } = await client
      .from('invoices')
      .select('grand_total, amount_paid, status, invoice_date')
      .eq('company_id', companyId)
      .lte('invoice_date', targetDate)
      .not('status', 'in', '("draft","void","cancelled")');

    if (invErr) throw new Error(`Failed to query invoices: ${invErr.message}`);

    let totalInvoicedDec = Decimal.zero();
    let totalPaidDec = Decimal.zero();
    let openInvDec = Decimal.zero();

    for (const inv of invoices || []) {
      const gDec = new Decimal(inv.grand_total || 0);
      const pDec = new Decimal(inv.amount_paid || 0);
      const dueDec = gDec.minus(pDec);

      totalInvoicedDec = totalInvoicedDec.plus(gDec);
      totalPaidDec = totalPaidDec.plus(pDec);
      if (dueDec.greaterThan(0)) {
        openInvDec = openInvDec.plus(dueDec);
      }
    }

    // 2. Fetch Unapplied Credit Notes
    const { data: creditNotes } = await client
      .from('credit_notes')
      .select('grand_total, amount_applied, refunded_amount, credit_note_date')
      .eq('company_id', companyId)
      .lte('credit_note_date', targetDate)
      .in('status', ['approved', 'issued', 'posted', 'applied']);

    let unappliedCnDec = Decimal.zero();
    for (const cn of creditNotes || []) {
      const g = new Decimal(cn.grand_total || 0);
      const a = new Decimal(cn.amount_applied || 0);
      const r = new Decimal(cn.refunded_amount || 0);
      const rem = g.minus(a).minus(r);
      if (rem.greaterThan(0)) {
        unappliedCnDec = unappliedCnDec.plus(rem);
      }
    }

    // 3. Fetch Unallocated Customer Payments (Advances)
    const { data: payments } = await client
      .from('payments')
      .select('amount, allocated_amount, payment_date')
      .eq('company_id', companyId)
      .lte('payment_date', targetDate)
      .eq('status', 'received');

    let unallocatedPayDec = Decimal.zero();
    for (const p of payments || []) {
      const amt = new Decimal(p.amount || 0);
      const alloc = new Decimal(p.allocated_amount || 0);
      const unalloc = amt.minus(alloc);
      if (unalloc.greaterThan(0)) {
        unallocatedPayDec = unallocatedPayDec.plus(unalloc);
      }
    }

    // Net AR Subledger = open invoices - unapplied credit notes - unallocated payments
    const netSubledgerDec = openInvDec.minus(unappliedCnDec).minus(unallocatedPayDec);

    // 4. Fetch GL AR Control Account balance if ID provided
    let glBalanceDec = netSubledgerDec; // Default matches if no separate GL account queried
    if (arControlAccountId) {
      const { data: lines } = await client
        .from('journal_lines')
        .select('debit, credit')
        .eq('account_id', arControlAccountId);

      let glDebit = Decimal.zero();
      let glCredit = Decimal.zero();
      for (const l of lines || []) {
        glDebit = glDebit.plus(new Decimal(l.debit || 0));
        glCredit = glCredit.plus(new Decimal(l.credit || 0));
      }
      glBalanceDec = glDebit.minus(glCredit);
    }

    const varianceDec = glBalanceDec.minus(netSubledgerDec);
    const isReconciled = varianceDec.abs().lessThan(new Decimal('0.01'));

    return {
      asOfDate: targetDate,
      totalInvoiced: totalInvoicedDec.toNumber(),
      totalPaid: totalPaidDec.toNumber(),
      openInvoiceReceivables: openInvDec.toNumber(),
      unappliedCreditNotes: unappliedCnDec.toNumber(),
      unallocatedCustomerPayments: unallocatedPayDec.toNumber(),
      netSubledgerBalance: netSubledgerDec.toNumber(),
      glControlAccountBalance: glBalanceDec.toNumber(),
      variance: varianceDec.toNumber(),
      isReconciled,
    };
  }

  /**
   * Reconciles Accounts Payable subledger against General Ledger AP control account.
   */
  static async reconcileApSubledger(
    client: SupabaseClient,
    companyId: string,
    apControlAccountId?: string,
    asOfDate?: string
  ): Promise<ApReconciliationResult> {
    const targetDate = asOfDate || new Date().toISOString().split('T')[0];

    // 1. Fetch Supplier Bills
    const { data: bills, error: bErr } = await client
      .from('supplier_bills')
      .select('grand_total, amount_paid, status, bill_date')
      .eq('company_id', companyId)
      .lte('bill_date', targetDate)
      .not('status', 'in', '("draft","cancelled")');

    if (bErr) throw new Error(`Failed to query supplier bills: ${bErr.message}`);

    let totalBilledDec = Decimal.zero();
    let totalPaidDec = Decimal.zero();
    let openBillsDec = Decimal.zero();

    for (const b of bills || []) {
      const gDec = new Decimal(b.grand_total || 0);
      const pDec = new Decimal(b.amount_paid || 0);
      const dueDec = gDec.minus(pDec);

      totalBilledDec = totalBilledDec.plus(gDec);
      totalPaidDec = totalPaidDec.plus(pDec);
      if (dueDec.greaterThan(0)) {
        openBillsDec = openBillsDec.plus(dueDec);
      }
    }

    // 2. Fetch Unapplied Supplier Credit Notes
    const { data: scns } = await client
      .from('supplier_credit_notes')
      .select('grand_total, amount_applied, refunded_amount, credit_note_date')
      .eq('company_id', companyId)
      .lte('credit_note_date', targetDate)
      .in('status', ['approved', 'posted', 'applied']);

    let unappliedScnDec = Decimal.zero();
    for (const scn of scns || []) {
      const g = new Decimal(scn.grand_total || 0);
      const a = new Decimal(scn.amount_applied || 0);
      const r = new Decimal(scn.refunded_amount || 0);
      const rem = g.minus(a).minus(r);
      if (rem.greaterThan(0)) {
        unappliedScnDec = unappliedScnDec.plus(rem);
      }
    }

    // 3. Fetch Unallocated Supplier Advances
    const { data: suppPayments } = await client
      .from('supplier_payments')
      .select('amount, payment_date')
      .eq('company_id', companyId)
      .lte('payment_date', targetDate)
      .eq('payment_type', 'advance');

    let unallocAdvanceDec = Decimal.zero();
    for (const sp of suppPayments || []) {
      unallocAdvanceDec = unallocAdvanceDec.plus(new Decimal(sp.amount || 0));
    }

    // Net AP Subledger = open bills - unapplied vendor credit notes - unallocated advances
    const netSubledgerDec = openBillsDec.minus(unappliedScnDec).minus(unallocAdvanceDec);

    // 4. Fetch GL AP Control Account balance if ID provided (Liability: Credit minus Debit)
    let glBalanceDec = netSubledgerDec;
    if (apControlAccountId) {
      const { data: lines } = await client
        .from('journal_lines')
        .select('debit, credit')
        .eq('account_id', apControlAccountId);

      let glDebit = Decimal.zero();
      let glCredit = Decimal.zero();
      for (const l of lines || []) {
        glDebit = glDebit.plus(new Decimal(l.debit || 0));
        glCredit = glCredit.plus(new Decimal(l.credit || 0));
      }
      glBalanceDec = glCredit.minus(glDebit);
    }

    const varianceDec = glBalanceDec.minus(netSubledgerDec);
    const isReconciled = varianceDec.abs().lessThan(new Decimal('0.01'));

    return {
      asOfDate: targetDate,
      totalBilled: totalBilledDec.toNumber(),
      totalPaid: totalPaidDec.toNumber(),
      openBillPayables: openBillsDec.toNumber(),
      unappliedSupplierCreditNotes: unappliedScnDec.toNumber(),
      unallocatedSupplierAdvances: unallocAdvanceDec.toNumber(),
      netSubledgerBalance: netSubledgerDec.toNumber(),
      glControlAccountBalance: glBalanceDec.toNumber(),
      variance: varianceDec.toNumber(),
      isReconciled,
    };
  }

  /**
   * Consolidates treasury cash and bank positions across all accounts.
   */
  static async getCashPosition(
    client: SupabaseClient,
    companyId: string
  ): Promise<CashPositionReport> {
    const { data: accounts, error } = await client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('account_name', { ascending: true });

    if (error) throw new Error(`Failed to query bank accounts: ${error.message}`);

    let totalBookDec = Decimal.zero();
    let totalClearedDec = Decimal.zero();
    let totalStmtDec = Decimal.zero();
    let totalUnclearedDec = Decimal.zero();

    const byType: Record<string, number> = {};
    const accountRows: CashPositionAccount[] = [];

    for (const acc of accounts || []) {
      const book = new Decimal(acc.current_balance || 0);
      const stmt = new Decimal(acc.statement_balance || 0);
      const cleared = new Decimal(acc.cleared_balance || 0);
      const uncleared = book.minus(cleared);

      totalBookDec = totalBookDec.plus(book);
      totalClearedDec = totalClearedDec.plus(cleared);
      totalStmtDec = totalStmtDec.plus(stmt);
      totalUnclearedDec = totalUnclearedDec.plus(uncleared);

      const typeKey = acc.account_type || 'current';
      byType[typeKey] = (byType[typeKey] || 0) + book.toNumber();

      const last4 = acc.account_number_last4 || (acc.account_number_full ? acc.account_number_full.slice(-4) : '****');

      accountRows.push({
        id: acc.id,
        accountName: acc.account_name,
        bankName: acc.bank_name,
        accountNumberMasked: `****${last4}`,
        accountType: typeKey,
        currency: acc.currency || 'INR',
        bookBalance: book.toNumber(),
        statementBalance: stmt.toNumber(),
        clearedBalance: cleared.toNumber(),
        unclearedDifference: uncleared.toNumber(),
        lastReconciledDate: acc.last_reconciled_date || null,
      });
    }

    return {
      companyId,
      asOfTimestamp: new Date().toISOString(),
      totalBookCash: totalBookDec.toNumber(),
      totalClearedCash: totalClearedDec.toNumber(),
      totalStatementCash: totalStmtDec.toNumber(),
      totalUnclearedDifference: totalUnclearedDec.toNumber(),
      accounts: accountRows,
      byType,
    };
  }
}

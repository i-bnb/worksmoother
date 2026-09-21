import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal, DecimalLike } from '../lib/decimal.js';
import { FinancialPeriodService } from './financial-period.service.js';

export interface JournalLineInput {
  accountId: string;
  debit: DecimalLike;
  credit: DecimalLike;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  workOrderId?: string | null;
  costCenterId?: string | null;
}

export interface CreateJournalEntryDto {
  companyId: string;
  branchId?: string | null;
  journalDate: string;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  currency?: string;
  lines: JournalLineInput[];
  autoPost?: boolean;
}

export class JournalPostingService {
  /**
   * Creates a draft or posted double-entry journal entry with strict debit = credit invariant.
   */
  static async createJournalEntry(client: SupabaseClient, dto: CreateJournalEntryDto) {
    if (!dto.lines || dto.lines.length < 2) {
      throw new Error('A journal entry must contain at least 2 lines to satisfy double-entry accounting');
    }

    // 1. Validate Debits and Credits with Decimal arithmetic
    let sumDebit = Decimal.zero();
    let sumCredit = Decimal.zero();

    const preparedLines = dto.lines.map((l, idx) => {
      const d = new Decimal(l.debit || 0).round(3);
      const c = new Decimal(l.credit || 0).round(3);

      if (d.isNegative() || c.isNegative()) {
        throw new Error(`Line ${idx + 1}: Negative amounts are prohibited in journal lines`);
      }
      if (d.greaterThan(0) && c.greaterThan(0)) {
        throw new Error(`Line ${idx + 1}: Cannot specify both debit and credit on the same line`);
      }
      if (d.isZero() && c.isZero()) {
        throw new Error(`Line ${idx + 1}: Line must have either debit or credit greater than zero`);
      }

      sumDebit = sumDebit.plus(d);
      sumCredit = sumCredit.plus(c);

      return {
        line_number: idx + 1,
        account_id: l.accountId,
        debit: d.toNumber(),
        credit: c.toNumber(),
        base_debit: d.toNumber(),
        base_credit: c.toNumber(),
        description: l.description || dto.description,
        customer_id: l.customerId || null,
        supplier_id: l.supplierId || null,
        employee_id: l.employeeId || null,
        work_order_id: l.workOrderId || null,
        cost_center_id: l.costCenterId || null,
      };
    });

    if (!sumDebit.equals(sumCredit)) {
      throw new Error(
        `Journal entry is unbalanced: Total Debits (${sumDebit.toFixed(3)}) does not equal Total Credits (${sumCredit.toFixed(3)})`
      );
    }
    if (sumDebit.isZero()) {
      throw new Error('Journal entry total debit must be greater than zero');
    }

    // 2. Validate Financial Period is OPEN
    const periodId = await FinancialPeriodService.validatePeriod(client, dto.companyId, dto.journalDate);

    // 3. Insert Journal Header
    const { data: journal, error: jErr } = await client
      .from('journal_entries')
      .insert({

        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        journal_date: dto.journalDate,
        period_id: periodId,
        reference_type: dto.referenceType || 'manual',
        reference_id: dto.referenceId || null,
        description: dto.description,
        currency: dto.currency || 'INR',
        total_debit: sumDebit.toNumber(),
        total_credit: sumCredit.toNumber(),
        status: 'draft',
      })
      .select()
      .single();

    if (jErr) throw new Error(`Failed to create journal entry: ${jErr.message}`);

    // 4. Insert Journal Lines
    const linesToInsert = preparedLines.map((line) => ({
      journal_entry_id: journal.id,
      ...line,
    }));

    const { error: linesErr } = await client.from('journal_lines').insert(linesToInsert);
    if (linesErr) throw new Error(`Failed to insert journal lines: ${linesErr.message}`);

    // 5. Auto-post if requested
    if (dto.autoPost) {
      const { data: postRes, error: postErr } = await client.rpc('post_journal_entry', {
        p_journal_id: journal.id,
      });
      if (postErr) throw new Error(`Failed to post journal entry: ${postErr.message}`);
      const postedJournal = (postRes && typeof postRes === 'object' && (postRes as any).id) ? postRes : journal;
      return { journal: postedJournal, lines: linesToInsert, status: 'posted' };
    }

    return { journal, lines: linesToInsert, status: 'draft' };
  }

  /**
   * Posts an existing draft journal entry.
   */
  static async postJournal(client: SupabaseClient, journalId: string) {
    const { data, error } = await client.rpc('post_journal_entry', {
      p_journal_id: journalId,
    });
    if (error) throw new Error(`Journal posting failed: ${error.message}`);
    return data;
  }

  /**
   * Reverses an existing posted journal entry by generating an inverse balancing entry.
   */
  static async reverseJournal(client: SupabaseClient, journalId: string, reason: string) {
    const { data, error } = await client.rpc('reverse_journal_entry', {
      p_journal_id: journalId,
      p_reason: reason,
    });
    if (error) throw new Error(`Journal reversal failed: ${error.message}`);
    return data;
  }

  // --- Subsystem Auto-Posters ---

  static async postInvoiceToGl(client: SupabaseClient, invoiceId: string) {
    const { data, error } = await client.rpc('post_invoice_to_gl', { p_invoice_id: invoiceId });
    if (error) throw new Error(`Invoice GL posting failed: ${error.message}`);
    return data;
  }

  static async postPaymentToGl(client: SupabaseClient, paymentId: string) {
    const { data, error } = await client.rpc('post_payment_to_gl', { p_payment_id: paymentId });
    if (error) throw new Error(`Payment GL posting failed: ${error.message}`);
    return data;
  }

  static async postSupplierBillToGl(client: SupabaseClient, billId: string) {
    const { data, error } = await client.rpc('post_supplier_bill_to_gl', { p_bill_id: billId });
    if (error) throw new Error(`Supplier bill GL posting failed: ${error.message}`);
    return data;
  }

  static async postSupplierPaymentToGl(client: SupabaseClient, paymentId: string) {
    const { data, error } = await client.rpc('post_supplier_payment_to_gl', { p_payment_id: paymentId });
    if (error) throw new Error(`Supplier payment GL posting failed: ${error.message}`);
    return data;
  }

  static async postExpenseToGl(client: SupabaseClient, expenseId: string) {
    const { data, error } = await client.rpc('post_expense_to_gl', { p_expense_id: expenseId });
    if (error) throw new Error(`Expense GL posting failed: ${error.message}`);
    return data;
  }

  static async postInventoryCogsToGl(client: SupabaseClient, stockLedgerId: string) {
    const { data, error } = await client.rpc('post_inventory_cogs_to_gl', { p_stock_ledger_id: stockLedgerId });
    if (error) throw new Error(`Inventory COGS posting failed: ${error.message}`);
    return data;
  }
}

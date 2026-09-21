import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import { JournalPostingService, JournalLineInput } from './journal-posting.service.js';
import { CategoryMappingService } from './category-mapping.service.js';
import { ChartOfAccountsService } from './chart-of-accounts.service.js';
import { PayrollCalculationService } from './payroll-calculation.service.js';

export interface PayrollGlAccounts {
  salaryExpenseId: string;
  employerExpenseId: string;
  salaryPayableId: string;
  contributionsPayableId: string;
  taxPayableId?: string | null;
}

export interface PayrollTotals {
  grossPay: number;
  totalDeductions: number;
  totalEmployerContributions: number;
  netPay: number;
}

export class PayrollAccountingService {
  /**
   * Pure journal lines builder: constructs balanced double-entry lines for a payroll run.
   */
  static buildPayrollGlJournalLines(
    totals: PayrollTotals,
    accounts: PayrollGlAccounts
  ): JournalLineInput[] {
    const lines: JournalLineInput[] = [];

    const gross = new Decimal(totals.grossPay).round(2);
    const employer = new Decimal(totals.totalEmployerContributions).round(2);
    const net = new Decimal(totals.netPay).round(2);
    const deductions = new Decimal(totals.totalDeductions).round(2);

    // 1. Debit Salary Expense (Gross Pay)
    if (gross.greaterThan(0)) {
      lines.push({
        accountId: accounts.salaryExpenseId,
        debit: gross.toNumber(),
        credit: 0,
        description: 'Gross Salary Expense',
      });
    }

    // 2. Debit Employer Contributions Expense
    if (employer.greaterThan(0)) {
      lines.push({
        accountId: accounts.employerExpenseId,
        debit: employer.toNumber(),
        credit: 0,
        description: 'Employer Contributions & Statutory Benefits',
      });
    }

    // 3. Credit Net Salary Payable
    if (net.greaterThan(0)) {
      lines.push({
        accountId: accounts.salaryPayableId,
        debit: 0,
        credit: net.toNumber(),
        description: 'Net Salary Payable to Employees',
      });
    }

    // 4. Credit Statutory / Employer Benefits Payable
    const statutoryPayable = employer.plus(deductions).round(2);
    if (statutoryPayable.greaterThan(0)) {
      lines.push({
        accountId: accounts.contributionsPayableId,
        debit: 0,
        credit: statutoryPayable.toNumber(),
        description: 'Employee Withholdings & Statutory Contributions Payable',
      });
    }

    // Validate debit = credit invariant
    let totalDebit = Decimal.zero();
    let totalCredit = Decimal.zero();
    for (const l of lines) {
      totalDebit = totalDebit.plus(new Decimal(l.debit));
      totalCredit = totalCredit.plus(new Decimal(l.credit));
    }

    if (!totalDebit.equals(totalCredit)) {
      throw new Error(
        `Imbalanced payroll journal lines: Debit (${totalDebit.toFixed(2)}) != Credit (${totalCredit.toFixed(2)})`
      );
    }

    return lines;
  }

  /**
   * Resolves GL accounts for payroll categories or falls back to standard COA.
   */
  static async resolvePayrollAccounts(
    client: SupabaseClient,
    companyId: string
  ): Promise<PayrollGlAccounts> {
    const salExp = await CategoryMappingService.getAccountForCategory(client, companyId, 'SALARY_EXPENSE');
    const empExp = await CategoryMappingService.getAccountForCategory(client, companyId, 'EMPLOYER_CONTRIBUTIONS_EXPENSE');
    const salPay = await CategoryMappingService.getAccountForCategory(client, companyId, 'SALARY_PAYABLE');
    const contPay = await CategoryMappingService.getAccountForCategory(client, companyId, 'CONTRIBUTIONS_PAYABLE');
    const taxPay = await CategoryMappingService.getAccountForCategory(client, companyId, 'TAX_PAYABLE');

    // Fallbacks to COA if category mappings are unconfigured
    const coaList = await ChartOfAccountsService.listAccounts(client, companyId);
    const findAccount = (type: string, fallbackSubtype?: string) => {
      const match = coaList.find(
        (a: any) =>
          a.account_type === type && (!fallbackSubtype || a.subtype === fallbackSubtype)
      );
      return match ? match.id : null;
    };

    const salaryExpenseId = salExp || findAccount('expense') || coaList[0]?.id;
    const employerExpenseId = empExp || salExp || findAccount('expense') || coaList[0]?.id;
    const salaryPayableId = salPay || findAccount('liability') || coaList[0]?.id;
    const contributionsPayableId = contPay || salPay || findAccount('liability') || coaList[0]?.id;

    if (!salaryExpenseId || !salaryPayableId) {
      throw new Error('Could not resolve Chart of Accounts for payroll posting');
    }

    return {
      salaryExpenseId,
      employerExpenseId,
      salaryPayableId,
      contributionsPayableId,
      taxPayableId: taxPay || null,
    };
  }

  /**
   * Posts periodic payroll accruals to the General Ledger.
   */
  static async postPayrollToGl(
    client: SupabaseClient,
    companyId: string,
    periodId: string,
    userId: string
  ) {
    const period = await PayrollCalculationService.getPayrollPeriod(client, periodId);
    if (period.gl_journal_id) {
      throw new Error('Payroll period has already been posted to the General Ledger');
    }

    const accounts = await this.resolvePayrollAccounts(client, companyId);

    const totals: PayrollTotals = {
      grossPay: Number(period.total_gross_pay || 0),
      totalDeductions: Number(period.total_deductions || 0),
      totalEmployerContributions: Number(period.total_employer_contributions || 0),
      netPay: Number(period.total_net_pay || 0),
    };

    const lines = this.buildPayrollGlJournalLines(totals, accounts);

    const journalResult = await JournalPostingService.createJournalEntry(client, {
      companyId,
      journalDate: period.period_end_date,
      description: `Payroll Accrual for Period: ${period.name} (${period.code})`,
      referenceType: 'PAYROLL',
      referenceId: period.id,
      lines,
      autoPost: true,
    });

    // Update payroll period with GL journal ID and transition status
    const { data: updatedPeriod, error } = await client
      .from('payroll_periods')
      .update({
        gl_journal_id: journalResult.journal.id,
        status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update period with GL reference: ${error.message}`);
    return { period: updatedPeriod, journal: journalResult.journal };
  }

  /**
   * Records disbursement of payroll from bank account to settle Salary Payable.
   */
  static async disbursePayroll(
    client: SupabaseClient,
    companyId: string,
    periodId: string,
    userId: string,
    bankAccountId?: string | null
  ) {
    const period = await PayrollCalculationService.getPayrollPeriod(client, periodId);
    if (period.disbursement_journal_id) {
      throw new Error('Payroll disbursement has already been recorded');
    }

    const accounts = await this.resolvePayrollAccounts(client, companyId);
    const bankAccount = bankAccountId || (await CategoryMappingService.getAccountForCategory(client, companyId, 'MAIN_BANK'));

    if (!bankAccount) {
      throw new Error('Bank account for payroll disbursement is not configured');
    }

    const netPay = new Decimal(period.total_net_pay || 0).round(2);
    if (netPay.isZero()) {
      throw new Error('Net pay is zero; nothing to disburse');
    }

    // Dr. Salary Payable, Cr. Bank
    const lines: JournalLineInput[] = [
      {
        accountId: accounts.salaryPayableId,
        debit: netPay.toNumber(),
        credit: 0,
        description: `Disbursement settlement for Payroll ${period.name}`,
      },
      {
        accountId: bankAccount,
        debit: 0,
        credit: netPay.toNumber(),
        description: `Bank disbursement for Payroll ${period.name}`,
      },
    ];

    const disbursementResult = await JournalPostingService.createJournalEntry(client, {
      companyId,
      journalDate: period.payment_date || new Date().toISOString().split('T')[0],
      description: `Payroll Salary Disbursement: ${period.name}`,
      referenceType: 'PAYROLL_DISBURSEMENT',
      referenceId: period.id,
      lines,
      autoPost: true,
    });

    const { data: updatedPeriod, error } = await client
      .from('payroll_periods')
      .update({
        disbursement_journal_id: disbursementResult.journal.id,
        status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update disbursement status: ${error.message}`);
    return { period: updatedPeriod, journal: disbursementResult.journal };
  }
}

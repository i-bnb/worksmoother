import { SupabaseClient } from '@supabase/supabase-js';

export interface UpdateAccountingSettingsDto {
  fiscalYearStartMonth?: number;
  accountingBaseCurrency?: string;
  decimalPrecision?: number;
  defaultPaymentTerms?: string;
  defaultDueDays?: number;
  allowFutureDatedTransactions?: boolean;
  allowSelfExpenseApproval?: boolean;
  taxRate?: number;
  taxName?: string;
  taxInclusive?: boolean;
}

export class AccountingSettingsService {
  /**
   * Retrieves accounting settings for an organization.
   */
  static async getSettings(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('settings')
      .select(`
        company_id,
        currency,
        fiscal_year_start_month,
        accounting_base_currency,
        decimal_precision,
        default_payment_terms,
        default_due_days,
        allow_future_dated_transactions,
        allow_self_expense_approval,
        tax_rate,
        tax_name,
        tax_inclusive
      `)
      .eq('company_id', companyId)
      .single();

    if (error) throw new Error(`Failed to fetch accounting settings: ${error.message}`);
    return data;
  }

  /**
   * Updates organization accounting settings.
   */
  static async updateSettings(client: SupabaseClient, companyId: string, dto: UpdateAccountingSettingsDto) {
    const payload: Record<string, any> = {};

    if (dto.fiscalYearStartMonth !== undefined) {
      if (dto.fiscalYearStartMonth < 1 || dto.fiscalYearStartMonth > 12) {
        throw new Error('fiscalYearStartMonth must be between 1 and 12');
      }
      payload.fiscal_year_start_month = dto.fiscalYearStartMonth;
    }
    if (dto.accountingBaseCurrency !== undefined) payload.accounting_base_currency = dto.accountingBaseCurrency.toUpperCase().trim();
    if (dto.decimalPrecision !== undefined) payload.decimal_precision = dto.decimalPrecision;
    if (dto.defaultPaymentTerms !== undefined) payload.default_payment_terms = dto.defaultPaymentTerms.trim();
    if (dto.defaultDueDays !== undefined) payload.default_due_days = dto.defaultDueDays;
    if (dto.allowFutureDatedTransactions !== undefined) payload.allow_future_dated_transactions = dto.allowFutureDatedTransactions;
    if (dto.allowSelfExpenseApproval !== undefined) payload.allow_self_expense_approval = dto.allowSelfExpenseApproval;
    if (dto.taxRate !== undefined) payload.tax_rate = dto.taxRate;
    if (dto.taxName !== undefined) payload.tax_name = dto.taxName.trim();
    if (dto.taxInclusive !== undefined) payload.tax_inclusive = dto.taxInclusive;

    const { data, error } = await client
      .from('settings')
      .update(payload)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update accounting settings: ${error.message}`);
    return data;
  }
}

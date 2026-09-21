import { SupabaseClient } from '@supabase/supabase-js';

export class FinancialReportingService {
  /**
   * Retrieves trial balance across all accounts and verifies debits = credits.
   */
  static async getTrialBalance(client: SupabaseClient, companyId: string) {
    const { data: rows, error: rErr } = await client
      .from('view_trial_balance')
      .select('*')
      .eq('company_id', companyId)
      .order('account_code', { ascending: true });

    if (rErr) throw new Error(`Trial balance fetch failed: ${rErr.message}`);

    const { data: validation, error: vErr } = await client.rpc('validate_trial_balance', {
      p_company_id: companyId,
    });

    if (vErr) throw new Error(`Trial balance validation failed: ${vErr.message}`);

    return {
      accounts: rows,
      validation,
    };
  }

  /**
   * Retrieves line-by-line General Ledger running balance.
   */
  static async getGeneralLedger(
    client: SupabaseClient,
    companyId: string,
    filters: { accountId?: string; fromDate?: string; toDate?: string } = {}
  ) {
    let query = client
      .from('view_general_ledger')
      .select('*')
      .eq('company_id', companyId)
      .order('journal_date', { ascending: true })
      .order('line_number', { ascending: true });

    if (filters.accountId) query = query.eq('account_id', filters.accountId);
    if (filters.fromDate) query = query.gte('journal_date', filters.fromDate);
    if (filters.toDate) query = query.lte('journal_date', filters.toDate);

    const { data, error } = await query;
    if (error) throw new Error(`General ledger fetch failed: ${error.message}`);
    return data;
  }

  /**
   * Retrieves operational Profit & Loss statement.
   */
  static async getProfitAndLoss(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('view_profit_and_loss')
      .select('*')
      .eq('company_id', companyId)
      .single();

    if (error) throw new Error(`Profit & loss fetch failed: ${error.message}`);
    return data;
  }

  /**
   * Retrieves authoritative Balance Sheet.
   */
  static async getBalanceSheet(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('view_balance_sheet')
      .select('*')
      .eq('company_id', companyId)
      .single();

    if (error) throw new Error(`Balance sheet fetch failed: ${error.message}`);
    return data;
  }

  /**
   * Retrieves bank and cash treasury summary.
   */
  static async getCashSummary(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('bank_accounts')
      .select('id, account_name, bank_name, account_number_last4, currency, current_balance, is_active')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (error) throw new Error(`Cash summary fetch failed: ${error.message}`);
    return data;
  }
}

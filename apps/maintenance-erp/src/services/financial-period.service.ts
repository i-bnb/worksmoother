import { SupabaseClient } from '@supabase/supabase-js';

export class FinancialPeriodService {
  /**
   * Pure calculation of fiscal year based on start month (defaulting to April = 4 for India).
   */
  static calculateFiscalYear(dateInput: Date | string = new Date(), startMonth: number = 4): string {
    let year: number;
    let month: number;

    if (typeof dateInput === 'string') {
      const datePart = dateInput.split('T')[0];
      const parts = datePart.split('-');
      if (parts.length === 3 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
      } else {
        const d = new Date(dateInput);
        year = d.getUTCFullYear();
        month = d.getUTCMonth() + 1;
      }
    } else {
      year = dateInput.getUTCFullYear();
      month = dateInput.getUTCMonth() + 1;
    }

    if (startMonth === 1) {
      return year.toString();
    }

    if (month >= startMonth) {
      return `${year}-${year + 1}`;
    } else {
      return `${year - 1}-${year}`;
    }
  }


  /**
   * Resolves the company's fiscal year for a given date via the database.
   */
  static async getFiscalYear(client: SupabaseClient, companyId: string, date?: string): Promise<string> {
    const { data, error } = await client.rpc('get_fiscal_year', {
      p_company_id: companyId,
      p_date: date || new Date().toISOString().slice(0, 10),
    });

    if (error) throw new Error(`Fiscal year resolution failed: ${error.message}`);
    return data as string;
  }

  /**
   * Validates that a transaction date falls into an OPEN accounting period.
   */
  static async validatePeriod(client: SupabaseClient, companyId: string, date: string): Promise<string> {
    const { data, error } = await client.rpc('validate_financial_period', {
      p_company_id: companyId,
      p_date: date,
    });

    if (error) throw new Error(`Period validation failed: ${error.message}`);
    return data as string;
  }

  /**
   * Closes an accounting period, restricting future transaction posting.
   */
  static async closePeriod(client: SupabaseClient, periodId: string) {
    const { data, error } = await client.rpc('close_accounting_period', {
      p_period_id: periodId,
    });

    if (error) throw new Error(`Failed to close accounting period: ${error.message}`);
    return data;
  }

  /**
   * Permanently locks an accounting period against all modifications.
   */
  static async lockPeriod(client: SupabaseClient, periodId: string) {
    const { data, error } = await client.rpc('lock_accounting_period', {
      p_period_id: periodId,
    });

    if (error) throw new Error(`Failed to lock accounting period: ${error.message}`);
    return data;
  }

  /**
   * Lists all accounting periods for a tenant.
   */
  static async listPeriods(client: SupabaseClient, companyId: string, fiscalYear?: number) {
    let query = client
      .from('accounting_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('start_date', { ascending: true });

    if (fiscalYear) {
      query = query.eq('fiscal_year', fiscalYear);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list accounting periods: ${error.message}`);
    return data;
  }
}

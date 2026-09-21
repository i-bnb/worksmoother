import { SupabaseClient } from '@supabase/supabase-js';

export class ContractReportingService {
  /**
   * Retrieves contract profitability foundation (revenue, parts cost, labor cost, expenses, gross margin).
   */
  static async getContractProfitability(client: SupabaseClient, contractId: string) {
    const { data, error } = await client.rpc('get_contract_profitability', {
      p_contract_id: contractId,
    });

    if (error) throw new Error(`Failed to calculate contract profitability: ${error.message}`);
    return data;
  }

  /**
   * Retrieves organization-level AMC and contract portfolio metrics.
   */
  static async getContractsSummary(client: SupabaseClient, companyId: string) {
    const { data: contracts, error } = await client
      .from('amc_contracts')
      .select('id, status, contract_value, start_date, end_date')
      .eq('company_id', companyId);

    if (error) throw new Error(`Failed to fetch contracts summary: ${error.message}`);

    let totalValue = 0;
    let activeCount = 0;
    let expiringCount = 0;
    let expiredCount = 0;

    const today = new Date();
    const threshold = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const c of contracts || []) {
      totalValue += Number(c.contract_value || 0);

      if (c.status === 'active') {
        activeCount++;
        const end = new Date(c.end_date);
        if (end <= threshold && end >= today) {
          expiringCount++;
        }
      } else if (c.status === 'expired') {
        expiredCount++;
      }
    }

    return {
      totalContracts: (contracts || []).length,
      activeContracts: activeCount,
      expiringContracts: expiringCount,
      expiredContracts: expiredCount,
      totalPortfolioValue: parseFloat(totalValue.toFixed(3)),
    };
  }
}

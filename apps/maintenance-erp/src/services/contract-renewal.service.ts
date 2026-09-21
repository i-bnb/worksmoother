import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export class ContractRenewalService {
  /**
   * Renews an active or expiring contract, preserving full historical audit linkage.
   */
  static async renewContract(
    client: SupabaseClient,
    contractId: string,
    options: { priceAdjustmentPercent?: number; startDate?: string; endDate?: string } = {}
  ) {
    const { data: oldContract, error: oErr } = await client
      .from('amc_contracts')
      .select('*, covered_assets:amc_contract_assets(*)')
      .eq('id', contractId)
      .single();

    if (oErr || !oldContract) throw new Error(`Contract not found: ${contractId}`);

    const oldStart = new Date(oldContract.start_date);
    const oldEnd = new Date(oldContract.end_date);
    const durationDays = Math.round((oldEnd.getTime() - oldStart.getTime()) / (1000 * 60 * 60 * 24));

    const newStart = options.startDate
      ? new Date(options.startDate)
      : new Date(Date.UTC(oldEnd.getUTCFullYear(), oldEnd.getUTCMonth(), oldEnd.getUTCDate() + 1));

    const newEnd = options.endDate
      ? new Date(options.endDate)
      : new Date(newStart.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const adjustmentPct = options.priceAdjustmentPercent || 0;
    const oldVal = new Decimal(oldContract.contract_value);
    const multiplier = new Decimal(1).plus(new Decimal(adjustmentPct).dividedBy(100));
    const newVal = oldVal.times(multiplier).round(3);

    const oldTax = new Decimal(oldContract.tax_amount || 0);
    const newTax = oldTax.times(multiplier).round(3);

    // 1. Create New Renewal Contract
    const { data: newContract, error: nErr } = await client
      .from('amc_contracts')
      .insert({
        company_id: oldContract.company_id,
        branch_id: oldContract.branch_id,
        customer_id: oldContract.customer_id,
        site_id: oldContract.site_id,
        contract_type: oldContract.contract_type,
        start_date: newStart.toISOString().slice(0, 10),
        end_date: newEnd.toISOString().slice(0, 10),
        contract_value: newVal.toNumber(),
        tax_amount: newTax.toNumber(),
        billing_frequency: oldContract.billing_frequency,
        service_frequency: oldContract.service_frequency,
        currency: oldContract.currency,
        status: 'active',
        previous_contract_id: oldContract.id,
        notes: `Renewed from ${oldContract.contract_number} (${adjustmentPct >= 0 ? '+' : ''}${adjustmentPct}% adjustment)`,
      })
      .select()
      .single();

    if (nErr) throw new Error(`Failed to create renewal contract: ${nErr.message}`);

    // 2. Link renewal back on old contract and update old status to renewed
    await client
      .from('amc_contracts')
      .update({
        status: 'renewed',
        renewal_contract_id: newContract.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', oldContract.id);

    // 3. Copy covered assets to renewal contract
    if (oldContract.covered_assets && oldContract.covered_assets.length > 0) {
      const assetRows = oldContract.covered_assets.map((ca: any) => ({
        amc_contract_id: newContract.id,
        customer_asset_id: ca.customer_asset_id,
        coverage_type: ca.coverage_type,
        visit_frequency: ca.visit_frequency,
        included_services: ca.included_services,
        exclusions: ca.exclusions,
        asset_price: ca.asset_price,
        is_active: true,
      }));

      await client.from('amc_contract_assets').insert(assetRows);
    }

    return {
      previousContractId: oldContract.id,
      previousContractNumber: oldContract.contract_number,
      renewalContractId: newContract.id,
      renewalContractNumber: newContract.contract_number,
      startDate: newContract.start_date,
      endDate: newContract.end_date,
      contractValue: newContract.contract_value,
    };
  }

  /**
   * Scans for active contracts that are expiring within warning period.
   */
  static async detectExpiringContracts(
    client: SupabaseClient,
    companyId: string,
    daysBeforeExpiry: number = 30
  ) {
    const today = new Date();
    const thresholdDate = new Date(today.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000);

    const { data, error } = await client
      .from('amc_contracts')
      .select('id, contract_number, customer_id, customer:customers(name), start_date, end_date, contract_value, status')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .lte('end_date', thresholdDate.toISOString().slice(0, 10))
      .order('end_date', { ascending: true });

    if (error) throw new Error(`Failed to scan expiring contracts: ${error.message}`);
    return data;
  }
}

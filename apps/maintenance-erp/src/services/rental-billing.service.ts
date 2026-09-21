import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface OptimalRentalCostResult {
  totalDays: number;
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  optimizedCost: number;
  bestRateStructure: 'daily' | 'weekly' | 'monthly';
}

export class RentalBillingService {
  /**
   * Pure deterministic rate optimization calculating lowest combination of daily/weekly/monthly rates.
   */
  static calculateOptimalRentalCost(
    totalDays: number,
    dailyRate: number,
    weeklyRate: number,
    monthlyRate: number
  ): OptimalRentalCostResult {
    if (totalDays <= 0) {
      throw new Error('totalDays must be strictly positive');
    }

    const days = totalDays;
    const dRateDec = new Decimal(dailyRate);
    const wRateDec = new Decimal(weeklyRate);
    const mRateDec = new Decimal(monthlyRate);

    // 1. Daily cost
    const dailyCostDec = new Decimal(days).times(dRateDec).round(3);

    // 2. Weekly cost
    const weeks = Math.floor(days / 7);
    const remDaysWeekly = days % 7;
    const weeklyCostDec = new Decimal(weeks)
      .times(wRateDec)
      .plus(new Decimal(remDaysWeekly).times(dRateDec))
      .round(3);

    // 3. Monthly cost (30 days per month)
    const months = Math.floor(days / 30);
    const remDaysMonthly = days % 30;
    const remWeeks = Math.floor(remDaysMonthly / 7);
    const finalRemDays = remDaysMonthly % 7;
    const partialMonthlyCost = new Decimal(months)
      .times(mRateDec)
      .plus(new Decimal(remWeeks).times(wRateDec))
      .plus(new Decimal(finalRemDays).times(dRateDec));

    const nextFullMonthCost = new Decimal(months + 1).times(mRateDec);
    const monthlyCostDec = (monthlyRate > 0 && nextFullMonthCost.lessThan(partialMonthlyCost))
      ? nextFullMonthCost.round(3)
      : partialMonthlyCost.round(3);

    let optimizedCostDec = dailyCostDec;
    let bestRateStructure: 'daily' | 'weekly' | 'monthly' = 'daily';

    if (weeklyRate > 0 && weeklyCostDec.lessThan(optimizedCostDec)) {
      optimizedCostDec = weeklyCostDec;
      bestRateStructure = 'weekly';
    }

    if (monthlyRate > 0 && monthlyCostDec.lessThan(optimizedCostDec)) {
      optimizedCostDec = monthlyCostDec;
      bestRateStructure = 'monthly';
    }

    return {
      totalDays,
      dailyCost: dailyCostDec.toNumber(),
      weeklyCost: weeklyCostDec.toNumber(),
      monthlyCost: monthlyCostDec.toNumber(),
      optimizedCost: optimizedCostDec.toNumber(),
      bestRateStructure,
    };
  }

  /**
   * Generates a commercial invoice in Phase 2B invoices engine for all uninvoiced charges.
   */
  static async generateRentalInvoice(
    client: SupabaseClient,
    contractId: string
  ): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    grandTotal: number;
    chargesBilled: number;
  }> {
    const { data, error } = await client.rpc('generate_rental_invoice_v2', {
      p_contract_id: contractId,
    });

    if (error) throw error;
    return {
      invoiceId: data.invoice_id,
      invoiceNumber: data.invoice_number,
      grandTotal: Number(data.grand_total ?? 0),
      chargesBilled: data.charges_billed,
    };
  }

  /**
   * List all rental charges for a contract.
   */
  static async listContractCharges(
    client: SupabaseClient,
    contractId: string
  ): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await client
      .from('rental_charges')
      .select('*')
      .eq('rental_contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }
}

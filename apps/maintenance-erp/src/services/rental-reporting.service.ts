import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface FleetUtilizationReport {
  totalAssets: number;
  availableAssets: number;
  activeRentals: number;
  maintenanceAssets: number;
  overdueRentals: number;
  periodDays: number;
  totalRentedDays: number;
  utilizationPercentage: number;
}

export class RentalReportingService {
  /**
   * Pure calculation of fleet utilization percentage.
   */
  static computeUtilizationRate(
    totalAssets: number,
    periodDays: number,
    totalRentedDays: number
  ): number {
    if (totalAssets <= 0 || periodDays <= 0) return 0;
    const totalFleetDays = new Decimal(totalAssets).times(new Decimal(periodDays));
    if (totalFleetDays.isZero()) return 0;

    const rentedDaysDec = new Decimal(totalRentedDays);
    const pctDec = rentedDaysDec.dividedBy(totalFleetDays).times(100).round(2);
    return pctDec.toNumber();
  }

  /**
   * Generate fleet utilization report via RPC.
   */
  static async getUtilizationReport(
    client: SupabaseClient,
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<FleetUtilizationReport> {
    const { data, error } = await client.rpc('get_rental_fleet_utilization', {
      p_company_id: companyId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) throw error;
    return {
      totalAssets: data.total_assets ?? 0,
      availableAssets: data.available_assets ?? 0,
      activeRentals: data.active_rentals ?? 0,
      maintenanceAssets: data.maintenance_assets ?? 0,
      overdueRentals: data.overdue_rentals ?? 0,
      periodDays: data.period_days ?? 0,
      totalRentedDays: data.total_rented_days ?? 0,
      utilizationPercentage: Number(data.utilization_percentage ?? 0),
    };
  }

  /**
   * Retrieve active rentals currently past their expected return date.
   */
  static async getOverdueRentals(
    client: SupabaseClient,
    companyId: string
  ): Promise<Array<Record<string, unknown>>> {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await client
      .from('rental_contracts')
      .select('*, customers(name, code)')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .lt('expected_return_date', today);

    if (error) throw error;
    return data || [];
  }
}

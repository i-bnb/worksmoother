import { SupabaseClient } from '@supabase/supabase-js';
import { MaintenanceScheduleCreateDto } from '../schemas/maintenance-schedule.schema.js';

export interface CalculatedScheduleOccurrence {
  scheduledDate: string;
  periodLabel: string;
}

export class MaintenanceScheduleService {
  /**
   * Pure recurring dates calculation supporting both calendar intervals and custom day frequencies.
   */
  static calculateRecurringDates(
    startDateInput: string | Date,
    endDateInput: string | Date,
    frequency: string = 'quarterly',
    intervalDays?: number | null
  ): CalculatedScheduleOccurrence[] {
    const start = typeof startDateInput === 'string' ? new Date(startDateInput) : startDateInput;
    const end = typeof endDateInput === 'string' ? new Date(endDateInput) : endDateInput;

    const occurrences: CalculatedScheduleOccurrence[] = [];
    let current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const finalDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    let index = 1;

    while (current <= finalDate) {
      const dateStr = current.toISOString().slice(0, 10);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const periodLabel = `Visit-${String(index).padStart(2, '0')} (${monthNames[current.getUTCMonth()]} ${current.getUTCFullYear()})`;

      occurrences.push({
        scheduledDate: dateStr,
        periodLabel,
      });

      index++;

      // Advance date
      if (frequency === 'monthly') {
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate()));
      } else if (frequency === 'bi_monthly') {
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 2, current.getUTCDate()));
      } else if (frequency === 'quarterly') {
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 3, current.getUTCDate()));
      } else if (frequency === 'semi_annual' || frequency === 'half_yearly') {
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 6, current.getUTCDate()));
      } else if (frequency === 'annual' || frequency === 'yearly') {
        current = new Date(Date.UTC(current.getUTCFullYear() + 1, current.getUTCMonth(), current.getUTCDate()));
      } else if (intervalDays && intervalDays > 0) {
        current = new Date(current.getTime() + intervalDays * 24 * 60 * 60 * 1000);
      } else {
        // Default quarterly advance
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 3, current.getUTCDate()));
      }
    }

    return occurrences;
  }

  /**
   * Creates a maintenance schedule entry.
   */
  static async createSchedule(client: SupabaseClient, dto: MaintenanceScheduleCreateDto) {
    const idempotencyKey = `SCHED-${dto.contractId}-${dto.customerAssetId || 'GENERAL'}-${dto.scheduledDate}`;

    const { data, error } = await client
      .from('amc_schedules')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        amc_contract_id: dto.contractId,
        amc_contract_asset_id: dto.contractAssetId || null,
        customer_asset_id: dto.customerAssetId || null,
        scheduled_date: dto.scheduledDate,
        period_label: dto.periodLabel,
        schedule_type: dto.scheduleType || 'preventive',
        frequency: dto.frequency || 'quarterly',
        interval_days: dto.intervalDays || null,
        priority: dto.priority || 'medium',
        checklist_id: dto.checklistId || null,
        assigned_technician_id: dto.assignedTechnicianId || null,
        notes: dto.notes || null,
        status: 'scheduled',
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (error) throw new Error(`Schedule creation failed: ${error.message}`);
    return data;
  }

  /**
   * Lists maintenance schedules with filters.
   */
  static async listSchedules(
    client: SupabaseClient,
    companyId: string,
    filters: { contractId?: string; assetId?: string; status?: string; fromDate?: string; toDate?: string } = {}
  ) {
    let query = client
      .from('amc_schedules')
      .select(
        `*,
        contract:amc_contracts(id, contract_number, customer_id, customer:customers(name)),
        asset:customer_assets(id, name, serial_number),
        work_order:work_orders(id, work_order_number, status)`
      )
      .eq('company_id', companyId)
      .order('scheduled_date', { ascending: true });

    if (filters.contractId) query = query.eq('amc_contract_id', filters.contractId);
    if (filters.assetId) query = query.eq('customer_asset_id', filters.assetId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.fromDate) query = query.gte('scheduled_date', filters.fromDate);
    if (filters.toDate) query = query.lte('scheduled_date', filters.toDate);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list schedules: ${error.message}`);
    return data;
  }

  /**
   * Generates maintenance schedules for a contract via RPC.
   */
  static async generateContractSchedules(client: SupabaseClient, contractId: string) {
    const { data, error } = await client.rpc('generate_amc_schedule', {
      p_contract_id: contractId,
    });

    if (error) throw new Error(`Schedule generation failed: ${error.message}`);
    return data;
  }

  /**
   * Dispatches a scheduled maintenance visit into a real Phase 1 Work Order.
   */
  static async generateWorkOrder(client: SupabaseClient, scheduleId: string) {
    const { data, error } = await client.rpc('generate_amc_work_order', {
      p_schedule_id: scheduleId,
    });

    if (error) throw new Error(`Work order generation failed: ${error.message}`);
    return data;
  }
}

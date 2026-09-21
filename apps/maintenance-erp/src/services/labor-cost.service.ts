import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal, DecimalLike } from '../lib/decimal.js';

export interface TimesheetLaborInput {
  durationHours: DecimalLike;
  isOvertime?: boolean;
  laborRate: DecimalLike;
  overtimeRate?: DecimalLike;
  technicianId?: string;
  technicianName?: string;
}

export interface WorkOrderLaborCostResult {
  regularHours: number;
  overtimeHours: number;
  regularCost: number;
  overtimeCost: number;
  totalLaborCost: number;
  lineBreakdown: Array<{
    technicianId?: string;
    technicianName?: string;
    hours: number;
    rate: number;
    cost: number;
    isOvertime: boolean;
  }>;
}

export interface TechnicianAvailabilityResult {
  isAvailable: boolean;
  reason?: string;
  serviceCapacity: number;
  assignedHours: number;
  remainingCapacityHours: number;
}

export class LaborCostService {
  /**
   * Pure calculation engine: Computes job direct labor costing from timesheets.
   */
  static calculateLaborCost(timesheets: TimesheetLaborInput[]): WorkOrderLaborCostResult {
    let sumRegHours = Decimal.zero();
    let sumOtHours = Decimal.zero();
    let sumRegCost = Decimal.zero();
    let sumOtCost = Decimal.zero();

    const lineBreakdown: WorkOrderLaborCostResult['lineBreakdown'] = [];

    for (const ts of timesheets) {
      const hours = new Decimal(ts.durationHours || 0);
      const isOt = Boolean(ts.isOvertime);
      const regRate = new Decimal(ts.laborRate || 0);
      const otRate = new Decimal(ts.overtimeRate || (regRate.times(1.5)));

      const rate = isOt ? otRate : regRate;
      const cost = hours.times(rate).round(2);

      if (isOt) {
        sumOtHours = sumOtHours.plus(hours);
        sumOtCost = sumOtCost.plus(cost);
      } else {
        sumRegHours = sumRegHours.plus(hours);
        sumRegCost = sumRegCost.plus(cost);
      }

      lineBreakdown.push({
        technicianId: ts.technicianId,
        technicianName: ts.technicianName,
        hours: hours.toNumber(),
        rate: rate.toNumber(),
        cost: cost.toNumber(),
        isOvertime: isOt,
      });
    }

    const totalLaborCost = sumRegCost.plus(sumOtCost).round(2);

    return {
      regularHours: sumRegHours.round(2).toNumber(),
      overtimeHours: sumOtHours.round(2).toNumber(),
      regularCost: sumRegCost.toNumber(),
      overtimeCost: sumOtCost.toNumber(),
      totalLaborCost: totalLaborCost.toNumber(),
      lineBreakdown,
    };
  }

  /**
   * Pure availability evaluation for a technician on a target date.
   */
  static evaluateTechnicianAvailability(params: {
    isOnLeave?: boolean;
    isHoliday?: boolean;
    isWeekOff?: boolean;
    attendanceStatus?: string;
    serviceCapacityHours?: number;
    assignedWorkOrderHours?: number;
  }): TechnicianAvailabilityResult {
    const capacity = params.serviceCapacityHours !== undefined ? params.serviceCapacityHours : 8;
    const assigned = params.assignedWorkOrderHours !== undefined ? params.assignedWorkOrderHours : 0;
    const remaining = Math.max(0, capacity - assigned);

    if (params.isOnLeave) {
      return {
        isAvailable: false,
        reason: 'Technician is on approved leave',
        serviceCapacity: capacity,
        assignedHours: assigned,
        remainingCapacityHours: 0,
      };
    }

    if (params.isHoliday) {
      return {
        isAvailable: false,
        reason: 'Target date is a declared holiday',
        serviceCapacity: capacity,
        assignedHours: assigned,
        remainingCapacityHours: 0,
      };
    }

    if (params.isWeekOff) {
      return {
        isAvailable: false,
        reason: 'Target date is a scheduled non-working day',
        serviceCapacity: capacity,
        assignedHours: assigned,
        remainingCapacityHours: 0,
      };
    }

    if (params.attendanceStatus === 'absent') {
      return {
        isAvailable: false,
        reason: 'Technician is marked absent',
        serviceCapacity: capacity,
        assignedHours: assigned,
        remainingCapacityHours: 0,
      };
    }

    if (remaining <= 0) {
      return {
        isAvailable: false,
        reason: 'Technician capacity is fully allocated for this date',
        serviceCapacity: capacity,
        assignedHours: assigned,
        remainingCapacityHours: 0,
      };
    }

    return {
      isAvailable: true,
      serviceCapacity: capacity,
      assignedHours: assigned,
      remainingCapacityHours: remaining,
    };
  }

  /**
   * Computes work order direct labor costing from timesheets.
   */
  static async computeWorkOrderLaborCost(
    client: SupabaseClient,
    companyId: string,
    workOrderId: string
  ): Promise<WorkOrderLaborCostResult> {
    const { data: timesheets, error } = await client
      .from('timesheets')
      .select('*, technician:employees(id, display_name, labor_rate, overtime_rate)')
      .eq('work_order_id', workOrderId);

    if (error) throw new Error(`Failed to fetch work order timesheets: ${error.message}`);

    const inputs: TimesheetLaborInput[] = (timesheets || []).map((ts: any) => {
      const tech = ts.technician || {};
      const durationHours = ts.duration_minutes ? ts.duration_minutes / 60 : (ts.hours || 0);
      return {
        durationHours,
        isOvertime: Boolean(ts.is_overtime),
        laborRate: tech.labor_rate || 0,
        overtimeRate: tech.overtime_rate || (tech.labor_rate ? tech.labor_rate * 1.5 : 0),
        technicianId: tech.id,
        technicianName: tech.display_name,
      };
    });

    return this.calculateLaborCost(inputs);
  }

  /**
   * Evaluates live technician availability on a given date.
   */
  static async getTechnicianAvailability(
    client: SupabaseClient,
    companyId: string,
    technicianId: string,
    dateStr: string
  ): Promise<TechnicianAvailabilityResult> {
    // 1. Fetch technician profile
    const { data: tech, error: techErr } = await client
      .from('employees')
      .select('service_capacity, is_technician')
      .eq('id', technicianId)
      .eq('company_id', companyId)
      .single();

    if (techErr || !tech) throw new Error('Technician profile not found');
    const capacityHours = tech.service_capacity ? tech.service_capacity / 12.5 : 8; // e.g. 100 capacity = 8h

    // 2. Check leaves
    const { data: leave } = await client
      .from('leave_requests')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', technicianId)
      .eq('status', 'approved')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .maybeSingle();

    // 3. Check holiday
    const { data: holiday } = await client
      .from('holidays')
      .select('id')
      .eq('company_id', companyId)
      .eq('holiday_date', dateStr)
      .maybeSingle();

    // 4. Check attendance
    const { data: attendance } = await client
      .from('attendance_days')
      .select('status')
      .eq('company_id', companyId)
      .eq('employee_id', technicianId)
      .eq('attendance_date', dateStr)
      .maybeSingle();

    // 5. Check work order assignments
    const { data: assignedOrders } = await client
      .from('work_orders')
      .select('id, estimated_duration_hours')
      .eq('company_id', companyId)
      .eq('assigned_technician_id', technicianId)
      .eq('scheduled_date', dateStr);

    const assignedHours = (assignedOrders || []).reduce(
      (acc: number, wo: any) => acc + Number(wo.estimated_duration_hours || 2),
      0
    );

    return this.evaluateTechnicianAvailability({
      isOnLeave: Boolean(leave),
      isHoliday: Boolean(holiday),
      attendanceStatus: attendance?.status,
      serviceCapacityHours: capacityHours,
      assignedWorkOrderHours: assignedHours,
    });
  }
}

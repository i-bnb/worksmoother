import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface AppointmentSlotDuration {
  durationMinutes: number;
  travelBufferMinutes?: number;
}

export interface CapacityCalculationResult {
  totalShiftHours: number;
  scheduledJobHours: number;
  travelBufferHours: number;
  reservedHours: number;
  availableCapacityHours: number;
  activeJobsCount: number;
  utilizationPercentage: number;
  isOnLeave: boolean;
}

export class TechnicianCapacityService {
  /**
   * Pure capacity computation formula.
   */
  static calculateCapacity(params: {
    shiftWorkingHours: number; // e.g. 8.0
    isOnLeave?: boolean;
    appointments: AppointmentSlotDuration[];
    reservedMinutes?: number;
  }): CapacityCalculationResult {
    const shiftHours = Math.max(0, params.shiftWorkingHours);
    const totalShiftMinutes = shiftHours * 60;

    if (params.isOnLeave) {
      return {
        totalShiftHours: shiftHours,
        scheduledJobHours: 0,
        travelBufferHours: 0,
        reservedHours: 0,
        availableCapacityHours: 0,
        activeJobsCount: 0,
        utilizationPercentage: 0,
        isOnLeave: true,
      };
    }

    let jobMinutes = 0;
    let bufferMinutes = 0;

    for (const a of params.appointments) {
      jobMinutes += Math.max(0, a.durationMinutes);
      bufferMinutes += Math.max(0, a.travelBufferMinutes || 0);
    }

    const reservedMin = Math.max(0, params.reservedMinutes || 0);
    const totalUsedMinutes = jobMinutes + bufferMinutes + reservedMin;
    const availableMinutes = Math.max(0, totalShiftMinutes - totalUsedMinutes);

    const scheduledJobHours = new Decimal(jobMinutes).dividedBy(60).round(2).toNumber();
    const travelBufferHours = new Decimal(bufferMinutes).dividedBy(60).round(2).toNumber();
    const reservedHours = new Decimal(reservedMin).dividedBy(60).round(2).toNumber();
    const availableCapacityHours = new Decimal(availableMinutes).dividedBy(60).round(2).toNumber();

    let utilization = 0;
    if (totalShiftMinutes > 0) {
      utilization = Math.min(
        100,
        new Decimal(totalUsedMinutes).times(100).dividedBy(totalShiftMinutes).round(1).toNumber()
      );
    }

    return {
      totalShiftHours: shiftHours,
      scheduledJobHours,
      travelBufferHours,
      reservedHours,
      availableCapacityHours,
      activeJobsCount: params.appointments.length,
      utilizationPercentage: utilization,
      isOnLeave: false,
    };
  }

  /**
   * Evaluates a technician's live daily capacity on a target date.
   */
  static async getDailyCapacity(
    client: SupabaseClient,
    companyId: string,
    technicianId: string,
    dateStr: string
  ): Promise<CapacityCalculationResult> {
    // 1. Check leave
    const { data: leaves } = await client
      .from('leave_requests')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', technicianId)
      .eq('status', 'approved')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr);

    const isOnLeave = Boolean(leaves && leaves.length > 0);

    // 2. Fetch active appointments
    const { data: appointments } = await client
      .from('service_appointments')
      .select('estimated_duration_minutes, travel_buffer_minutes')
      .eq('company_id', companyId)
      .eq('assigned_technician_id', technicianId)
      .eq('appointment_date', dateStr)
      .not('status', 'in', '("cancelled","rescheduled")');

    const slots: AppointmentSlotDuration[] = (appointments || []).map((a: any) => ({
      durationMinutes: a.estimated_duration_minutes || 120,
      travelBufferMinutes: a.travel_buffer_minutes || 30,
    }));

    return this.calculateCapacity({
      shiftWorkingHours: 8.0,
      isOnLeave,
      appointments: slots,
    });
  }

  /**
   * Evaluates weekly capacity for a technician.
   */
  static async getWeeklyCapacity(
    client: SupabaseClient,
    companyId: string,
    technicianId: string,
    weekStartDateStr: string // YYYY-MM-DD
  ) {
    const start = new Date(weekStartDateStr);
    const dailyResults: Record<string, CapacityCalculationResult> = {};

    let totalAvailableHours = 0;
    let totalScheduledHours = 0;
    let totalJobs = 0;

    for (let i = 0; i < 7; i++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + i);
      const curStr = cur.toISOString().split('T')[0];

      const cap = await this.getDailyCapacity(client, companyId, technicianId, curStr);
      dailyResults[curStr] = cap;
      totalAvailableHours += cap.availableCapacityHours;
      totalScheduledHours += cap.scheduledJobHours;
      totalJobs += cap.activeJobsCount;
    }

    return {
      weekStartDate: weekStartDateStr,
      technicianId,
      totalAvailableHours: Number(totalAvailableHours.toFixed(2)),
      totalScheduledHours: Number(totalScheduledHours.toFixed(2)),
      totalJobs,
      days: dailyResults,
    };
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  WorkScheduleCreateDto,
  ScheduleAssignmentDto,
  HolidayCalendarCreateDto,
  HolidayCreateDto,
  PunchRecordDto,
  AttendanceCorrectionDto,
  OvertimeRecordDto,
  AttendanceStatus,
  PunchType,
} from '../schemas/attendance-leave.schema.js';

export interface PunchRecordItem {
  punch_time: string | Date;
  punch_type: PunchType;
}

export interface WorkScheduleConfig {
  shift_start_time: string; // "09:00:00" or "09:00"
  shift_end_time: string;   // "18:00:00" or "18:00"
  working_days?: number[];  // [1, 2, 3, 4, 5]
  break_minutes?: number;
  grace_period_minutes?: number;
  half_day_threshold_minutes?: number;
  full_day_threshold_minutes?: number;
  overtime_threshold_minutes?: number;
}

export interface DailyRollupResult {
  status: AttendanceStatus;
  scheduledMinutes: number;
  actualWorkMinutes: number;
  breakMinutes: number;
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  regularHours: number;
  overtimeHours: number;
}

export class AttendanceService {
  /**
   * Helper: Parse "HH:MM" or "HH:MM:SS" into total minutes from midnight.
   */
  static parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0] || '0', 10);
    const minutes = parseInt(parts[1] || '0', 10);
    return hours * 60 + minutes;
  }

  /**
   * Pure calculation engine for a day's attendance rollup given schedule and punches.
   */
  static calculateDailyRollup(params: {
    schedule: WorkScheduleConfig;
    punches: PunchRecordItem[];
    dateStr: string; // "YYYY-MM-DD"
    isHoliday?: boolean;
    isOnLeave?: boolean;
  }): DailyRollupResult {
    const { schedule, punches, dateStr, isHoliday, isOnLeave } = params;

    const shiftStartMin = this.parseTimeToMinutes(schedule.shift_start_time);
    const shiftEndMin = this.parseTimeToMinutes(schedule.shift_end_time);
    const scheduledMinutes = Math.max(0, shiftEndMin - shiftStartMin - (schedule.break_minutes || 0));

    // Date / day-of-week check (1 = Monday, 7 = Sunday)
    const dateObj = new Date(`${dateStr}T00:00:00Z`);
    const dayOfWeek = dateObj.getUTCDay() === 0 ? 7 : dateObj.getUTCDay();
    const workingDays = schedule.working_days || [1, 2, 3, 4, 5];
    const isScheduledWorkDay = workingDays.includes(dayOfWeek);

    // Initial non-working checks
    if (isOnLeave) {
      return {
        status: 'on_leave',
        scheduledMinutes,
        actualWorkMinutes: 0,
        breakMinutes: 0,
        lateArrivalMinutes: 0,
        earlyDepartureMinutes: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    if (isHoliday) {
      return {
        status: 'holiday',
        scheduledMinutes,
        actualWorkMinutes: 0,
        breakMinutes: 0,
        lateArrivalMinutes: 0,
        earlyDepartureMinutes: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    if (!isScheduledWorkDay && punches.length === 0) {
      return {
        status: 'week_off',
        scheduledMinutes: 0,
        actualWorkMinutes: 0,
        breakMinutes: 0,
        lateArrivalMinutes: 0,
        earlyDepartureMinutes: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    if (punches.length === 0) {
      return {
        status: 'absent',
        scheduledMinutes,
        actualWorkMinutes: 0,
        breakMinutes: 0,
        lateArrivalMinutes: 0,
        earlyDepartureMinutes: 0,
        regularHours: 0,
        overtimeHours: 0,
      };
    }

    // Chronologically sort punches
    const sorted = [...punches].sort(
      (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
    );

    let totalWorkSecs = 0;
    let totalBreakSecs = 0;

    let activeClockIn: Date | null = null;
    let activeBreakStart: Date | null = null;

    let firstClockIn: Date | null = null;
    let lastClockOut: Date | null = null;

    for (const p of sorted) {
      const pTime = new Date(p.punch_time);

      if (p.punch_type === 'clock_in') {
        if (!firstClockIn) firstClockIn = pTime;
        activeClockIn = pTime;
      } else if (p.punch_type === 'clock_out') {
        if (activeClockIn) {
          totalWorkSecs += Math.max(0, (pTime.getTime() - activeClockIn.getTime()) / 1000);
          activeClockIn = null;
        }
        lastClockOut = pTime;
      } else if (p.punch_type === 'break_start') {
        activeBreakStart = pTime;
      } else if (p.punch_type === 'break_end') {
        if (activeBreakStart) {
          totalBreakSecs += Math.max(0, (pTime.getTime() - activeBreakStart.getTime()) / 1000);
          activeBreakStart = null;
        }
      }
    }

    // In case there is an unclosed clock_in or only clock_in
    if (activeClockIn && sorted.length === 1 && firstClockIn) {
      lastClockOut = activeClockIn;
    }

    const breakMinutes = Math.floor(totalBreakSecs / 60);
    const actualWorkMinutes = Math.max(0, Math.floor(totalWorkSecs / 60) - breakMinutes);

    // Late arrival
    let lateArrivalMinutes = 0;
    if (firstClockIn) {
      const punchInHours = firstClockIn.getUTCHours();
      const punchInMins = firstClockIn.getUTCMinutes();
      const punchInTotalMins = punchInHours * 60 + punchInMins;
      const graceLimit = shiftStartMin + (schedule.grace_period_minutes || 0);
      if (punchInTotalMins > graceLimit) {
        lateArrivalMinutes = punchInTotalMins - shiftStartMin;
      }
    }

    // Early departure
    let earlyDepartureMinutes = 0;
    if (lastClockOut) {
      const punchOutHours = lastClockOut.getUTCHours();
      const punchOutMins = lastClockOut.getUTCMinutes();
      const punchOutTotalMins = punchOutHours * 60 + punchOutMins;
      if (punchOutTotalMins < shiftEndMin) {
        earlyDepartureMinutes = shiftEndMin - punchOutTotalMins;
      }
    }

    // Thresholds
    const halfDayThreshold = schedule.half_day_threshold_minutes || 240;
    const fullDayThreshold = schedule.full_day_threshold_minutes || 480;
    const overtimeThreshold = schedule.overtime_threshold_minutes || scheduledMinutes;

    let status: AttendanceStatus = 'absent';
    if (actualWorkMinutes >= fullDayThreshold) {
      status = 'present';
    } else if (actualWorkMinutes >= halfDayThreshold) {
      status = 'half_day';
    } else {
      status = 'absent';
    }

    // Regular and overtime hours
    let regularMinutes = Math.min(actualWorkMinutes, scheduledMinutes);
    let otMinutes = 0;
    if (actualWorkMinutes > overtimeThreshold) {
      otMinutes = actualWorkMinutes - overtimeThreshold;
    }

    const regularHours = new Decimal(regularMinutes).dividedBy(60).round(2).toNumber();
    const overtimeHours = new Decimal(otMinutes).dividedBy(60).round(2).toNumber();

    return {
      status,
      scheduledMinutes,
      actualWorkMinutes,
      breakMinutes,
      lateArrivalMinutes,
      earlyDepartureMinutes,
      regularHours,
      overtimeHours,
    };
  }

  /**
   * Creates a work schedule.
   */
  static async createWorkSchedule(client: SupabaseClient, dto: WorkScheduleCreateDto) {
    const { data, error } = await client
      .from('work_schedules')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        shift_start_time: dto.shiftStartTime,
        shift_end_time: dto.shiftEndTime,
        working_days: dto.workingDays || [1, 2, 3, 4, 5],
        break_minutes: dto.breakMinutes || 60,
        grace_period_minutes: dto.gracePeriodMinutes || 15,
        half_day_threshold_minutes: dto.halfDayThresholdMinutes || 240,
        full_day_threshold_minutes: dto.fullDayThresholdMinutes || 480,
        overtime_threshold_minutes: dto.overtimeThresholdMinutes || 540,
        is_default: Boolean(dto.isDefault),
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create work schedule: ${error.message}`);
    return data;
  }

  /**
   * Assigns a schedule to an employee.
   */
  static async assignSchedule(client: SupabaseClient, dto: ScheduleAssignmentDto) {
    const { data, error } = await client
      .from('employee_schedule_assignments')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        schedule_id: dto.scheduleId,
        effective_from: dto.effectiveFrom,
        effective_to: dto.effectiveTo || null,
      })
      .select('*, schedule:work_schedules(*)')
      .single();

    if (error) throw new Error(`Failed to assign work schedule: ${error.message}`);
    return data;
  }

  /**
   * Creates a holiday calendar.
   */
  static async createHolidayCalendar(client: SupabaseClient, dto: HolidayCalendarCreateDto) {
    const { data, error } = await client
      .from('holiday_calendars')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        year: dto.year,
        is_default: Boolean(dto.isDefault),
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create holiday calendar: ${error.message}`);
    return data;
  }

  /**
   * Adds a holiday to a calendar.
   */
  static async addHoliday(client: SupabaseClient, dto: HolidayCreateDto) {
    const { data, error } = await client
      .from('holidays')
      .insert({
        company_id: dto.companyId,
        calendar_id: dto.calendarId,
        holiday_date: dto.holidayDate,
        name: dto.name,
        holiday_type: dto.holidayType || 'public',
        is_recurring: Boolean(dto.isRecurring),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add holiday: ${error.message}`);
    return data;
  }

  /**
   * Records an attendance punch.
   */
  static async recordPunch(client: SupabaseClient, dto: PunchRecordDto) {
    const { data, error } = await client
      .from('attendance_punches')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        punch_time: dto.punchTime,
        punch_type: dto.punchType,
        latitude: dto.latitude || null,
        longitude: dto.longitude || null,
        device_id: dto.deviceId || null,
        ip_address: dto.ipAddress || null,
        notes: dto.notes || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record punch: ${error.message}`);
    return data;
  }

  /**
   * Processes and rolls up attendance for a given employee and date.
   */
  static async processDailyAttendance(
    client: SupabaseClient,
    companyId: string,
    employeeId: string,
    dateStr: string
  ) {
    // 1. Fetch assigned schedule or default schedule
    const { data: assignments } = await client
      .from('employee_schedule_assignments')
      .select('schedule:work_schedules(*)')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .lte('effective_from', dateStr)
      .order('effective_from', { ascending: false })
      .limit(1);

    let scheduleRaw = assignments?.[0]?.schedule;
    if (!scheduleRaw) {
      const { data: defaultSched } = await client
        .from('work_schedules')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_default', true)
        .single();
      scheduleRaw = defaultSched;
    }

    if (!scheduleRaw) {
      throw new Error('No work schedule found for employee');
    }

    const schedule: any = Array.isArray(scheduleRaw) ? scheduleRaw[0] : scheduleRaw;


    // 2. Check if holiday
    const { data: holiday } = await client
      .from('holidays')
      .select('id')
      .eq('company_id', companyId)
      .eq('holiday_date', dateStr)
      .maybeSingle();

    // 3. Check if on approved leave
    const { data: approvedLeave } = await client
      .from('leave_requests')
      .select('id')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .maybeSingle();

    // 4. Fetch punches for this day
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const { data: punches } = await client
      .from('attendance_punches')
      .select('punch_time, punch_type')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .gte('punch_time', dayStart)
      .lte('punch_time', dayEnd)
      .order('punch_time', { ascending: true });

    // 5. Compute rollup
    const rollup = this.calculateDailyRollup({
      schedule,
      punches: punches || [],
      dateStr,
      isHoliday: Boolean(holiday),
      isOnLeave: Boolean(approvedLeave),
    });

    // 6. Upsert into attendance_days
    const { data, error } = await client
      .from('attendance_days')
      .upsert(
        {
          company_id: companyId,
          employee_id: employeeId,
          attendance_date: dateStr,
          schedule_id: schedule.id,
          status: rollup.status,
          scheduled_minutes: rollup.scheduledMinutes,
          actual_work_minutes: rollup.actualWorkMinutes,
          break_minutes: rollup.breakMinutes,
          late_arrival_minutes: rollup.lateArrivalMinutes,
          early_departure_minutes: rollup.earlyDepartureMinutes,
          regular_hours: rollup.regularHours,
          overtime_hours: rollup.overtimeHours,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id, employee_id, attendance_date' }
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to save daily attendance: ${error.message}`);
    return data;
  }

  /**
   * Requests an attendance correction.
   */
  static async requestCorrection(client: SupabaseClient, dto: AttendanceCorrectionDto) {
    const { data, error } = await client
      .from('attendance_corrections')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        attendance_date: dto.attendanceDate,
        requested_status: dto.requestedStatus || null,
        requested_punch_in: dto.requestedPunchIn || null,
        requested_punch_out: dto.requestedPunchOut || null,
        reason: dto.reason,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to request attendance correction: ${error.message}`);
    return data;
  }

  /**
   * Approves or rejects attendance correction.
   */
  static async approveCorrection(
    client: SupabaseClient,
    correctionId: string,
    approverId: string,
    approved: boolean,
    rejectionReason?: string
  ) {
    const { data: correction, error: fetchErr } = await client
      .from('attendance_corrections')
      .select('*')
      .eq('id', correctionId)
      .single();

    if (fetchErr || !correction) throw new Error('Attendance correction not found');

    const status = approved ? 'approved' : 'rejected';
    const { data, error } = await client
      .from('attendance_corrections')
      .update({
        status,
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        rejection_reason: rejectionReason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', correctionId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update correction: ${error.message}`);

    // If approved, update attendance_days
    if (approved && correction.requested_status) {
      await client
        .from('attendance_days')
        .update({
          status: correction.requested_status,
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', correction.company_id)
        .eq('employee_id', correction.employee_id)
        .eq('attendance_date', correction.attendance_date);
    }

    return data;
  }

  /**
   * Records overtime hours.
   */
  static async recordOvertime(client: SupabaseClient, dto: OvertimeRecordDto) {
    const { data, error } = await client
      .from('overtime_records')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        overtime_date: dto.overtimeDate,
        start_time: dto.startTime || null,
        end_time: dto.endTime || null,
        overtime_hours: dto.overtimeHours,
        rate_multiplier: dto.rateMultiplier || 1.5,
        reason: dto.reason || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record overtime: ${error.message}`);
    return data;
  }

  /**
   * Approves overtime record.
   */
  static async approveOvertime(
    client: SupabaseClient,
    id: string,
    approverId: string,
    approved: boolean = true
  ) {
    const { data, error } = await client
      .from('overtime_records')
      .update({
        status: approved ? 'approved' : 'rejected',
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update overtime record: ${error.message}`);
    return data;
  }
}

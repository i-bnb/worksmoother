import { SupabaseClient } from '@supabase/supabase-js';

export interface TimeSlot {
  id?: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  travelBufferMinutes?: number;
  status?: string;
}

export interface SchedulingEvaluationResult {
  hasConflict: boolean;
  conflictType?: 'overlap' | 'travel_buffer' | 'leave' | 'outside_shift' | 'sla_violation';
  conflictingAppointmentId?: string;
  message?: string;
}

export class SchedulingEngineService {
  /**
   * Pure conflict check: determines if two time spans (including travel buffers) collide.
   */
  static hasTimeConflict(
    slotA: { start: number; end: number; bufferMin?: number },
    slotB: { start: number; end: number; bufferMin?: number }
  ): boolean {
    const bufA = (slotA.bufferMin || 0) * 60 * 1000;
    const bufB = (slotB.bufferMin || 0) * 60 * 1000;

    const startAWithBuf = slotA.start - bufA;
    const endAWithBuf = slotA.end + bufA;

    const startBWithBuf = slotB.start - bufB;
    const endBWithBuf = slotB.end + bufB;

    return startAWithBuf < endBWithBuf && endAWithBuf > startBWithBuf;
  }

  /**
   * Pure conflict detection against an array of existing appointments for a technician.
   */
  static checkAppointmentConflicts(
    existing: TimeSlot[],
    target: { startTime: string; endTime: string; travelBufferMinutes?: number },
    excludeId?: string
  ): SchedulingEvaluationResult {
    const targetStart = new Date(target.startTime).getTime();
    const targetEnd = new Date(target.endTime).getTime();

    if (isNaN(targetStart) || isNaN(targetEnd) || targetStart >= targetEnd) {
      return {
        hasConflict: true,
        conflictType: 'overlap',
        message: 'Target appointment start time must be strictly before end time',
      };
    }

    for (const appt of existing) {
      if (excludeId && appt.id === excludeId) continue;
      if (appt.status && ['cancelled', 'completed', 'rescheduled'].includes(appt.status)) continue;

      const apptStart = new Date(appt.startTime).getTime();
      const apptEnd = new Date(appt.endTime).getTime();

      // Check pure appointment overlap
      if (targetStart < apptEnd && targetEnd > apptStart) {
        return {
          hasConflict: true,
          conflictType: 'overlap',
          conflictingAppointmentId: appt.id,
          message: `Direct schedule collision with existing appointment #${appt.id || ''}`,
        };
      }

      // Check travel buffer overlap
      if (
        this.hasTimeConflict(
          { start: targetStart, end: targetEnd, bufferMin: target.travelBufferMinutes || 30 },
          { start: apptStart, end: apptEnd, bufferMin: appt.travelBufferMinutes || 30 }
        )
      ) {
        return {
          hasConflict: true,
          conflictType: 'travel_buffer',
          conflictingAppointmentId: appt.id,
          message: `Travel buffer conflict with existing appointment #${appt.id || ''}`,
        };
      }
    }

    return { hasConflict: false };
  }

  /**
   * Pure shift verification: checks if slot is within working hours (e.g. "08:00" to "18:00").
   */
  static isWithinShift(
    startTimeIso: string,
    endTimeIso: string,
    shiftStartTimeStr: string, // "08:00" or "08:00:00"
    shiftEndTimeStr: string,   // "18:00" or "18:00:00"
    workingDays: number[] = [1, 2, 3, 4, 5]
  ): boolean {
    const start = new Date(startTimeIso);
    const end = new Date(endTimeIso);

    // Day of week check (1 = Monday, 7 = Sunday)
    const dayOfWeek = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
    if (!workingDays.includes(dayOfWeek)) {
      return false;
    }

    const parseToMin = (t: string) => {
      const [h, m] = t.split(':').map((x) => parseInt(x, 10));
      return (h || 0) * 60 + (m || 0);
    };

    const shiftStartMin = parseToMin(shiftStartTimeStr);
    const shiftEndMin = parseToMin(shiftEndTimeStr);

    const slotStartMin = start.getUTCHours() * 60 + start.getUTCMinutes();
    const slotEndMin = end.getUTCHours() * 60 + end.getUTCMinutes();

    return slotStartMin >= shiftStartMin && slotEndMin <= shiftEndMin;
  }

  /**
   * Evaluates if SLA deadline is respected.
   */
  static isSlaRespected(endTimeIso: string, slaDeadlineIso?: string | null): boolean {
    if (!slaDeadlineIso) return true;
    const end = new Date(endTimeIso).getTime();
    const deadline = new Date(slaDeadlineIso).getTime();
    return end <= deadline;
  }

  /**
   * Evaluates technician scheduling feasibility on the live database.
   */
  static async evaluateTechnicianAvailability(
    client: SupabaseClient,
    companyId: string,
    technicianId: string,
    target: { startTime: string; endTime: string; date: string; travelBufferMinutes?: number; slaDeadline?: string | null },
    excludeAppointmentId?: string
  ): Promise<SchedulingEvaluationResult> {
    // 1. Check approved leave on this date
    const { data: leaves } = await client
      .from('leave_requests')
      .select('id, start_date, end_date')
      .eq('company_id', companyId)
      .eq('employee_id', technicianId)
      .eq('status', 'approved')
      .lte('start_date', target.date)
      .gte('end_date', target.date);

    if (leaves && leaves.length > 0) {
      return {
        hasConflict: true,
        conflictType: 'leave',
        message: 'Technician is on approved leave on this date',
      };
    }

    // 2. Check existing appointments
    const { data: existingAppts } = await client
      .from('service_appointments')
      .select('id, start_time, end_time, travel_buffer_minutes, status')
      .eq('company_id', companyId)
      .eq('assigned_technician_id', technicianId)
      .eq('appointment_date', target.date)
      .not('status', 'in', '("cancelled","completed","rescheduled")');

    const formatted: TimeSlot[] = (existingAppts || []).map((a: any) => ({
      id: a.id,
      startTime: a.start_time,
      endTime: a.end_time,
      travelBufferMinutes: a.travel_buffer_minutes,
      status: a.status,
    }));

    const conflict = this.checkAppointmentConflicts(formatted, target, excludeAppointmentId);
    if (conflict.hasConflict) {
      return conflict;
    }

    // 3. SLA check
    if (target.slaDeadline && !this.isSlaRespected(target.endTime, target.slaDeadline)) {
      return {
        hasConflict: true,
        conflictType: 'sla_violation',
        message: 'Appointment end time exceeds SLA resolution deadline',
      };
    }

    return { hasConflict: false };
  }
}

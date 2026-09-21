/**
 * =============================================================================
 * Test Suite 4: Attendance Rollup Calculation Engine & Punch Corrections
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { AttendanceService, WorkScheduleConfig } from '../../src/services/attendance.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';

describe('Phase 6: Attendance Calculation Engine & Corrections', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  const defaultSchedule: WorkScheduleConfig = {
    shift_start_time: '09:00:00',
    shift_end_time: '18:00:00',
    working_days: [1, 2, 3, 4, 5],
    break_minutes: 60,
    grace_period_minutes: 15,
    half_day_threshold_minutes: 240, // 4 hours
    full_day_threshold_minutes: 480, // 8 hours
    overtime_threshold_minutes: 480, // 8 hours
  };

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('attendance_days').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Attendance Rollup Calculation Engine', () => {
    it('calculates standard full day present status with break deduction', () => {
      // Monday 2026-03-02
      const punches = [
        { punch_time: '2026-03-02T09:00:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T13:00:00.000Z', punch_type: 'break_start' as const },
        { punch_time: '2026-03-02T14:00:00.000Z', punch_type: 'break_end' as const },
        { punch_time: '2026-03-02T18:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.status).toBe('present');
      expect(res.actualWorkMinutes).toBe(480); // 9 hours total - 1 hour break = 8 hours
      expect(res.breakMinutes).toBe(60);
      expect(res.lateArrivalMinutes).toBe(0);
      expect(res.earlyDepartureMinutes).toBe(0);
      expect(res.regularHours).toBe(8);
      expect(res.overtimeHours).toBe(0);
    });

    it('enforces grace period: punches within grace period are not marked late', () => {
      // Punch at 09:10 (grace period is 15 mins -> 09:15)
      const punches = [
        { punch_time: '2026-03-02T09:10:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T18:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.lateArrivalMinutes).toBe(0);
    });

    it('calculates late arrival when punch is beyond grace period', () => {
      // Punch at 09:25 (25 mins past 09:00)
      const punches = [
        { punch_time: '2026-03-02T09:25:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T18:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.lateArrivalMinutes).toBe(25);
    });

    it('calculates early departure when clock out is before shift end', () => {
      // Clock out at 17:30 (shift ends at 18:00 -> 30 mins early)
      const punches = [
        { punch_time: '2026-03-02T09:00:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T17:30:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.earlyDepartureMinutes).toBe(30);
    });

    it('identifies half day status when working minutes meet half day threshold', () => {
      // Worked 5 hours (300 mins) -> >= 240 (half day) but < 480 (full day)
      const punches = [
        { punch_time: '2026-03-02T09:00:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T14:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.status).toBe('half_day');
      expect(res.actualWorkMinutes).toBe(300);
    });

    it('identifies absent status when working minutes are below half day threshold', () => {
      // Worked only 2 hours (120 mins) -> < 240
      const punches = [
        { punch_time: '2026-03-02T09:00:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T11:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.status).toBe('absent');
      expect(res.actualWorkMinutes).toBe(120);
    });

    it('calculates overtime hours when total work exceeds overtime threshold', () => {
      // Worked 10 hours (600 mins) -> 2 hours overtime
      const punches = [
        { punch_time: '2026-03-02T08:00:00.000Z', punch_type: 'clock_in' as const },
        { punch_time: '2026-03-02T18:00:00.000Z', punch_type: 'clock_out' as const },
      ];

      const res = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches,
        dateStr: '2026-03-02',
      });

      expect(res.actualWorkMinutes).toBe(600);
      expect(res.regularHours).toBe(8);
      expect(res.overtimeHours).toBe(2);
    });

    it('handles holidays and scheduled week offs correctly', () => {
      // Holiday
      const holRes = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches: [],
        dateStr: '2026-03-02',
        isHoliday: true,
      });
      expect(holRes.status).toBe('holiday');

      // Sunday week off (2026-03-01 is Sunday -> day 7)
      const weekOffRes = AttendanceService.calculateDailyRollup({
        schedule: defaultSchedule,
        punches: [],
        dateStr: '2026-03-01',
      });
      expect(weekOffRes.status).toBe('week_off');
    });
  });

  describe('Database Integration', () => {
    it('requests and approves attendance correction flow', async () => {
      if (!isLiveDb) return;

      const emp = await EmployeeService.createEmployee(admin, {
        companyId: DEMO_COMPANY_A,
        firstName: 'Tariq',
        lastName: 'Al-Mansoor',
        workEmail: `tariq.mansoor.${Date.now()}@maintenance-erp.test`,
        joiningDate: '2026-01-01',
      });

      const correction = await AttendanceService.requestCorrection(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        attendanceDate: '2026-03-03',
        requestedStatus: 'present',
        reason: 'Biometric fingerprint reader was offline at site',
      });

      expect(correction.id).toBeDefined();
      expect(correction.status).toBe('pending');

      const approved = await AttendanceService.approveCorrection(
        admin,
        correction.id,
        emp.id,
        true
      );
      expect(approved.status).toBe('approved');
    });
  });
});

/**
 * =============================================================================
 * Test Suite 3: Work Schedules, Shifts, Holiday Calendars & Punch Recording
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { AttendanceService } from '../../src/services/attendance.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import {
  validateWorkScheduleCreate,
  validateScheduleAssignment,
  validateHolidayCalendarCreate,
  validateHolidayCreate,
  validatePunchRecord,
} from '../../src/schemas/attendance-leave.schema.js';

describe('Phase 6: Work Schedules & Attendance Punches', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('work_schedules').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Validation & Configuration Logic (Pure)', () => {
    it('validates work schedule parameters and default thresholds', () => {
      const valid = validateWorkScheduleCreate({
        companyId: DEMO_COMPANY_A,
        code: 'SHIFT-MORNING',
        name: 'Standard Morning Shift',
        shiftStartTime: '08:00',
        shiftEndTime: '17:00',
        workingDays: [1, 2, 3, 4, 5],
        gracePeriodMinutes: 15,
        breakMinutes: 60,
      });

      expect(valid.code).toBe('SHIFT-MORNING');
      expect(valid.shiftStartTime).toBe('08:00');
      expect(valid.shiftEndTime).toBe('17:00');
      expect(valid.workingDays).toEqual([1, 2, 3, 4, 5]);
      expect(valid.gracePeriodMinutes).toBe(15);
      expect(valid.halfDayThresholdMinutes).toBe(240);
      expect(valid.fullDayThresholdMinutes).toBe(480);
    });

    it('validates schedule assignment DTO', () => {
      const valid = validateScheduleAssignment({
        companyId: DEMO_COMPANY_A,
        employeeId: 'emp-101',
        scheduleId: 'sched-202',
        effectiveFrom: '2026-01-01',
      });

      expect(valid.effectiveFrom).toBe('2026-01-01');
      expect(valid.effectiveTo).toBeNull();
    });

    it('validates holiday calendar and holiday creation schemas', () => {
      const cal = validateHolidayCalendarCreate({
        companyId: DEMO_COMPANY_A,
        code: 'CAL-2026',
        name: 'UAE Statutory Holidays 2026',
        year: 2026,
        isDefault: true,
      });
      expect(cal.year).toBe(2026);
      expect(cal.isDefault).toBe(true);

      const holiday = validateHolidayCreate({
        companyId: DEMO_COMPANY_A,
        calendarId: 'cal-123',
        holidayDate: '2026-12-02',
        name: 'UAE National Day',
        holidayType: 'public',
      });
      expect(holiday.holidayDate).toBe('2026-12-02');
      expect(holiday.holidayType).toBe('public');
    });

    it('validates punch records with permitted punch types', () => {
      const validPunches = ['clock_in', 'clock_out', 'break_start', 'break_end'] as const;
      for (const p of validPunches) {
        const res = validatePunchRecord({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-99',
          punchTime: new Date().toISOString(),
          punchType: p,
        });
        expect(res.punchType).toBe(p);
      }

      expect(() =>
        validatePunchRecord({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-99',
          punchTime: new Date().toISOString(),
          punchType: 'random_punch' as any,
        })
      ).toThrow(/punchType must be one of/i);
    });
  });

  describe('Database Integration', () => {
    it('creates schedule, holiday calendar, and records live punches', async () => {
      if (!isLiveDb) return;

      const schedule = await AttendanceService.createWorkSchedule(admin, {
        companyId: DEMO_COMPANY_A,
        code: `SCHED-${Date.now()}`,
        name: 'Commercial Site Shift',
        shiftStartTime: '08:00:00',
        shiftEndTime: '17:00:00',
        workingDays: [1, 2, 3, 4, 5],
        breakMinutes: 60,
        gracePeriodMinutes: 15,
      });
      expect(schedule.id).toBeDefined();

      const emp = await EmployeeService.createEmployee(admin, {
        companyId: DEMO_COMPANY_A,
        firstName: 'Elena',
        lastName: 'Rostova',
        workEmail: `elena.rostova.${Date.now()}@maintenance-erp.test`,
        joiningDate: '2026-01-15',
      });

      // Assign schedule
      const assignment = await AttendanceService.assignSchedule(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        scheduleId: schedule.id,
        effectiveFrom: '2026-01-01',
      });
      expect(assignment.id).toBeDefined();

      // Record clock in punch
      const punchIn = await AttendanceService.recordPunch(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        punchTime: '2026-03-02T08:05:00.000Z',
        punchType: 'clock_in',
        latitude: 25.2048,
        longitude: 55.2708,
      });
      expect(punchIn.id).toBeDefined();
      expect(punchIn.punch_type).toBe('clock_in');
    });
  });
});

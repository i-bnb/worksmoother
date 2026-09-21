/**
 * =============================================================================
 * Test Suite 2: Appointment Scheduling Engine & Conflict Detection
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  SchedulingEngineService,
  TimeSlot,
} from '../../src/services/scheduling-engine.service.js';
import {
  validateAppointmentCreate,
  validateAppointmentAssign,
  validateAppointmentMultiAssign,
  validateAppointmentReschedule,
} from '../../src/schemas/service-appointment.schema.js';

describe('Phase 7: Appointment Scheduling Engine & Conflict Detection', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('service_appointments').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Scheduling & Conflict Detection Engine', () => {
    it('detects direct overlapping appointment collision', () => {
      const existing: TimeSlot[] = [
        {
          id: 'appt-001',
          startTime: '2026-03-15T09:00:00.000Z',
          endTime: '2026-03-15T11:00:00.000Z',
          travelBufferMinutes: 30,
        },
      ];

      // Target overlaps 10:00 - 12:00
      const result = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-15T10:00:00.000Z',
        endTime: '2026-03-15T12:00:00.000Z',
        travelBufferMinutes: 30,
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('overlap');
      expect(result.conflictingAppointmentId).toBe('appt-001');
    });

    it('detects travel buffer collision when appointments are back-to-back without travel buffer time', () => {
      const existing: TimeSlot[] = [
        {
          id: 'appt-001',
          startTime: '2026-03-15T09:00:00.000Z',
          endTime: '2026-03-15T11:00:00.000Z',
          travelBufferMinutes: 30,
        },
      ];

      // Target starts at 11:15, but appt-001 needs 30 mins buffer (until 11:30)
      const result = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-15T11:15:00.000Z',
        endTime: '2026-03-15T13:00:00.000Z',
        travelBufferMinutes: 30,
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('travel_buffer');
      expect(result.conflictingAppointmentId).toBe('appt-001');
    });

    it('permits appointments when sufficient buffer gap exists', () => {
      const existing: TimeSlot[] = [
        {
          id: 'appt-001',
          startTime: '2026-03-15T08:00:00.000Z',
          endTime: '2026-03-15T10:00:00.000Z',
          travelBufferMinutes: 30,
        },
      ];

      // Target starts at 12:00 (10:00 + 30 min buffer = 10:30, target 12:00 - 30 min buffer = 11:30 => no overlap)
      const result = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-15T12:00:00.000Z',
        endTime: '2026-03-15T14:00:00.000Z',
        travelBufferMinutes: 30,
      });

      expect(result.hasConflict).toBe(false);
    });

    it('ignores cancelled, completed, and rescheduled appointments during conflict evaluation', () => {
      const existing: TimeSlot[] = [
        {
          id: 'appt-cancelled',
          startTime: '2026-03-15T09:00:00.000Z',
          endTime: '2026-03-15T11:00:00.000Z',
          status: 'cancelled',
        },
        {
          id: 'appt-rescheduled',
          startTime: '2026-03-15T09:00:00.000Z',
          endTime: '2026-03-15T11:00:00.000Z',
          status: 'rescheduled',
        },
        {
          id: 'appt-completed',
          startTime: '2026-03-15T09:00:00.000Z',
          endTime: '2026-03-15T11:00:00.000Z',
          status: 'completed',
        },
      ];

      const result = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-15T09:30:00.000Z',
        endTime: '2026-03-15T10:30:00.000Z',
      });

      expect(result.hasConflict).toBe(false);
    });

    it('rejects invalid or inverted time intervals', () => {
      const existing: TimeSlot[] = [];

      // End time before start time
      const result = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-15T14:00:00.000Z',
        endTime: '2026-03-15T12:00:00.000Z',
      });

      expect(result.hasConflict).toBe(true);
      expect(result.message).toMatch(/strictly before end time/i);
    });
  });

  describe('Pure Shift Boundary & Working Hours Verification', () => {
    it('verifies slot is strictly inside shift working hours', () => {
      // 09:00 to 13:00 is within 08:00 to 17:00
      const isInside = SchedulingEngineService.isWithinShift(
        '2026-03-16T09:00:00.000Z', // Monday
        '2026-03-16T13:00:00.000Z',
        '08:00',
        '17:00',
        [1, 2, 3, 4, 5]
      );
      expect(isInside).toBe(true);
    });

    it('rejects slot starting before shift begins', () => {
      const isInside = SchedulingEngineService.isWithinShift(
        '2026-03-16T07:30:00.000Z', // 07:30 < 08:00
        '2026-03-16T11:00:00.000Z',
        '08:00',
        '17:00',
        [1, 2, 3, 4, 5]
      );
      expect(isInside).toBe(false);
    });

    it('rejects slot ending after shift ends', () => {
      const isInside = SchedulingEngineService.isWithinShift(
        '2026-03-16T14:00:00.000Z',
        '2026-03-16T18:30:00.000Z', // 18:30 > 17:00
        '08:00',
        '17:00',
        [1, 2, 3, 4, 5]
      );
      expect(isInside).toBe(false);
    });

    it('rejects slot scheduled on a non-working day', () => {
      // 2026-03-15 is Sunday (day 7)
      const isInside = SchedulingEngineService.isWithinShift(
        '2026-03-15T10:00:00.000Z',
        '2026-03-15T12:00:00.000Z',
        '08:00',
        '17:00',
        [1, 2, 3, 4, 5] // Mon-Fri
      );
      expect(isInside).toBe(false);
    });
  });

  describe('Pure SLA Target Resolution Verification', () => {
    it('approves appointment when scheduled finish time is before SLA deadline', () => {
      const apptEnd = '2026-03-16T14:00:00.000Z';
      const slaDeadline = '2026-03-16T16:00:00.000Z';

      expect(SchedulingEngineService.isSlaRespected(apptEnd, slaDeadline)).toBe(true);
    });

    it('rejects appointment when scheduled finish time exceeds SLA deadline', () => {
      const apptEnd = '2026-03-16T18:00:00.000Z';
      const slaDeadline = '2026-03-16T16:00:00.000Z';

      expect(SchedulingEngineService.isSlaRespected(apptEnd, slaDeadline)).toBe(false);
    });

    it('permits appointment when SLA deadline is null or unspecified', () => {
      const apptEnd = '2026-03-16T18:00:00.000Z';
      expect(SchedulingEngineService.isSlaRespected(apptEnd, null)).toBe(true);
      expect(SchedulingEngineService.isSlaRespected(apptEnd, undefined)).toBe(true);
    });
  });

  describe('Appointment DTO Validation Schemas', () => {
    it('validates appointment creation schema', () => {
      const valid = validateAppointmentCreate({
        companyId: DEMO_COMPANY_A,
        workOrderId: 'wo-101',
        customerId: 'cust-101',
        siteId: 'site-101',
        appointmentDate: '2026-03-16',
        startTime: '2026-03-16T09:00:00.000Z',
        endTime: '2026-03-16T11:00:00.000Z',
        estimatedDurationMinutes: 120,
        travelBufferMinutes: 30,
        priority: 'high',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.estimatedDurationMinutes).toBe(120);
      expect(valid.priority).toBe('high');
    });

    it('validates appointment technician assignment schema', () => {
      const valid = validateAppointmentAssign({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        technicianId: 'emp-001',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.technicianId).toBe('emp-001');
    });

    it('validates appointment crew multi-assignment schema', () => {
      const valid = validateAppointmentMultiAssign({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        employeeId: 'emp-002',
        role: 'assistant',
        isPrimary: false,
      });

      expect(valid.role).toBe('assistant');
      expect(valid.isPrimary).toBe(false);
    });

    it('validates reschedule schema with permitted reasons', () => {
      const valid = validateAppointmentReschedule({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        newDate: '2026-03-17',
        newStartTime: '2026-03-17T10:00:00.000Z',
        newEndTime: '2026-03-17T12:00:00.000Z',
        reason: 'CUSTOMER_REQUEST',
        reasonDetails: 'Customer requested morning shift postponement',
      });

      expect(valid.reason).toBe('CUSTOMER_REQUEST');
      expect(valid.newDate).toBe('2026-03-17');

      // Invalid reason should fail
      expect(() =>
        validateAppointmentReschedule({
          companyId: DEMO_COMPANY_A,
          appointmentId: 'apt-001',
          newDate: '2026-03-17',
          newStartTime: '2026-03-17T10:00:00.000Z',
          newEndTime: '2026-03-17T12:00:00.000Z',
          reason: 'LAZY_TECHNICIAN' as any,
        })
      ).toThrow();
    });
  });
});

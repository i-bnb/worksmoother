/**
 * =============================================================================
 * Test Suite 5: Visit Lifecycle, Travel & Check-In State Machine
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ServiceAppointmentService } from '../../src/services/service-appointment.service.js';
import { ServiceVisitService } from '../../src/services/service-visit.service.js';
import {
  validateVisitCheckIn,
  validateVisitCheckOut,
  validateTravelRecordCreate,
} from '../../src/schemas/service-visit.schema.js';

describe('Phase 7: Visit Lifecycle, Travel & Check-In Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('visits').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Appointment State Machine Transitions', () => {
    it('allows valid standard progressive transitions', () => {
      // unscheduled -> scheduled
      expect(ServiceAppointmentService.isValidTransition('unscheduled', 'scheduled')).toBe(true);

      // scheduled -> confirmed -> dispatched -> en_route -> arrived -> in_progress -> completed
      expect(ServiceAppointmentService.isValidTransition('scheduled', 'confirmed')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('confirmed', 'dispatched')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('dispatched', 'en_route')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('en_route', 'arrived')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('arrived', 'in_progress')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('in_progress', 'completed')).toBe(true);
    });

    it('allows pausing and resuming in-progress appointments', () => {
      expect(ServiceAppointmentService.isValidTransition('in_progress', 'paused')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('paused', 'in_progress')).toBe(true);
    });

    it('allows cancellation from non-terminal states', () => {
      expect(ServiceAppointmentService.isValidTransition('unscheduled', 'cancelled')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('scheduled', 'cancelled')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('dispatched', 'cancelled')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('en_route', 'cancelled')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('arrived', 'cancelled')).toBe(true);
    });

    it('allows no-show marking when arrived on site', () => {
      expect(ServiceAppointmentService.isValidTransition('arrived', 'no_show')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('no_show', 'rescheduled')).toBe(true);
    });

    it('prohibits transitions out of terminal completed or cancelled states', () => {
      expect(ServiceAppointmentService.isValidTransition('completed', 'in_progress')).toBe(false);
      expect(ServiceAppointmentService.isValidTransition('completed', 'scheduled')).toBe(false);
      expect(ServiceAppointmentService.isValidTransition('cancelled', 'scheduled')).toBe(false);
      expect(ServiceAppointmentService.isValidTransition('cancelled', 'dispatched')).toBe(false);
    });

    it('prohibits invalid illegal shortcuts across lifecycle', () => {
      // Cannot jump from unscheduled directly to completed
      expect(ServiceAppointmentService.isValidTransition('unscheduled', 'completed')).toBe(false);
      // Cannot jump from unscheduled directly to en_route
      expect(ServiceAppointmentService.isValidTransition('unscheduled', 'en_route')).toBe(false);
    });
  });

  describe('Pure Travel Duration Calculator', () => {
    it('calculates duration in minutes accurately', () => {
      const start = '2026-03-16T08:00:00.000Z';
      const end = '2026-03-16T08:45:00.000Z';
      expect(ServiceVisitService.calculateDurationMinutes(start, end)).toBe(45);
    });

    it('returns 0 for identical start and end timestamps', () => {
      const start = '2026-03-16T08:00:00.000Z';
      expect(ServiceVisitService.calculateDurationMinutes(start, start)).toBe(0);
    });

    it('returns 0 for inverted or negative duration timestamps', () => {
      const start = '2026-03-16T09:00:00.000Z';
      const end = '2026-03-16T08:00:00.000Z';
      expect(ServiceVisitService.calculateDurationMinutes(start, end)).toBe(0);
    });

    it('returns 0 for malformed timestamps without crashing', () => {
      expect(ServiceVisitService.calculateDurationMinutes('invalid-iso', 'also-invalid')).toBe(0);
    });
  });

  describe('Visit DTO Validation Schemas', () => {
    it('validates visit check-in schema with GPS coordinates', () => {
      const valid = validateVisitCheckIn({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        technicianId: 'emp-001',
        latitude: 25.2048,
        longitude: 55.2708,
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.latitude).toBe(25.2048);
      expect(valid.longitude).toBe(55.2708);
    });

    it('validates visit check-out schema with work performed remarks', () => {
      const valid = validateVisitCheckOut({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        technicianId: 'emp-001',
        latitude: 25.2048,
        longitude: 55.2708,
        workPerformed: 'Replaced air filter and charged R410A refrigerant to 120 PSI',
        completionRemarks: 'Unit operational and customer signed off',
      });

      expect(valid.workPerformed).toContain('Replaced air filter');
      expect(valid.completionRemarks).toContain('customer signed off');
    });

    it('validates travel record creation schema', () => {
      const valid = validateTravelRecordCreate({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        technicianId: 'emp-001',
        travelStart: '2026-03-16T08:00:00.000Z',
        originReference: 'Dubai Central Warehouse',
        destinationReference: 'Customer Site - Business Bay Tower 2',
        travelNotes: 'Encountered light morning traffic on E11',
      });

      expect(valid.travelStart).toBe('2026-03-16T08:00:00.000Z');
      expect(valid.originReference).toBe('Dubai Central Warehouse');
    });
  });
});

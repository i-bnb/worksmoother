/**
 * =============================================================================
 * Test Suite 8: Rescheduling Ledger, Parts Readiness & Concurrency Guards
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  PartsReadinessService,
  PartRequirement,
} from '../../src/services/parts-readiness.service.js';
import { validateAppointmentReschedule } from '../../src/schemas/service-appointment.schema.js';
import { SchedulingEngineService, TimeSlot } from '../../src/services/scheduling-engine.service.js';

describe('Phase 7: Rescheduling Ledger, Parts Readiness & Concurrency Guards', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('appointment_history').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Parts Readiness Evaluation Engine', () => {
    it('returns NOT_REQUIRED when work order has no parts required', () => {
      const result = PartsReadinessService.evaluateReadiness([], {});

      expect(result.status).toBe('NOT_REQUIRED');
      expect(result.totalRequiredParts).toBe(0);
      expect(result.availablePartsCount).toBe(0);
      expect(result.missingParts).toHaveLength(0);
    });

    it('returns READY when all required parts are available in stock in sufficient quantity', () => {
      const requirements: PartRequirement[] = [
        { itemCode: 'FLTR-HEPA-01', itemName: 'HEPA Filter', quantityRequired: 2 },
        { itemCode: 'BELT-V-340', itemName: 'Fan V-Belt', quantityRequired: 1 },
      ];

      const stockBalances: Record<string, number> = {
        'FLTR-HEPA-01': 10,
        'BELT-V-340': 5,
      };

      const result = PartsReadinessService.evaluateReadiness(requirements, stockBalances);

      expect(result.status).toBe('READY');
      expect(result.totalRequiredParts).toBe(2);
      expect(result.availablePartsCount).toBe(2);
      expect(result.missingParts).toHaveLength(0);
    });

    it('returns PARTIAL when only a subset of required parts are available in stock', () => {
      const requirements: PartRequirement[] = [
        { itemCode: 'FLTR-HEPA-01', itemName: 'HEPA Filter', quantityRequired: 2 },
        { itemCode: 'PCB-MAIN-CONTROL', itemName: 'Main Control Board', quantityRequired: 1 },
      ];

      const stockBalances: Record<string, number> = {
        'FLTR-HEPA-01': 5,
        'PCB-MAIN-CONTROL': 0, // Missing
      };

      const result = PartsReadinessService.evaluateReadiness(requirements, stockBalances);

      expect(result.status).toBe('PARTIAL');
      expect(result.totalRequiredParts).toBe(2);
      expect(result.availablePartsCount).toBe(1);
      expect(result.missingParts).toHaveLength(1);
      expect(result.missingParts[0].itemCode).toBe('PCB-MAIN-CONTROL');
      expect(result.missingParts[0].quantityRequired).toBe(1);
      expect(result.missingParts[0].quantityAvailable).toBe(0);
    });

    it('returns NOT_READY when none of the required parts are in stock', () => {
      const requirements: PartRequirement[] = [
        { itemCode: 'COMPRESSOR-SCROLL-5T', itemName: 'Scroll Compressor 5T', quantityRequired: 1 },
      ];

      const stockBalances: Record<string, number> = {
        'COMPRESSOR-SCROLL-5T': 0,
      };

      const result = PartsReadinessService.evaluateReadiness(requirements, stockBalances);

      expect(result.status).toBe('NOT_READY');
      expect(result.totalRequiredParts).toBe(1);
      expect(result.availablePartsCount).toBe(0);
      expect(result.missingParts).toHaveLength(1);
    });

    it('treats partially available quantity as insufficient for that line', () => {
      const requirements: PartRequirement[] = [
        { itemCode: 'FREON-R410A-KG', itemName: 'R410A Refrigerant (kg)', quantityRequired: 5 },
      ];

      const stockBalances: Record<string, number> = {
        'FREON-R410A-KG': 3, // Only 3 available, 5 required
      };

      const result = PartsReadinessService.evaluateReadiness(requirements, stockBalances);

      expect(result.status).toBe('NOT_READY');
      expect(result.missingParts[0].quantityRequired).toBe(5);
      expect(result.missingParts[0].quantityAvailable).toBe(3);
    });
  });

  describe('Rescheduling Ledger & Reasons Validation', () => {
    it('validates appointment rescheduling with reason and details', () => {
      const valid = validateAppointmentReschedule({
        companyId: DEMO_COMPANY_A,
        appointmentId: 'apt-001',
        newDate: '2026-03-20',
        newStartTime: '2026-03-20T09:00:00.000Z',
        newEndTime: '2026-03-20T11:00:00.000Z',
        reason: 'PART_NOT_AVAILABLE',
        reasonDetails: 'Awaiting arrival of replacement PCB board from manufacturer',
      });

      expect(valid.reason).toBe('PART_NOT_AVAILABLE');
      expect(valid.reasonDetails).toContain('Awaiting arrival');
      expect(valid.newDate).toBe('2026-03-20');
    });

    it('ensures all standard ERP rescheduling reasons are recognized', () => {
      const permittedReasons = [
        'CUSTOMER_REQUEST',
        'TECHNICIAN_UNAVAILABLE',
        'PART_NOT_AVAILABLE',
        'WEATHER',
        'EMERGENCY',
        'SLA_REASSIGNMENT',
        'OTHER',
      ];

      for (const r of permittedReasons) {
        const res = validateAppointmentReschedule({
          companyId: DEMO_COMPANY_A,
          appointmentId: 'apt-001',
          newDate: '2026-03-20',
          newStartTime: '2026-03-20T09:00:00.000Z',
          newEndTime: '2026-03-20T11:00:00.000Z',
          reason: r as any,
        });
        expect(res.reason).toBe(r);
      }
    });
  });

  describe('Concurrency & Double-Booking Protection', () => {
    it('prevents double-booking two concurrent appointments for the same technician in the same slot', () => {
      const existing: TimeSlot[] = [
        {
          id: 'appt-already-booked',
          startTime: '2026-03-20T10:00:00.000Z',
          endTime: '2026-03-20T12:00:00.000Z',
          travelBufferMinutes: 30,
        },
      ];

      // Concurrent second booking attempt
      const attempt = SchedulingEngineService.checkAppointmentConflicts(existing, {
        startTime: '2026-03-20T11:00:00.000Z', // Collides with 10:00-12:00
        endTime: '2026-03-20T13:00:00.000Z',
        travelBufferMinutes: 30,
      });

      expect(attempt.hasConflict).toBe(true);
      expect(attempt.conflictType).toBe('overlap');
      expect(attempt.conflictingAppointmentId).toBe('appt-already-booked');
    });
  });

  describe('Live Database Appointment History', () => {
    it('queries appointment history table if live DB is available', async () => {
      if (!isLiveDb) return;

      const { data: history } = await admin
        .from('appointment_history')
        .select('id, appointment_id, reschedule_reason, created_at')
        .limit(1);

      expect(Array.isArray(history)).toBe(true);
    });
  });
});

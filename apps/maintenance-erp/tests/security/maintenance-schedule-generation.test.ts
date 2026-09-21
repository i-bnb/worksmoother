/**
 * =============================================================================
 * Test Suite 4: Maintenance Schedule Generation & Idempotency
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { MaintenanceScheduleService } from '../../src/services/maintenance-schedule.service.js';
import { validateMaintenanceScheduleCreate } from '../../src/schemas/maintenance-schedule.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 4: Maintenance Schedule Generation & Idempotency', () => {
  describe('Schedule Schema Validation', () => {
    it('accepts valid schedule creation payload', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        contractId: '11111111-1111-1111-1111-111111111111',
        customerAssetId: '22222222-2222-2222-2222-222222222222',
        scheduledDate: '2026-07-01',
        periodLabel: 'Visit-02 (Jul 2026)',
        scheduleType: 'preventive' as const,
        priority: 'medium' as const,
      };

      const validated = validateMaintenanceScheduleCreate(payload);
      expect(validated.scheduledDate).toBe('2026-07-01');
      expect(validated.periodLabel).toBe('Visit-02 (Jul 2026)');
      expect(validated.scheduleType).toBe('preventive');
    });

    it('rejects schedule with invalid priority or missing date', () => {
      expect(() =>
        validateMaintenanceScheduleCreate({
          companyId: DEMO_COMPANY_A,
          contractId: '11111111-1111-1111-1111-111111111111',
          scheduledDate: '',
          periodLabel: 'Visit-01',
        })
      ).toThrow(/scheduledDate is required/i);

      expect(() =>
        validateMaintenanceScheduleCreate({
          companyId: DEMO_COMPANY_A,
          contractId: '11111111-1111-1111-1111-111111111111',
          scheduledDate: '2026-07-01',
          periodLabel: 'Visit-01',
          priority: 'nuclear_emergency' as any,
        })
      ).toThrow(/priority must be one of/i);
    });
  });

  describe('Recurring Schedule Calculation (Pure Logic)', () => {
    const startDate = '2026-04-01';
    const endDate = '2027-03-31';

    it('calculates quarterly occurrences (4 visits evenly spaced)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(startDate, endDate, 'quarterly');

      expect(occurrences.length).toBe(4);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
      expect(occurrences[1].scheduledDate).toBe('2026-07-01');
      expect(occurrences[2].scheduledDate).toBe('2026-10-01');
      expect(occurrences[3].scheduledDate).toBe('2027-01-01');

      expect(occurrences[0].periodLabel).toContain('Visit-01');
      expect(occurrences[3].periodLabel).toContain('Visit-04');
    });

    it('calculates monthly occurrences (12 visits)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(startDate, endDate, 'monthly');
      expect(occurrences.length).toBe(12);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
      expect(occurrences[11].scheduledDate).toBe('2027-03-01');
    });

    it('calculates bi-monthly occurrences (6 visits)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(startDate, endDate, 'bi_monthly');
      expect(occurrences.length).toBe(6);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
      expect(occurrences[1].scheduledDate).toBe('2026-06-01');
    });

    it('calculates semi-annual occurrences (2 visits)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(startDate, endDate, 'semi_annual');
      expect(occurrences.length).toBe(2);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
      expect(occurrences[1].scheduledDate).toBe('2026-10-01');
    });

    it('calculates annual occurrences (1 visit)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(startDate, endDate, 'annual');
      expect(occurrences.length).toBe(1);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
    });

    it('calculates custom day interval occurrences (e.g. every 60 days)', () => {
      const occurrences = MaintenanceScheduleService.calculateRecurringDates(
        startDate,
        endDate,
        'custom',
        60
      );
      // In 365 days, every 60 days gives 7 occurrences (day 0, 60, 120, 180, 240, 300, 360)
      expect(occurrences.length).toBe(7);
      expect(occurrences[0].scheduledDate).toBe('2026-04-01');
      expect(occurrences[1].scheduledDate).toBe('2026-05-31');
    });
  });
});

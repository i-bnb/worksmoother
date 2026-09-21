/**
 * =============================================================================
 * Test Suite 6: Contract Renewal & SLA Business Hours Engine
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { validateContractRenewal } from '../../src/schemas/contract-billing.schema.js';
import { SlaService, ServiceCalendar } from '../../src/services/sla.service.js';
import { Decimal } from '../../src/lib/decimal.js';

describe('Phase 4: Contract Renewal & SLA Business Hours Engine', () => {
  describe('Renewal Schema Validation', () => {
    it('accepts valid renewal options', () => {
      const r = validateContractRenewal({ priceAdjustmentPercent: 5 });
      expect(r.priceAdjustmentPercent).toBe(5);
    });

    it('rejects non-numeric priceAdjustmentPercent', () => {
      expect(() => validateContractRenewal({ priceAdjustmentPercent: 'five' as any })).toThrow(
        /must be a number/i
      );
    });
  });

  describe('Contract Renewal Price Calculation (Pure Logic)', () => {
    it('applies positive price adjustment percentage on renewal', () => {
      const oldVal = new Decimal(100000);
      const adjustmentPct = 10; // +10%
      const multiplier = new Decimal(1).plus(new Decimal(adjustmentPct).dividedBy(100));
      const newVal = oldVal.times(multiplier).round(3);

      expect(newVal.toNumber()).toBe(110000);
    });

    it('applies negative discount adjustment percentage on renewal', () => {
      const oldVal = new Decimal(50000);
      const adjustmentPct = -5; // -5%
      const multiplier = new Decimal(1).plus(new Decimal(adjustmentPct).dividedBy(100));
      const newVal = oldVal.times(multiplier).round(3);

      expect(newVal.toNumber()).toBe(47500);
    });
  });

  describe('SLA Business Hours Engine (Pure Logic)', () => {
    // Standard service window: Mon-Sat, 09:00 - 18:00 (9 hrs/day). Sunday closed.
    const customCalendar: ServiceCalendar = {
      workingDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
      windowStartHour: 9,
      windowEndHour: 18,
      holidays: ['2026-08-15'], // Indian Independence Day
      is24x7: false,
    };

    it('calculates deadline within the same business day', () => {
      // Wednesday, 2026-05-13 10:00 UTC + 4 hours SLA -> Wednesday 14:00 UTC
      const start = new Date('2026-05-13T10:00:00Z');
      const deadline = SlaService.calculateDeadline(start, 4, customCalendar);

      expect(deadline.toISOString()).toBe('2026-05-13T14:00:00.000Z');
    });

    it('advances deadline across overnight window to the next working day', () => {
      // Wednesday, 2026-05-13 16:00 UTC + 4 hours SLA
      // 16:00 to 18:00 = 2 hrs on Wed. Remaining 2 hrs start Thu 09:00 -> Thu 11:00 UTC
      const start = new Date('2026-05-13T16:00:00Z');
      const deadline = SlaService.calculateDeadline(start, 4, customCalendar);

      expect(deadline.toISOString()).toBe('2026-05-14T11:00:00.000Z');
    });

    it('skips non-working days (Sunday) when calculating deadline', () => {
      // Saturday, 2026-05-16 16:00 UTC + 4 hours SLA
      // Sat 16:00 to 18:00 = 2 hrs. Sun 2026-05-17 is closed.
      // Remaining 2 hrs resume Mon 2026-05-18 09:00 -> Mon 11:00 UTC
      const start = new Date('2026-05-16T16:00:00Z');
      const deadline = SlaService.calculateDeadline(start, 4, customCalendar);

      expect(deadline.toISOString()).toBe('2026-05-18T11:00:00.000Z');
    });

    it('snaps off-hours submission to the start of the next business window', () => {
      // Sunday, 2026-05-17 14:00 UTC (off-hours).
      // Snaps to Monday 2026-05-18 09:00 UTC + 4 hours = Mon 13:00 UTC
      const start = new Date('2026-05-17T14:00:00Z');
      const deadline = SlaService.calculateDeadline(start, 4, customCalendar);

      expect(deadline.toISOString()).toBe('2026-05-18T13:00:00.000Z');
    });

    it('calculates 24x7 emergency calendar deadline directly without window cutoff', () => {
      const emergencyCalendar: ServiceCalendar = {
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        windowStartHour: 0,
        windowEndHour: 24,
        is24x7: true,
      };

      // Sunday 14:00 UTC + 2 hours emergency response -> Sunday 16:00 UTC
      const start = new Date('2026-05-17T14:00:00Z');
      const deadline = SlaService.calculateDeadline(start, 2, emergencyCalendar);

      expect(deadline.toISOString()).toBe('2026-05-17T16:00:00.000Z');
    });

    it('evaluates SLA breach status correctly', () => {
      const deadline = new Date('2026-05-13T14:00:00Z');

      // Completed on time
      expect(SlaService.isSlaBreached(deadline, new Date('2026-05-13T13:30:00Z'))).toBe(false);

      // Completed late (breached)
      expect(SlaService.isSlaBreached(deadline, new Date('2026-05-13T14:05:00Z'))).toBe(true);
    });
  });
});

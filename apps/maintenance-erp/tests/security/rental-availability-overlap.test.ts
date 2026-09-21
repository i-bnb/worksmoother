/**
 * =============================================================================
 * Test Suite 1: Rental Asset Availability & Overlap Calculation Engine
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { RentalAvailabilityService } from '../../src/services/rental-availability.service.js';

describe('Phase 5: Rental Availability & Overlap Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('rental_assets').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Overlap Calculation with Turnaround Buffer', () => {
    it('detects direct overlapping date intervals', () => {
      const rangeA = { start: '2026-05-01', end: '2026-05-10' };
      const rangeB = { start: '2026-05-05', end: '2026-05-15' };
      expect(RentalAvailabilityService.checkOverlap(rangeA, rangeB, 0)).toBe(true);
    });

    it('detects disjoint date intervals without buffer as non-overlapping', () => {
      const rangeA = { start: '2026-05-01', end: '2026-05-05' };
      const rangeB = { start: '2026-05-06', end: '2026-05-10' };
      expect(RentalAvailabilityService.checkOverlap(rangeA, rangeB, 0)).toBe(false);
    });

    it('enforces turnaround buffer days (adjacent days overlap when buffer >= 1)', () => {
      const rangeA = { start: '2026-05-01', end: '2026-05-05' };
      const rangeB = { start: '2026-05-06', end: '2026-05-10' };
      // With 1 day turnaround buffer, rangeB starts within 1 day of rangeA ending -> overlap!
      expect(RentalAvailabilityService.checkOverlap(rangeA, rangeB, 1)).toBe(true);
      // Beyond buffer: May 7 starts 2 days after May 5 -> non-overlapping even with 1 day buffer
      const rangeC = { start: '2026-05-07', end: '2026-05-12' };
      expect(RentalAvailabilityService.checkOverlap(rangeA, rangeC, 1)).toBe(false);
    });

    it('rejects assets currently in maintenance, damaged, retired, or lost statuses', () => {
      const statuses = ['maintenance', 'damaged', 'retired', 'lost'];
      for (const st of statuses) {
        const result = RentalAvailabilityService.evaluateAvailability(
          { id: 'ast-1', rentalStatus: st },
          [],
          { start: '2026-06-01', end: '2026-06-10' }
        );
        expect(result.isAvailable).toBe(false);
        expect(result.reason).toMatch(/non-rentable status/i);
      }
    });

    it('confirms availability when no reservations conflict', () => {
      const result = RentalAvailabilityService.evaluateAvailability(
        { id: 'ast-1', rentalStatus: 'available', turnaroundBufferDays: 1 },
        [
          {
            startDate: '2026-06-15',
            endDate: '2026-06-20',
            status: 'confirmed',
          },
        ],
        { start: '2026-06-01', end: '2026-06-10' }
      );
      expect(result.isAvailable).toBe(true);
    });

    it('rejects availability when a confirmed reservation overlaps within buffer window', () => {
      const result = RentalAvailabilityService.evaluateAvailability(
        { id: 'ast-1', rentalStatus: 'available', turnaroundBufferDays: 1 },
        [
          {
            startDate: '2026-06-10',
            endDate: '2026-06-20',
            status: 'confirmed',
          },
        ],
        { start: '2026-06-01', end: '2026-06-10' }
      );
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toMatch(/conflicting confirmed reservation/i);
    });
  });

  describe('Live Database Availability RPC', () => {
    it('executes check_rental_asset_availability RPC cleanly when DB is online', async () => {
      if (!isLiveDb) {
        expect(true).toBe(true);
        return;
      }

      // Check against any asset in company A
      const { data: asset } = await admin
        .from('rental_assets')
        .select('id')
        .eq('company_id', DEMO_COMPANY_A)
        .limit(1)
        .maybeSingle();

      if (asset) {
        const res = await RentalAvailabilityService.checkAvailabilityLive(
          admin,
          asset.id,
          '2026-10-01',
          '2026-10-15',
          1
        );
        expect(res.assetId).toBe(asset.id);
        expect(typeof res.isAvailable).toBe('boolean');
      }
    });
  });
});

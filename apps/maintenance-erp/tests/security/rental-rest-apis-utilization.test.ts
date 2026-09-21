/**
 * =============================================================================
 * Test Suite 7: Rental REST API Controllers & Fleet Utilization Metrics
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient } from './helpers.js';
import { RentalAssetsApiController } from '../../src/api/rental-assets.js';
import { RentalContractsApiController } from '../../src/api/rental-contracts.js';
import { RentalOperationsApiController } from '../../src/api/rental-operations.js';
import { RentalReportingService } from '../../src/services/rental-reporting.service.js';

describe('Phase 5: Rental REST APIs & Fleet Utilization Reporting', () => {
  const admin = getAdminClient();

  describe('REST API Controller Validations', () => {
    it('RentalAssetsApiController.createAsset returns 400 on invalid payload', async () => {
      const res = await RentalAssetsApiController.createAsset(admin, {
        body: { dailyRate: -50 }, // missing companyId, assetCode, name; negative dailyRate
      });

      expect(res.status).toBe(400);
      expect(res.error).toBeDefined();
    });

    it('RentalAssetsApiController.checkAvailability returns 400 when dates are missing', async () => {
      const res = await RentalAssetsApiController.checkAvailability(admin, {
        params: { id: 'ast-1' },
        query: {}, // missing startDate & endDate
      });

      expect(res.status).toBe(400);
      expect(res.error).toMatch(/startDate and endDate are required/i);
    });

    it('RentalContractsApiController.createContract returns 400 when lines are missing', async () => {
      const res = await RentalContractsApiController.createContract(admin, {
        body: {
          companyId: '11111111-1111-1111-1111-111111111111',
          customerId: '22222222-2222-2222-2222-222222222222',
          startDate: '2026-06-01',
          expectedReturnDate: '2026-06-15',
          lines: [],
        },
      });

      expect(res.status).toBe(400);
      expect(res.error).toMatch(/must have at least one line/i);
    });

    it('RentalOperationsApiController.dispatchAsset returns 400 on missing contractId', async () => {
      const res = await RentalOperationsApiController.dispatchAsset(admin, {
        body: {
          assetId: 'ast-1',
          meterReading: 100,
        },
      });

      expect(res.status).toBe(400);
      expect(res.error).toMatch(/contractId is required/i);
    });

    it('RentalOperationsApiController.returnAsset returns 400 on negative meterReading', async () => {
      const res = await RentalOperationsApiController.returnAsset(admin, {
        body: {
          contractId: 'c-1',
          assetId: 'ast-1',
          meterReading: -5,
        },
      });

      expect(res.status).toBe(400);
      expect(res.error).toMatch(/meterReading must be a non-negative number/i);
    });
  });

  describe('Fleet Utilization Rate Calculation', () => {
    it('computes exact fleet utilization percentage', () => {
      // 10 fleet assets in a 30-day period = 300 fleet days
      // 150 total rented days across the fleet
      // Utilization = (150 / 300) * 100 = 50.00%
      const util = RentalReportingService.computeUtilizationRate(10, 30, 150);
      expect(util).toBe(50.0);

      // 80 rented days out of 200 fleet days = 40.00%
      const util2 = RentalReportingService.computeUtilizationRate(5, 40, 80);
      expect(util2).toBe(40.0);
    });

    it('handles edge cases (zero assets or zero period days) gracefully without NaN', () => {
      expect(RentalReportingService.computeUtilizationRate(0, 30, 0)).toBe(0);
      expect(RentalReportingService.computeUtilizationRate(10, 0, 0)).toBe(0);
    });
  });
});

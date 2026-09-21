/**
 * =============================================================================
 * Test Suite 3: Rental Handover (Dispatch) & Return Calculations
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { RentalHandoverService } from '../../src/services/rental-handover.service.js';
import {
  validateRentalDispatch,
  validateRentalReturn,
} from '../../src/schemas/rental-operation.schema.js';

describe('Phase 5: Handover (Dispatch) & Return Calculations', () => {
  describe('Dispatch Validation', () => {
    it('accepts valid dispatch payload', () => {
      const payload = {
        contractId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        meterReading: 120.5,
        condition: 'good',
        carrierInfo: { driverName: 'Hassan', vehicleNo: 'DXB-54321' },
      };

      const validated = validateRentalDispatch(payload);
      expect(validated.contractId).toBe(payload.contractId);
      expect(validated.meterReading).toBe(120.5);
    });

    it('rejects dispatch with negative meter reading', () => {
      expect(() =>
        validateRentalDispatch({
          contractId: 'c-1',
          assetId: 'a-1',
          meterReading: -10,
        })
      ).toThrow(/meterReading must be a non-negative number/i);
    });
  });

  describe('Return Charges Calculation Engine', () => {
    it('calculates zero extra charges for on-time, within-meter, clean return', () => {
      const charges = RentalHandoverService.calculateReturnCharges({
        startDate: '2026-05-01',
        expectedReturnDate: '2026-05-06',
        actualReturnDate: '2026-05-06',
        dispatchMeter: 100.0,
        returnMeter: 130.0, // 30 units used
        dailyRate: 150.0,
        meterRatePerUnit: 20.0,
        includedUnitsPerDay: 8.0, // 5 days * 8 = 40 units allowed
        cleaningRequired: false,
        damageCharge: 0,
      });

      expect(charges.meterDifference).toBe(30.0);
      expect(charges.allowedUnits).toBe(40.0);
      expect(charges.excessUnits).toBe(0.0);
      expect(charges.excessMeterCharge).toBe(0.0);
      expect(charges.extraDays).toBe(0);
      expect(charges.extraDayCharge).toBe(0.0);
      expect(charges.cleaningCharge).toBe(0.0);
      expect(charges.totalExtraCharges).toBe(0.0);
    });

    it('calculates excess meter surcharge when usage exceeds included allowance', () => {
      const charges = RentalHandoverService.calculateReturnCharges({
        startDate: '2026-05-01',
        expectedReturnDate: '2026-05-06',
        actualReturnDate: '2026-05-06',
        dispatchMeter: 100.0,
        returnMeter: 165.0, // 65 units used
        dailyRate: 150.0,
        meterRatePerUnit: 25.0,
        includedUnitsPerDay: 8.0, // 5 days * 8 = 40 units allowed
        cleaningRequired: false,
        damageCharge: 0,
      });

      // 65 units used - 40 allowed = 25 excess units * 25/unit = 625.0
      expect(charges.meterDifference).toBe(65.0);
      expect(charges.excessUnits).toBe(25.0);
      expect(charges.excessMeterCharge).toBe(625.0);
      expect(charges.totalExtraCharges).toBe(625.0);
    });

    it('calculates overdue extra days and cleaning charges accurately', () => {
      const charges = RentalHandoverService.calculateReturnCharges({
        startDate: '2026-05-01',
        expectedReturnDate: '2026-05-05',
        actualReturnDate: '2026-05-08', // 3 days overdue
        dispatchMeter: 200.0,
        returnMeter: 240.0,
        dailyRate: 100.0,
        meterRatePerUnit: 15.0,
        includedUnitsPerDay: 10.0,
        cleaningRequired: true,
        cleaningCharge: 75.0,
        damageCharge: 200.0,
      });

      expect(charges.extraDays).toBe(3);
      expect(charges.extraDayCharge).toBe(300.0); // 3 * 100
      expect(charges.cleaningCharge).toBe(75.0);
      expect(charges.damageCharge).toBe(200.0);
      expect(charges.totalExtraCharges).toBe(575.0); // 300 + 75 + 200
    });
  });
});

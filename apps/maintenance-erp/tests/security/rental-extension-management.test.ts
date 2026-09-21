/**
 * =============================================================================
 * Test Suite 4: Rental Duration Extensions & Amendment Management
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { RentalExtensionService } from '../../src/services/rental-extension.service.js';
import { validateRentalExtensionRequest } from '../../src/schemas/rental-operation.schema.js';

describe('Phase 5: Rental Duration Extensions & Amendments', () => {
  describe('Extension Schema Validations', () => {
    it('accepts valid extension request payload', () => {
      const payload = {
        contractId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        extendedEndDate: '2026-06-25',
        notes: 'Project delayed due to rain, extending 10 days',
      };

      const validated = validateRentalExtensionRequest(payload);
      expect(validated.contractId).toBe(payload.contractId);
      expect(validated.extendedEndDate).toBe('2026-06-25');
      expect(validated.notes).toBe(payload.notes);
    });

    it('rejects extension with invalid date format', () => {
      expect(() =>
        validateRentalExtensionRequest({
          contractId: 'c-1',
          extendedEndDate: '25-06-2026',
        })
      ).toThrow(/extendedEndDate is required and must be in YYYY-MM-DD format/i);
    });

    it('rejects extension missing contractId', () => {
      expect(() =>
        validateRentalExtensionRequest({
          extendedEndDate: '2026-06-25',
        })
      ).toThrow(/contractId is required/i);
    });
  });

  describe('Extension Rate Calculation Engine (Decimal Precision)', () => {
    it('calculates extension charge and tax accurately without floating-point drift', () => {
      // 7 days @ 125.50/day, 5% tax
      // Charge = 7 * 125.50 = 878.50
      // Tax = 878.50 * 0.05 = 43.925
      // Total = 922.425
      const calc = RentalExtensionService.calculateExtensionCharge(7, 125.5, 5.0);

      expect(calc.additionalDays).toBe(7);
      expect(calc.additionalCharge).toBe(878.5);
      expect(calc.taxAmount).toBe(43.925);
      expect(calc.totalAmount).toBe(922.425);
    });

    it('rejects extension charge calculation with non-positive additional days', () => {
      expect(() => RentalExtensionService.calculateExtensionCharge(0, 100)).toThrow(
        /additionalDays must be strictly positive/i
      );
      expect(() => RentalExtensionService.calculateExtensionCharge(-5, 100)).toThrow(
        /additionalDays must be strictly positive/i
      );
    });
  });
});

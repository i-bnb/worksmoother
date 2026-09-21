/**
 * =============================================================================
 * Test Suite 5: Rental Damage Assessment & Repair Work Order Integration
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { validateRentalDamageAssessment } from '../../src/schemas/rental-operation.schema.js';
import { RentalAssetService } from '../../src/services/rental-asset.service.js';

describe('Phase 5: Damage Assessment & Repair Integration', () => {
  describe('Damage Assessment Schema Validation', () => {
    it('accepts valid damage assessment payload', () => {
      const payload = {
        contractId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        returnId: 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
        damageType: 'mechanical' as const,
        severity: 'severe' as const,
        description: 'Engine seized due to contaminated fuel supplied by customer',
        photos: ['https://storage.example.com/photos/damage1.jpg'],
        estimatedCost: 3200.0,
        customerResponsibility: 'full' as const,
        approvedCharge: 3200.0,
        spawnWorkOrder: true,
      };

      const validated = validateRentalDamageAssessment(payload);
      expect(validated.damageType).toBe('mechanical');
      expect(validated.severity).toBe('severe');
      expect(validated.estimatedCost).toBe(3200.0);
      expect(validated.spawnWorkOrder).toBe(true);
    });

    it('rejects damage assessment with invalid damageType', () => {
      expect(() =>
        validateRentalDamageAssessment({
          contractId: 'c-1',
          assetId: 'a-1',
          returnId: 'r-1',
          damageType: 'alien_abduction',
          severity: 'minor',
          description: 'Broken panel',
        })
      ).toThrow(/damageType must be one of/i);
    });

    it('rejects damage assessment with invalid severity', () => {
      expect(() =>
        validateRentalDamageAssessment({
          contractId: 'c-1',
          assetId: 'a-1',
          returnId: 'r-1',
          damageType: 'structural',
          severity: 'catastrophic_unknown',
          description: 'Frame bent',
        })
      ).toThrow(/severity must be one of/i);
    });

    it('rejects damage assessment missing description', () => {
      expect(() =>
        validateRentalDamageAssessment({
          contractId: 'c-1',
          assetId: 'a-1',
          returnId: 'r-1',
          damageType: 'electrical',
          severity: 'minor',
        })
      ).toThrow(/description is required/i);
    });
  });

  describe('Asset Status Progression on Damage', () => {
    it('allows transition from returned -> under_inspection -> damaged -> maintenance', () => {
      expect(RentalAssetService.validateStatusTransition('returned', 'under_inspection')).toBe(true);
      expect(RentalAssetService.validateStatusTransition('under_inspection', 'damaged')).toBe(true);
      expect(RentalAssetService.validateStatusTransition('damaged', 'maintenance')).toBe(true);
      expect(RentalAssetService.validateStatusTransition('maintenance', 'available')).toBe(true);
    });

    it('detects when an asset requires preventive maintenance by meter threshold', () => {
      const assetNeedingService = {
        meterReading: 520.0,
        lastMaintenanceMeter: 250.0,
        maintenanceIntervalUnits: 250.0, // 520 - 250 = 270 >= 250 -> needs maintenance!
      };
      expect(RentalAssetService.needsMaintenance(assetNeedingService)).toBe(true);

      const assetHealthy = {
        meterReading: 310.0,
        lastMaintenanceMeter: 250.0,
        maintenanceIntervalUnits: 250.0, // 310 - 250 = 60 < 250 -> good!
      };
      expect(RentalAssetService.needsMaintenance(assetHealthy)).toBe(false);
    });
  });
});

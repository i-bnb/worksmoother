/**
 * =============================================================================
 * Test Suite 2: Contract Assets & Coverage Evaluation Engine
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateContractAssetAdd } from '../../src/schemas/contract.schema.js';
import { ContractCoverageService } from '../../src/services/contract-coverage.service.js';
import { ContractAssetService } from '../../src/services/contract-asset.service.js';

describe('Phase 4: Contract Assets & Coverage Evaluation Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('amc_contract_assets').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Contract Asset Schema Validation', () => {
    it('accepts valid asset addition payload', () => {
      const payload = {
        contractId: '11111111-1111-1111-1111-111111111111',
        customerAssetId: '22222222-2222-2222-2222-222222222222',
        coverageType: 'parts_and_labor' as const,
        assetPrice: 15000,
        visitFrequency: 'quarterly',
      };

      const validated = validateContractAssetAdd(payload);
      expect(validated.contractId).toBe('11111111-1111-1111-1111-111111111111');
      expect(validated.coverageType).toBe('parts_and_labor');
      expect(validated.assetPrice).toBe(15000);
    });

    it('rejects asset addition with invalid coverageType', () => {
      expect(() =>
        validateContractAssetAdd({
          contractId: '11111111-1111-1111-1111-111111111111',
          customerAssetId: '22222222-2222-2222-2222-222222222222',
          coverageType: 'free_for_life' as any,
        })
      ).toThrow(/coverageType must be one of/i);
    });
  });

  describe('Coverage Evaluation Engine (Pure Logic)', () => {
    it('evaluates FULL_SERVICE coverage (parts and labor both covered)', () => {
      const partRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'part',
        isScheduledPreventive: false,
        coverageType: 'full_service',
        amount: 3500,
      });
      expect(partRes.coverageStatus).toBe('covered');
      expect(partRes.coveredAmount).toBe(3500);
      expect(partRes.billableAmount).toBe(0);

      const laborRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'labor',
        isScheduledPreventive: false,
        coverageType: 'full_service',
        amount: 1200,
      });
      expect(laborRes.coverageStatus).toBe('covered');
      expect(laborRes.coveredAmount).toBe(1200);
      expect(laborRes.billableAmount).toBe(0);
    });

    it('evaluates PARTS_ONLY coverage (parts covered, labor billable)', () => {
      const partRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'part',
        isScheduledPreventive: false,
        coverageType: 'parts_only',
        amount: 4000,
      });
      expect(partRes.coverageStatus).toBe('covered');
      expect(partRes.billableAmount).toBe(0);

      const laborRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'labor',
        isScheduledPreventive: false,
        coverageType: 'parts_only',
        amount: 1500,
      });
      expect(laborRes.coverageStatus).toBe('billable');
      expect(laborRes.coveredAmount).toBe(0);
      expect(laborRes.billableAmount).toBe(1500);
    });

    it('evaluates LABOR_ONLY coverage (labor covered, parts billable)', () => {
      const partRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'part',
        isScheduledPreventive: false,
        coverageType: 'labor_only',
        amount: 8000,
      });
      expect(partRes.coverageStatus).toBe('billable');
      expect(partRes.coveredAmount).toBe(0);
      expect(partRes.billableAmount).toBe(8000);

      const laborRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'labor',
        isScheduledPreventive: false,
        coverageType: 'labor_only',
        amount: 2500,
      });
      expect(laborRes.coverageStatus).toBe('covered');
      expect(laborRes.coveredAmount).toBe(2500);
      expect(laborRes.billableAmount).toBe(0);
    });

    it('evaluates PREVENTIVE_ONLY coverage (routine covered, breakdown billable)', () => {
      const routineRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'service',
        isScheduledPreventive: true,
        coverageType: 'preventive_only',
        amount: 2000,
      });
      expect(routineRes.coverageStatus).toBe('covered');

      const breakdownRes = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'service',
        isScheduledPreventive: false,
        coverageType: 'preventive_only',
        amount: 5000,
      });
      expect(breakdownRes.coverageStatus).toBe('billable');
      expect(breakdownRes.billableAmount).toBe(5000);
    });

    it('calculates partial coverage when amount exceeds available allowance', () => {
      // 5,000 INR part, but only 3,000 INR remaining in parts allowance
      const res = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'part',
        isScheduledPreventive: false,
        coverageType: 'full_service',
        amount: 5000,
        availableEntitlement: 3000,
      });

      expect(res.coverageStatus).toBe('partially_covered');
      expect(res.coveredAmount).toBe(3000);
      expect(res.billableAmount).toBe(2000);
    });

    it('converts to 100% billable when allowance is completely exhausted', () => {
      const res = ContractCoverageService.evaluateLineItemCoverage({
        lineType: 'part',
        isScheduledPreventive: false,
        coverageType: 'full_service',
        amount: 1500,
        availableEntitlement: 0,
      });

      expect(res.coverageStatus).toBe('billable');
      expect(res.coveredAmount).toBe(0);
      expect(res.billableAmount).toBe(1500);
    });
  });

  describe('Live DB Asset Maintenance History Integration', () => {
    it('retrieves asset maintenance history if DB is live', async () => {
      if (!isLiveDb) return;

      const dummyAssetId = '00000000-0000-0000-0000-000000000001';
      const history = await ContractAssetService.getAssetMaintenanceHistory(admin, dummyAssetId);
      expect(history).toHaveProperty('coveredContracts');
      expect(history).toHaveProperty('workOrders');
      expect(history).toHaveProperty('partsReplaced');
    });
  });
});

/**
 * =============================================================================
 * Test Suite 3: Contract Entitlements & Utilization Balance Engine
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateContractEntitlementCreate } from '../../src/schemas/contract.schema.js';
import { ContractEntitlementService } from '../../src/services/contract-entitlement.service.js';

describe('Phase 4: Contract Entitlements & Utilization Balance Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('contract_entitlements').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Entitlement Schema Validation', () => {
    it('accepts valid entitlement configuration', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        contractId: '11111111-1111-1111-1111-111111111111',
        entitlementType: 'preventive_visits' as const,
        totalEntitled: 12,
        limitAction: 'convert_to_billable' as const,
      };

      const validated = validateContractEntitlementCreate(payload);
      expect(validated.entitlementType).toBe('preventive_visits');
      expect(validated.totalEntitled).toBe(12);
      expect(validated.unit).toBe('visits');
    });

    it('rejects invalid entitlement type', () => {
      expect(() =>
        validateContractEntitlementCreate({
          companyId: DEMO_COMPANY_A,
          contractId: '11111111-1111-1111-1111-111111111111',
          entitlementType: 'unlimited_snacks' as any,
          totalEntitled: 5,
        })
      ).toThrow(/entitlementType must be one of/i);
    });

    it('rejects zero or negative totalEntitled', () => {
      expect(() =>
        validateContractEntitlementCreate({
          companyId: DEMO_COMPANY_A,
          contractId: '11111111-1111-1111-1111-111111111111',
          entitlementType: 'labor_hours',
          totalEntitled: 0,
        })
      ).toThrow(/strictly positive number/i);
    });
  });

  describe('Entitlement Utilization Balance Math (Pure Logic)', () => {
    it('correctly tracks visit consumption within limits', () => {
      // 12 visits entitled, 4 already used, requesting 1 visit
      const res = ContractEntitlementService.calculateEntitlementBalance(12, 4, 1, 'convert_to_billable');

      expect(res.isCovered).toBe(true);
      expect(res.limitExceeded).toBe(false);
      expect(res.coveredAmount).toBe(1);
      expect(res.billableAmount).toBe(0);
      expect(res.remainingBefore).toBe(8);
      expect(res.remainingAfter).toBe(7);
    });

    it('correctly handles labor hours limit exceeded with convert_to_billable', () => {
      // 100 hours entitled, 95 already used, technician logged 10 hours
      const res = ContractEntitlementService.calculateEntitlementBalance(100, 95, 10, 'convert_to_billable');

      expect(res.isCovered).toBe(true);
      expect(res.limitExceeded).toBe(true);
      expect(res.coveredAmount).toBe(5); // 5 hours covered by remaining balance
      expect(res.billableAmount).toBe(5); // 5 hours billed as excess
      expect(res.remainingBefore).toBe(5);
      expect(res.remainingAfter).toBe(0);
    });

    it('rejects coverage when limit exceeded with reject_coverage action', () => {
      // 4 emergency visits entitled, 4 used, requesting 1
      const res = ContractEntitlementService.calculateEntitlementBalance(4, 4, 1, 'reject_coverage');

      expect(res.isCovered).toBe(false);
      expect(res.limitExceeded).toBe(true);
      expect(res.coveredAmount).toBe(0);
      expect(res.billableAmount).toBe(1);
    });

    it('maintains exact Decimal precision across multiple parts allowance deductions', () => {
      // 25,000.000 parts allowance
      let used = 0;
      const total = 25000;

      const deductions = [4500.5, 8200.75, 6100.25];
      for (const d of deductions) {
        const res = ContractEntitlementService.calculateEntitlementBalance(total, used, d);
        expect(res.isCovered).toBe(true);
        used += d;
      }

      expect(used).toBe(18801.5);
      const remainingRes = ContractEntitlementService.calculateEntitlementBalance(total, used, 1000);
      expect(remainingRes.remainingBefore).toBe(6198.5);
    });
  });

  describe('Live DB Entitlements Query', () => {
    it('lists entitlements if DB is live', async () => {
      if (!isLiveDb) return;

      const dummyContractId = '00000000-0000-0000-0000-000000000001';
      const ents = await ContractEntitlementService.listEntitlements(admin, dummyContractId);
      expect(Array.isArray(ents)).toBe(true);
    });
  });
});

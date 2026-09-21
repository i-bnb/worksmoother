/**
 * =============================================================================
 * Test Suite 1: Contract Lifecycle State Machine & Validations
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ServiceContractService, ContractStatus } from '../../src/services/service-contract.service.js';
import { validateContractCreate } from '../../src/schemas/contract.schema.js';

describe('Phase 4: Contract Lifecycle State Machine & Validations', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('amc_contracts').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Contract Schema Validations', () => {
    it('accepts valid contract creation payload', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        customerId: '33333333-3333-3333-3333-333333333333',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        contractValue: 120000,
        taxAmount: 21600,
        contractType: 'amc' as const,
        billingFrequency: 'quarterly' as const,
        serviceFrequency: 'quarterly' as const,
        currency: 'INR',
      };

      const validated = validateContractCreate(payload);
      expect(validated.companyId).toBe(DEMO_COMPANY_A);
      expect(validated.contractValue).toBe(120000);
      expect(validated.currency).toBe('INR');
    });

    it('rejects contract creation with inverted dates (startDate > endDate)', () => {
      expect(() =>
        validateContractCreate({
          companyId: DEMO_COMPANY_A,
          customerId: '33333333-3333-3333-3333-333333333333',
          startDate: '2027-04-01',
          endDate: '2026-04-01',
          contractValue: 50000,
        })
      ).toThrow(/startDate must be on or before endDate/i);
    });

    it('rejects contract with negative contractValue', () => {
      expect(() =>
        validateContractCreate({
          companyId: DEMO_COMPANY_A,
          customerId: '33333333-3333-3333-3333-333333333333',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          contractValue: -500,
        })
      ).toThrow(/non-negative number/i);
    });

    it('rejects invalid contractType', () => {
      expect(() =>
        validateContractCreate({
          companyId: DEMO_COMPANY_A,
          customerId: '33333333-3333-3333-3333-333333333333',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          contractValue: 10000,
          contractType: 'infinite_free_service' as any,
        })
      ).toThrow(/contractType must be one of/i);
    });
  });

  describe('Contract State Machine Invariants', () => {
    it('permits valid linear progression: draft -> quoted -> pending_approval -> approved -> active', () => {
      expect(ServiceContractService.isValidTransition('draft', 'quoted')).toBe(true);
      expect(ServiceContractService.isValidTransition('quoted', 'pending_approval')).toBe(true);
      expect(ServiceContractService.isValidTransition('pending_approval', 'approved')).toBe(true);
      expect(ServiceContractService.isValidTransition('approved', 'active')).toBe(true);
    });

    it('permits suspension and resumption of active contracts: active <-> suspended', () => {
      expect(ServiceContractService.isValidTransition('active', 'suspended')).toBe(true);
      expect(ServiceContractService.isValidTransition('suspended', 'active')).toBe(true);
    });

    it('permits expiry and renewal: active -> expiring -> expired -> renewed', () => {
      expect(ServiceContractService.isValidTransition('active', 'expiring')).toBe(true);
      expect(ServiceContractService.isValidTransition('expiring', 'expired')).toBe(true);
      expect(ServiceContractService.isValidTransition('expired', 'renewed')).toBe(true);
    });

    it('strictly forbids invalid transitions: expired -> active directly (must renew)', () => {
      expect(ServiceContractService.isValidTransition('expired', 'active')).toBe(false);
    });

    it('strictly forbids transitions from terminal states: cancelled or renewed', () => {
      const allStatuses: ContractStatus[] = [
        'draft',
        'quoted',
        'pending_approval',
        'approved',
        'active',
        'suspended',
        'expiring',
        'expired',
        'renewed',
        'cancelled',
      ];

      for (const target of allStatuses) {
        expect(ServiceContractService.isValidTransition('cancelled', target)).toBe(false);
        expect(ServiceContractService.isValidTransition('renewed', target)).toBe(false);
      }
    });
  });

  describe('Live DB Contract Operations', () => {
    it('lists contracts for company if DB is live', async () => {
      if (!isLiveDb) return;

      const contracts = await ServiceContractService.listContracts(admin, DEMO_COMPANY_A);
      expect(Array.isArray(contracts)).toBe(true);
    });
  });
});

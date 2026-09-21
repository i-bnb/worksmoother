/**
 * =============================================================================
 * Test Suite 7: Phase 4 Contract REST API Controllers & Error Handling
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ContractsApiController } from '../../src/api/contracts.js';
import { ContractSchedulesApiController } from '../../src/api/contract-schedules.js';
import { ContractBillingApiController } from '../../src/api/contract-billing.js';

describe('Phase 4: Contract REST API Controllers Layer', () => {
  const admin = getAdminClient();

  describe('Contracts API Controller', () => {
    it('returns 400 when required fields are missing on contract creation', async () => {
      const res = await ContractsApiController.createContract(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
        },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/customerId is required/i);
    });

    it('returns 400 when company_id is missing from listContracts', async () => {
      const res = await ContractsApiController.listContracts(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/companyId is required/i);
    });

    it('returns 400 when id is missing from getContract', async () => {
      const res = await ContractsApiController.getContract(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from approveContract', async () => {
      const res = await ContractsApiController.approveContract(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from activateContract', async () => {
      const res = await ContractsApiController.activateContract(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from suspendContract', async () => {
      const res = await ContractsApiController.suspendContract(admin, {
        params: {},
        body: { reason: 'Pending payment' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from resumeContract', async () => {
      const res = await ContractsApiController.resumeContract(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from cancelContract', async () => {
      const res = await ContractsApiController.cancelContract(admin, {
        params: {},
        body: { reason: 'Client requested termination' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from renewContract', async () => {
      const res = await ContractsApiController.renewContract(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when quotation id is missing from convertQuotation', async () => {
      const res = await ContractsApiController.convertQuotation(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Quotation ID is required/i);
    });

    it('returns 400 when contractId is missing from addAsset', async () => {
      const res = await ContractsApiController.addAsset(admin, {
        params: {},
        body: { customerAssetId: '22222222-2222-2222-2222-222222222222' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when contractId is missing from listAssets', async () => {
      const res = await ContractsApiController.listAssets(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when assetId is missing from removeAsset', async () => {
      const res = await ContractsApiController.removeAsset(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Asset ID is required/i);
    });

    it('returns 400 when contractId is missing from createEntitlement', async () => {
      const res = await ContractsApiController.createEntitlement(admin, {
        params: {},
        body: { companyId: DEMO_COMPANY_A, entitlementType: 'total_visits', totalEntitled: 10 },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when contractId is missing from getUsage', async () => {
      const res = await ContractsApiController.getUsage(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when contractId is missing from getProfitability', async () => {
      const res = await ContractsApiController.getProfitability(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when company_id is missing from getSummary', async () => {
      const res = await ContractsApiController.getSummary(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/companyId is required/i);
    });

    it('returns 400 when asset id is missing from getAssetHistory', async () => {
      const res = await ContractsApiController.getAssetHistory(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Asset ID is required/i);
    });
  });

  describe('Contract Schedules API Controller', () => {
    it('returns 400 when required fields are missing on createSchedule', async () => {
      const res = await ContractSchedulesApiController.createSchedule(admin, {
        body: { companyId: DEMO_COMPANY_A },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/contractId is required/i);
    });

    it('returns 400 when company_id is missing from listSchedules', async () => {
      const res = await ContractSchedulesApiController.listSchedules(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/companyId is required/i);
    });

    it('returns 400 when id is missing from generateContractSchedules', async () => {
      const res = await ContractSchedulesApiController.generateContractSchedules(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from dispatchWorkOrder', async () => {
      const res = await ContractSchedulesApiController.dispatchWorkOrder(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Schedule ID is required/i);
    });
  });

  describe('Contract Billing API Controller', () => {
    it('returns 400 when id is missing from generateBillingSchedule', async () => {
      const res = await ContractBillingApiController.generateBillingSchedule(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });

    it('returns 400 when id is missing from listBillingSchedules', async () => {
      const res = await ContractBillingApiController.listBillingSchedules(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Contract ID is required/i);
    });
  });
});

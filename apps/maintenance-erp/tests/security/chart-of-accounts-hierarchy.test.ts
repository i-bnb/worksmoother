/**
 * =============================================================================
 * Test Suite 2: Chart of Accounts Hierarchy & Circular Reference Guard
 * Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ChartOfAccountsService } from '../../src/services/chart-of-accounts.service.js';
import { CategoryMappingService } from '../../src/services/category-mapping.service.js';
import { validateAccountCreate } from '../../src/schemas/account.schema.js';

describe('Phase 3A: Chart of Accounts Hierarchy & Validations', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('chart_of_accounts').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Account Schema Validations', () => {
    it('accepts valid account creation payload', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        accountCode: '1010-01',
        accountName: 'HDFC Current Account',
        accountType: 'asset' as const,
        currency: 'INR',
      };
      const validated = validateAccountCreate(payload);
      expect(validated.accountCode).toBe('1010-01');
      expect(validated.accountType).toBe('asset');
    });

    it('rejects creation without accountCode or accountName', () => {
      expect(() =>
        validateAccountCreate({
          companyId: DEMO_COMPANY_A,
          accountCode: '',
          accountName: 'Test',
          accountType: 'asset',
        })
      ).toThrow(/accountCode is required/i);

      expect(() =>
        validateAccountCreate({
          companyId: DEMO_COMPANY_A,
          accountCode: '1010',
          accountName: '',
          accountType: 'asset',
        })
      ).toThrow(/accountName is required/i);
    });

    it('rejects invalid account types outside GAAP/IFRS standards', () => {
      expect(() =>
        validateAccountCreate({
          companyId: DEMO_COMPANY_A,
          accountCode: '1010',
          accountName: 'Crypto Speculation',
          accountType: 'gambling' as any,
        })
      ).toThrow(/accountType must be one of/i);
    });
  });

  describe('Account Hierarchy Tree Construction', () => {
    it('correctly constructs a multi-level account tree from flat account rows', () => {
      const flatAccounts = [
        { id: 'acc-1', account_code: '1000', account_name: 'Assets', parent_account_id: null },
        { id: 'acc-2', account_code: '1100', account_name: 'Current Assets', parent_account_id: 'acc-1' },
        { id: 'acc-3', account_code: '1110', account_name: 'Cash and Cash Equivalents', parent_account_id: 'acc-2' },
        { id: 'acc-4', account_code: '1111', account_name: 'Petty Cash', parent_account_id: 'acc-3' },
        { id: 'acc-5', account_code: '2000', account_name: 'Liabilities', parent_account_id: null },
      ];

      const tree = ChartOfAccountsService.buildAccountTree(flatAccounts);

      expect(tree.length).toBe(2); // Assets and Liabilities
      expect(tree[0].account_name).toBe('Assets');
      expect(tree[0].children.length).toBe(1); // Current Assets
      expect(tree[0].children[0].account_name).toBe('Current Assets');
      expect(tree[0].children[0].children.length).toBe(1); // Cash and Cash Equivalents
      expect(tree[0].children[0].children[0].children.length).toBe(1); // Petty Cash
      expect(tree[0].children[0].children[0].children[0].account_name).toBe('Petty Cash');

      expect(tree[1].account_name).toBe('Liabilities');
      expect(tree[1].children.length).toBe(0);
    });
  });

  describe('Circular Parent Hierarchy Prevention', () => {
    it('prevents assigning an account as its own parent', async () => {
      const accountId = 'acc-self-test';
      await expect(
        ChartOfAccountsService.updateAccount(admin, accountId, {
          parentAccountId: accountId,
        })
      ).rejects.toThrow(/cannot be its own parent/i);
    });
  });

  describe('Operational Category Mappings & Live DB Verification', () => {
    it('verifies category mappings can be queried', async () => {
      if (!isLiveDb) return;

      const mappings = await CategoryMappingService.listMappings(admin, DEMO_COMPANY_A);
      expect(Array.isArray(mappings)).toBe(true);
    });

    it('verifies Chart of Accounts can be listed with grouping', async () => {
      if (!isLiveDb) return;

      const accounts = await ChartOfAccountsService.listAccounts(admin, DEMO_COMPANY_A);
      expect(Array.isArray(accounts)).toBe(true);
      if (accounts.length > 0) {
        expect(accounts[0]).toHaveProperty('account_code');
        expect(accounts[0]).toHaveProperty('account_type');
      }
    });
  });
});

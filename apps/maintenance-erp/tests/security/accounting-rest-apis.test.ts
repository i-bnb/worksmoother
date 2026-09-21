/**
 * =============================================================================
 * Test Suite 5: Phase 3A Accounting REST API Controllers & Error Handling
 * Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { AccountingSettingsApiController } from '../../src/api/accounting-settings.js';
import { AccountingJournalsApiController } from '../../src/api/accounting-journals.js';
import { AccountingExpensesApiController } from '../../src/api/accounting-expenses.js';
import { AccountingStatementsApiController } from '../../src/api/accounting-statements.js';
import { AccountingReportsApiController } from '../../src/api/accounting-reports.js';

describe('Phase 3A: Accounting REST API Controllers Layer', () => {
  const admin = getAdminClient();

  describe('Accounting Settings API Controller', () => {
    it('returns 400 when company_id is missing from getSettings', async () => {
      const res = await AccountingSettingsApiController.getSettings(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when invalid payload is passed to updateSettings', async () => {
      const res = await AccountingSettingsApiController.updateSettings(admin, {
        params: { companyId: DEMO_COMPANY_A },
        body: { fiscal_year_start_month: 15 }, // Invalid month
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/between 1 and 12/i);
    });
  });

  describe('Accounting Journals & Accounts API Controller', () => {
    it('returns 400 when company_id is missing from listAccounts', async () => {
      const res = await AccountingJournalsApiController.listAccounts(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when createAccount body has invalid accountType', async () => {
      const res = await AccountingJournalsApiController.createAccount(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          accountCode: '9999',
          accountName: 'Invalid Type Account',
          accountType: 'virtual_asset',
        },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/accountType must be one of/i);
    });

    it('returns 400 when createJournal has unbalanced lines (Debits != Credits)', async () => {
      const res = await AccountingJournalsApiController.createJournal(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          journalDate: '2026-05-01',
          journalType: 'general',
          description: 'Unbalanced entry test',
          lines: [
            {
              accountId: '11111111-1111-1111-1111-111111111111',
              debit: 1000,
              credit: 0,
            },
            {
              accountId: '22222222-2222-2222-2222-222222222222',
              debit: 0,
              credit: 800, // Debits 1000 != Credits 800
            },
          ],
        },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Total Debits.*does not equal Total Credits/i);
    });
  });


  describe('Accounting Expenses API Controller', () => {
    it('returns 400 when required fields are missing on expense creation', async () => {
      const res = await AccountingExpensesApiController.createExpense(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
        },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/amount must be a strictly positive number/i);
    });


    it('returns 400 when expense id is missing on submitExpense', async () => {
      const res = await AccountingExpensesApiController.submitExpense(admin, {
        params: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Expense ID is required/i);
    });

    it('returns 400 when expense payment payload is missing required fields', async () => {
      const res = await AccountingExpensesApiController.payExpense(admin, {
        params: { id: 'some-expense-id' },
        body: {
          paymentMethod: '',
          amountPaid: 0,
        },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/paymentMethod is required/i);
    });
  });

  describe('Accounting Statements API Controller', () => {
    it('returns 400 when customer ID is missing from getCustomerStatement', async () => {
      const res = await AccountingStatementsApiController.getCustomerStatement(admin, {
        params: {},
        query: { from_date: '2026-04-01', to_date: '2027-03-31' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Customer ID is required/i);
    });

    it('returns 400 when supplier ID is missing from getSupplierStatement', async () => {
      const res = await AccountingStatementsApiController.getSupplierStatement(admin, {
        params: {},
        query: { from_date: '2026-04-01', to_date: '2027-03-31' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Supplier ID is required/i);
    });

    it('returns 400 when statement date range is inverted', async () => {
      const res = await AccountingStatementsApiController.getCustomerStatement(admin, {
        params: { id: 'cust-123' },
        query: { from_date: '2026-12-31', to_date: '2026-01-01' },
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/fromDate cannot be after toDate/i);
    });
  });

  describe('Accounting Reports API Controller', () => {
    it('returns 400 when company_id is missing from getTrialBalance', async () => {
      const res = await AccountingReportsApiController.getTrialBalance(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getGeneralLedger', async () => {
      const res = await AccountingReportsApiController.getGeneralLedger(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getProfitAndLoss', async () => {
      const res = await AccountingReportsApiController.getProfitAndLoss(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getBalanceSheet', async () => {
      const res = await AccountingReportsApiController.getBalanceSheet(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getCashSummary', async () => {
      const res = await AccountingReportsApiController.getCashSummary(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getOverdueReceivables', async () => {
      const res = await AccountingReportsApiController.getOverdueReceivables(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });

    it('returns 400 when company_id is missing from getOverduePayables', async () => {
      const res = await AccountingReportsApiController.getOverduePayables(admin, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/company_id is required/i);
    });
  });
});

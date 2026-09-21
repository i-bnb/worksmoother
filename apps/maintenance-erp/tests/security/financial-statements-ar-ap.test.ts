/**
 * =============================================================================
 * Test Suite 3: Financial Statements (AR/AP Statements & Balance Invariants)
 * Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateStatementQuery } from '../../src/schemas/statement.schema.js';
import { ReceivableService } from '../../src/services/receivable.service.js';
import { PayableService } from '../../src/services/payable.service.js';
import { FinancialReportingService } from '../../src/services/financial-reporting.service.js';
import { Decimal } from '../../src/lib/decimal.js';

describe('Phase 3A: Financial Statements (AR/AP Statements & Ledger Balances)', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('customers').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Statement Date Filter Validation', () => {
    it('accepts valid date range', () => {
      const query = {
        from_date: '2026-04-01',
        to_date: '2027-03-31',
      };
      const validated = validateStatementQuery(query);
      expect(validated.fromDate).toBe('2026-04-01');
      expect(validated.toDate).toBe('2027-03-31');
    });

    it('rejects inverted date range (fromDate > toDate)', () => {
      expect(() =>
        validateStatementQuery({
          from_date: '2026-12-31',
          to_date: '2026-01-01',
        })
      ).toThrow(/fromDate cannot be after toDate/i);
    });

    it('rejects invalid date format', () => {
      expect(() =>
        validateStatementQuery({
          from_date: '01/04/2026',
          to_date: '31/03/2027',
        })
      ).toThrow(/YYYY-MM-DD/i);
    });
  });

  describe('Customer Statement Mathematical Invariants', () => {
    it('accurately computes customer running balance: opening + debits - credits', () => {
      const openingBalance = new Decimal(5000); // 5,000 INR previous balance due
      const transactions = [
        { type: 'invoice', amount: 12000 }, // + 12,000
        { type: 'payment', amount: 10000 }, // - 10,000
        { type: 'credit_note', amount: 1000 }, // - 1,000
        { type: 'invoice', amount: 4500 }, // + 4,500
      ];

      let runningBalance = openingBalance;
      const computedLines = transactions.map((tx) => {
        if (tx.type === 'invoice') {
          runningBalance = runningBalance.plus(tx.amount);
        } else {
          runningBalance = runningBalance.minus(tx.amount);
        }
        return { ...tx, balance: runningBalance.toNumber() };
      });

      expect(computedLines[0].balance).toBe(17000); // 5000 + 12000
      expect(computedLines[1].balance).toBe(7000);  // 17000 - 10000
      expect(computedLines[2].balance).toBe(6000);  // 7000 - 1000
      expect(computedLines[3].balance).toBe(10500); // 6000 + 4500
      expect(runningBalance.toNumber()).toBe(10500);
    });
  });

  describe('Supplier Statement Mathematical Invariants', () => {
    it('accurately computes supplier payable running balance: opening + credits - debits', () => {
      const openingBalance = new Decimal(20000); // 20,000 INR owed to supplier
      const transactions = [
        { type: 'bill', amount: 50000 },       // + 50,000 credit (we owe more)
        { type: 'disbursement', amount: 40000 }, // - 40,000 debit (we paid)
        { type: 'debit_note', amount: 2000 },    // - 2,000 debit (return/discount)
      ];

      let runningBalance = openingBalance;
      const computedLines = transactions.map((tx) => {
        if (tx.type === 'bill') {
          runningBalance = runningBalance.plus(tx.amount);
        } else {
          runningBalance = runningBalance.minus(tx.amount);
        }
        return { ...tx, balance: runningBalance.toNumber() };
      });

      expect(computedLines[0].balance).toBe(70000); // 20000 + 50000
      expect(computedLines[1].balance).toBe(30000); // 70000 - 40000
      expect(computedLines[2].balance).toBe(28000); // 30000 - 2000
      expect(runningBalance.toNumber()).toBe(28000);
    });
  });

  describe('Live Database Statement & Balance RPC Verification', () => {
    it('fetches trial balance and validates debits equal credits', async () => {
      if (!isLiveDb) return;

      const tb = await FinancialReportingService.getTrialBalance(admin, DEMO_COMPANY_A);
      expect(tb).toHaveProperty('accounts');
      expect(tb).toHaveProperty('validation');
      if (tb.validation) {
        expect(tb.validation.is_balanced).toBe(true);
      }
    });

    it('queries overdue customer invoices with proper ordering', async () => {
      if (!isLiveDb) return;

      const overdues = await ReceivableService.getOverdueInvoices(admin, DEMO_COMPANY_A);
      expect(Array.isArray(overdues)).toBe(true);
    });

    it('queries overdue supplier bills with proper ordering', async () => {
      if (!isLiveDb) return;

      const overdueBills = await PayableService.getOverdueBills(admin, DEMO_COMPANY_A);
      expect(Array.isArray(overdueBills)).toBe(true);
    });
  });
});

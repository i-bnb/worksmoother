/**
 * =============================================================================
 * Test Suite 1: Financial Periods & Fiscal Year Calculation
 * Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { FinancialPeriodService } from '../../src/services/financial-period.service.js';
import { validateAccountingSettingsUpdate } from '../../src/schemas/accounting-settings.schema.js';

describe('Phase 3A: Financial Periods & Fiscal Year Calculation', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('settings').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Fiscal Year Dynamic Calculation (Pure Logic)', () => {
    it('calculates April-start fiscal years correctly across boundaries', () => {
      // April 1, 2026 starts FY 2026-2027
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-04-01T00:00:00Z'), 4)).toBe('2026-2027');

      // March 31, 2026 belongs to FY 2025-2026
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-03-31T23:59:59Z'), 4)).toBe('2025-2026');

      // December 2026 belongs to FY 2026-2027
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-12-15T12:00:00Z'), 4)).toBe('2026-2027');

      // January 2027 belongs to FY 2026-2027
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2027-01-10T10:00:00Z'), 4)).toBe('2026-2027');

      // March 31, 2027 closes FY 2026-2027
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2027-03-31T23:59:59Z'), 4)).toBe('2026-2027');
    });

    it('calculates calendar year (January-start) fiscal years correctly', () => {
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-01-01T00:00:00Z'), 1)).toBe('2026');
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-06-15T00:00:00Z'), 1)).toBe('2026');
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-12-31T23:59:59Z'), 1)).toBe('2026');
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2027-01-01T00:00:00Z'), 1)).toBe('2027');
    });

    it('calculates custom mid-year starts (e.g., July-start Australian/US fiscal year)', () => {
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-06-30T23:59:59Z'), 7)).toBe('2025-2026');
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2026-07-01T00:00:00Z'), 7)).toBe('2026-2027');
      expect(FinancialPeriodService.calculateFiscalYear(new Date('2027-06-30T23:59:59Z'), 7)).toBe('2026-2027');
    });
  });

  describe('Accounting Settings Schema Validation', () => {
    it('accepts valid accounting settings payload', () => {
      const validated = validateAccountingSettingsUpdate({
        fiscalYearStartMonth: 4,
        accountingBaseCurrency: 'INR',
        decimalPrecision: 3,
        defaultPaymentTerms: 'NET_30',
        defaultDueDays: 30,
        allowFutureDatedTransactions: false,
        allowSelfExpenseApproval: false,
      });

      expect(validated.fiscalYearStartMonth).toBe(4);
      expect(validated.accountingBaseCurrency).toBe('INR');
      expect(validated.decimalPrecision).toBe(3);
      expect(validated.allowSelfExpenseApproval).toBe(false);
    });

    it('rejects invalid fiscal year start months outside 1-12', () => {
      expect(() =>
        validateAccountingSettingsUpdate({
          fiscalYearStartMonth: 13,
        })
      ).toThrow(/between 1 and 12/i);

      expect(() =>
        validateAccountingSettingsUpdate({
          fiscalYearStartMonth: 0,
        })
      ).toThrow(/between 1 and 12/i);
    });

    it('rejects decimal precision outside 2-4', () => {
      expect(() =>
        validateAccountingSettingsUpdate({
          decimalPrecision: 5,
        })
      ).toThrow(/between 2 and 4/i);
    });

    it('rejects negative default due days', () => {
      expect(() =>
        validateAccountingSettingsUpdate({
          defaultDueDays: -5,
        })
      ).toThrow(/non-negative/i);
    });
  });

  describe('Database Period Validation & Locking (Live DB)', () => {
    it('validates financial period via RPC', async () => {
      if (!isLiveDb) return;

      const res = await FinancialPeriodService.validatePeriod(
        admin,
        DEMO_COMPANY_A,
        '2026-05-15'
      );
      expect(res).toBeDefined();
    });

    it('prevents posting to future dates if allow_future_dated_transactions is false', async () => {
      if (!isLiveDb) return;

      // Ensure allow_future_dated_transactions is false
      await admin
        .from('settings')
        .update({ allow_future_dated_transactions: false })
        .eq('company_id', DEMO_COMPANY_A);

      const futureDate = '2099-12-31';
      await expect(
        FinancialPeriodService.validatePeriod(admin, DEMO_COMPANY_A, futureDate)
      ).rejects.toThrow();
    });
  });
});


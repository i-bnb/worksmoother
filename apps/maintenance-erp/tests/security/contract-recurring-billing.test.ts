/**
 * =============================================================================
 * Test Suite 5: Contract Recurring Billing & Installment Engine
 * Maintenance Management ERP — Phase 4 AMC & Recurring Maintenance
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { ContractBillingService } from '../../src/services/contract-billing.service.js';
import { validateContractBillingQuery } from '../../src/schemas/contract-billing.schema.js';
import { Decimal } from '../../src/lib/decimal.js';

describe('Phase 4: Contract Recurring Billing & Installment Engine', () => {
  describe('Billing Query Schema Validation', () => {
    it('accepts valid asOfDate query', () => {
      const q = validateContractBillingQuery({ asOfDate: '2026-07-01' });
      expect(q.asOfDate).toBe('2026-07-01');
    });

    it('defaults asOfDate to today if omitted', () => {
      const q = validateContractBillingQuery({});
      expect(q.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects malformed asOfDate', () => {
      expect(() => validateContractBillingQuery({ asOfDate: '01/07/2026' })).toThrow(/YYYY-MM-DD/i);
    });
  });

  describe('Installment Calculation Math (Pure Logic)', () => {
    const contractValue = 120000;
    const taxAmount = 21600;
    const startDate = '2026-04-01';
    const endDate = '2027-03-31';

    it('calculates 4 quarterly billing installments with exact Decimal precision', () => {
      const installments = ContractBillingService.calculateInstallments(
        contractValue,
        taxAmount,
        startDate,
        endDate,
        'quarterly',
        'CONT-001'
      );

      expect(installments.length).toBe(4);

      // Each installment: 120,000 / 4 = 30,000 INR
      // Tax: 21,600 / 4 = 5,400 INR
      // Total: 35,400 INR
      expect(installments[0].amount).toBe(30000);
      expect(installments[0].taxAmount).toBe(5400);
      expect(installments[0].totalAmount).toBe(35400);

      // Verify date ranges
      expect(installments[0].billingPeriodStart).toBe('2026-04-01');
      expect(installments[0].billingPeriodEnd).toBe('2026-06-30');

      expect(installments[1].billingPeriodStart).toBe('2026-07-01');
      expect(installments[1].billingPeriodEnd).toBe('2026-09-30');

      expect(installments[2].billingPeriodStart).toBe('2026-10-01');
      expect(installments[2].billingPeriodEnd).toBe('2026-12-31');

      expect(installments[3].billingPeriodStart).toBe('2027-01-01');
      expect(installments[3].billingPeriodEnd).toBe('2027-03-31');

      // Verify total sum equals contract value without float drift
      let sumAmt = new Decimal(0);
      let sumTax = new Decimal(0);
      for (const ins of installments) {
        sumAmt = sumAmt.plus(ins.amount);
        sumTax = sumTax.plus(ins.taxAmount);
        expect(ins.idempotencyKey).toBe(`BILL-CONT-001-${ins.billingPeriodStart}-${ins.billingPeriodEnd}`);
      }
      expect(sumAmt.toNumber()).toBe(contractValue);
      expect(sumTax.toNumber()).toBe(taxAmount);
    });

    it('calculates 12 monthly installments', () => {
      const installments = ContractBillingService.calculateInstallments(
        60000,
        10800,
        startDate,
        endDate,
        'monthly',
        'CONT-002'
      );

      expect(installments.length).toBe(12);
      expect(installments[0].amount).toBe(5000);
      expect(installments[0].taxAmount).toBe(900);
      expect(installments[0].totalAmount).toBe(5900);
    });

    it('calculates single annual upfront installment', () => {
      const installments = ContractBillingService.calculateInstallments(
        50000,
        9000,
        startDate,
        endDate,
        'annual_upfront',
        'CONT-003'
      );

      expect(installments.length).toBe(1);
      expect(installments[0].amount).toBe(50000);
      expect(installments[0].totalAmount).toBe(59000);
      expect(installments[0].billingPeriodStart).toBe('2026-04-01');
      expect(installments[0].billingPeriodEnd).toBe('2027-03-31');
    });
  });
});

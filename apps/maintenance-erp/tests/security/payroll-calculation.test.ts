/**
 * =============================================================================
 * Test Suite 7: Payroll Calculation, Proration Engine & Period Locking Immutability
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { PayrollCalculationService } from '../../src/services/payroll-calculation.service.js';
import { validatePayrollPeriodCreate } from '../../src/schemas/payroll.schema.js';

describe('Phase 6: Payroll Calculation & Proration Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('payroll_periods').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Payslip Proration & Overtime Calculation', () => {
    it('calculates full month salary when attendance is 100%', () => {
      const payslip = PayrollCalculationService.calculateEmployeePayslip({
        employeeId: 'emp-01',
        baseSalary: 52000,
        totalWorkingDays: 26,
        presentDays: 26,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        overtimeHours: 0,
      });

      expect(payslip.baseSalary).toBe(52000);
      expect(payslip.proratedBaseSalary).toBe(52000);
      expect(payslip.grossPay).toBe(52000);
      expect(payslip.totalDeductions).toBe(0);
      expect(payslip.netPay).toBe(52000);
    });

    it('prorates base salary exactly for mid-month joins or partial attendance', () => {
      // 13 days present out of 26 working days -> 50% pay
      const payslip = PayrollCalculationService.calculateEmployeePayslip({
        employeeId: 'emp-02',
        baseSalary: 52000,
        totalWorkingDays: 26,
        presentDays: 13,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
      });

      expect(payslip.proratedBaseSalary).toBe(26000);
      expect(payslip.grossPay).toBe(26000);
      expect(payslip.netPay).toBe(26000);
    });

    it('calculates loss of pay (LOP) deductions for unapproved or unpaid leaves', () => {
      // Base: 26000, working days: 26 -> daily rate = 1000
      // Present: 22, Paid Leave: 2 -> payable = 24 -> proratedBase = 24000
      // Unpaid Leave: 2 -> LOP deduction = 2000
      const payslip = PayrollCalculationService.calculateEmployeePayslip({
        employeeId: 'emp-03',
        baseSalary: 26000,
        totalWorkingDays: 26,
        presentDays: 22,
        paidLeaveDays: 2,
        unpaidLeaveDays: 2,
      });

      expect(payslip.proratedBaseSalary).toBe(24000);
      expect(payslip.totalDeductions).toBe(2000);
      expect(payslip.netPay).toBe(22000); // 24,000 - 2,000

      const lopItem = payslip.deductionsBreakdown.find((d: any) => d.code === 'LOP');
      expect(lopItem).toBeDefined();
      expect(lopItem.amount).toBe(2000);
    });

    it('adds overtime pay calculated at technician overtime rate', () => {
      // Base 30,000 (full), Overtime: 10 hours at 250/hr = 2,500
      const payslip = PayrollCalculationService.calculateEmployeePayslip({
        employeeId: 'emp-04',
        baseSalary: 30000,
        overtimeRate: 250,
        totalWorkingDays: 26,
        presentDays: 26,
        overtimeHours: 10,
      });

      expect(payslip.overtimePay).toBe(2500);
      expect(payslip.grossPay).toBe(32500); // 30,000 + 2,500
      expect(payslip.netPay).toBe(32500);
    });

    it('incorporates structure earnings and deductions with overtime and proration', () => {
      const payslip = PayrollCalculationService.calculateEmployeePayslip({
        employeeId: 'emp-05',
        baseSalary: 40000,
        overtimeRate: 300,
        totalWorkingDays: 25,
        presentDays: 25,
        overtimeHours: 5, // 1,500
        components: [
          {
            componentId: 'c1',
            code: 'HRA',
            name: 'House Rent Allowance',
            type: 'earning',
            calculationType: 'percentage',
            percentage: 25, // 10,000
          },
          {
            componentId: 'c2',
            code: 'INS',
            name: 'Health Insurance',
            type: 'deduction',
            calculationType: 'flat',
            amount: 1200, // 1,200
          },
        ],
      });

      expect(payslip.proratedBaseSalary).toBe(40000);
      expect(payslip.overtimePay).toBe(1500);
      expect(payslip.grossPay).toBe(51500); // 40,000 + 1,500 (OT) + 10,000 (HRA)
      expect(payslip.totalDeductions).toBe(1200); // Insurance
      expect(payslip.netPay).toBe(50300); // 51,500 - 1,200
    });

    it('validates payroll period create schema', () => {
      const valid = validatePayrollPeriodCreate({
        companyId: DEMO_COMPANY_A,
        code: 'PAY-2026-03',
        name: 'March 2026 Payroll Run',
        periodStartDate: '2026-03-01',
        periodEndDate: '2026-03-31',
        paymentDate: '2026-04-02',
        totalWorkingDays: 26,
      });

      expect(valid.code).toBe('PAY-2026-03');
      expect(valid.periodStartDate).toBe('2026-03-01');
      expect(valid.periodEndDate).toBe('2026-03-31');

      expect(() =>
        validatePayrollPeriodCreate({
          companyId: DEMO_COMPANY_A,
          code: 'PAY-2026-03',
          name: 'March 2026 Payroll Run',
          periodStartDate: '2026-03-31',
          periodEndDate: '2026-03-01', // start > end
        })
      ).toThrow(/periodStartDate must be on or before periodEndDate/i);
    });
  });

  describe('Database Integration', () => {
    it('creates payroll period, calculates run, and locks period immutability', async () => {
      if (!isLiveDb) return;

      const period = await PayrollCalculationService.createPayrollPeriod(admin, {
        companyId: DEMO_COMPANY_A,
        code: `PRD-${Date.now()}`,
        name: 'Automated Test Payroll Period',
        periodStartDate: '2026-03-01',
        periodEndDate: '2026-03-31',
        paymentDate: '2026-04-05',
        totalWorkingDays: 26,
      });

      expect(period.id).toBeDefined();
      expect(period.status).toBe('draft');

      // Process calculation
      const processed = await PayrollCalculationService.processPayrollPeriod(
        admin,
        DEMO_COMPANY_A,
        period.id
      );
      expect(processed.status).toBe('processed');

      // Lock period
      const locked = await PayrollCalculationService.lockPayrollPeriod(
        admin,
        DEMO_COMPANY_A,
        period.id,
        '00000000-0000-0000-0000-000000000001'
      );
      expect(locked.status).toBe('locked');
      expect(locked.locked_at).toBeDefined();

      // Recalculating locked period must reject
      await expect(
        PayrollCalculationService.processPayrollPeriod(admin, DEMO_COMPANY_A, period.id)
      ).rejects.toThrow(/Period is locked/i);
    });
  });
});

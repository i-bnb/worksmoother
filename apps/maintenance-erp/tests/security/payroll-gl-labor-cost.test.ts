/**
 * =============================================================================
 * Test Suite 8: Payroll GL Double-Entry Posting, Work Order Labor Costing & Availability
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  PayrollAccountingService,
  PayrollTotals,
  PayrollGlAccounts,
} from '../../src/services/payroll-accounting.service.js';
import { LaborCostService } from '../../src/services/labor-cost.service.js';
import { Decimal } from '../../src/lib/decimal.js';

describe('Phase 6: Payroll GL Integration & Work Order Labor Costing', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('journal_entries').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Double-Entry Payroll GL Posting Engine', () => {
    it('constructs strictly balanced double-entry accrual lines (Sum Dr == Sum Cr)', () => {
      const totals: PayrollTotals = {
        grossPay: 100000,
        totalDeductions: 12000,
        totalEmployerContributions: 8000,
        netPay: 88000,
      };

      const accounts: PayrollGlAccounts = {
        salaryExpenseId: 'acc-sal-exp',
        employerExpenseId: 'acc-emp-exp',
        salaryPayableId: 'acc-sal-pay',
        contributionsPayableId: 'acc-cont-pay',
      };

      const lines = PayrollAccountingService.buildPayrollGlJournalLines(totals, accounts);

      let totalDr = Decimal.zero();
      let totalCr = Decimal.zero();
      for (const l of lines) {
        totalDr = totalDr.plus(new Decimal(l.debit));
        totalCr = totalCr.plus(new Decimal(l.credit));
      }

      // Total Dr: Gross (100,000) + Employer Exp (8,000) = 108,000
      // Total Cr: Net Pay (88,000) + Withholdings & Contributions (8,000 + 12,000 = 20,000) = 108,000
      expect(totalDr.toNumber()).toBe(108000);
      expect(totalCr.toNumber()).toBe(108000);
      expect(totalDr.equals(totalCr)).toBe(true);
      expect(lines).toHaveLength(4);
    });

    it('rejects imbalanced payroll totals where gross - deductions != net', () => {
      const badTotals: PayrollTotals = {
        grossPay: 100000,
        totalDeductions: 10000,
        totalEmployerContributions: 5000,
        netPay: 95000, // Invalid: should be 90,000!
      };

      const accounts: PayrollGlAccounts = {
        salaryExpenseId: 'acc-sal-exp',
        employerExpenseId: 'acc-emp-exp',
        salaryPayableId: 'acc-sal-pay',
        contributionsPayableId: 'acc-cont-pay',
      };

      expect(() =>
        PayrollAccountingService.buildPayrollGlJournalLines(badTotals, accounts)
      ).toThrow(/Imbalanced payroll journal lines/i);
    });
  });

  describe('Pure Labor Costing & Availability Engine', () => {
    it('calculates work order direct labor costing accurately with Decimal arithmetic', () => {
      const timesheets = [
        {
          technicianId: 'tech-1',
          technicianName: 'Lead HVAC Specialist',
          durationHours: 6,
          isOvertime: false,
          laborRate: 150, // 6 * 150 = 900
        },
        {
          technicianId: 'tech-1',
          technicianName: 'Lead HVAC Specialist',
          durationHours: 2,
          isOvertime: true,
          laborRate: 150,
          overtimeRate: 225, // 2 * 225 = 450
        },
        {
          technicianId: 'tech-2',
          technicianName: 'Assistant Tech',
          durationHours: 4,
          isOvertime: false,
          laborRate: 80, // 4 * 80 = 320
        },
      ];

      const costResult = LaborCostService.calculateLaborCost(timesheets);

      expect(costResult.regularHours).toBe(10);
      expect(costResult.overtimeHours).toBe(2);
      expect(costResult.regularCost).toBe(1220); // 900 + 320
      expect(costResult.overtimeCost).toBe(450);  // 450
      expect(costResult.totalLaborCost).toBe(1670); // 1220 + 450
      expect(costResult.lineBreakdown).toHaveLength(3);
    });

    it('evaluates technician availability across leave, holidays, absence, and remaining capacity', () => {
      // On leave
      const leaveResult = LaborCostService.evaluateTechnicianAvailability({
        isOnLeave: true,
        serviceCapacityHours: 8,
      });
      expect(leaveResult.isAvailable).toBe(false);
      expect(leaveResult.reason).toMatch(/approved leave/i);

      // On holiday
      const holResult = LaborCostService.evaluateTechnicianAvailability({
        isHoliday: true,
        serviceCapacityHours: 8,
      });
      expect(holResult.isAvailable).toBe(false);
      expect(holResult.reason).toMatch(/declared holiday/i);

      // Absent
      const absentResult = LaborCostService.evaluateTechnicianAvailability({
        attendanceStatus: 'absent',
        serviceCapacityHours: 8,
      });
      expect(absentResult.isAvailable).toBe(false);
      expect(absentResult.reason).toMatch(/absent/i);

      // Fully allocated
      const fullyAllocated = LaborCostService.evaluateTechnicianAvailability({
        serviceCapacityHours: 8,
        assignedWorkOrderHours: 8,
      });
      expect(fullyAllocated.isAvailable).toBe(false);
      expect(fullyAllocated.reason).toMatch(/fully allocated/i);

      // Available with remaining capacity
      const available = LaborCostService.evaluateTechnicianAvailability({
        serviceCapacityHours: 8,
        assignedWorkOrderHours: 3,
      });
      expect(available.isAvailable).toBe(true);
      expect(available.remainingCapacityHours).toBe(5);
    });
  });

  describe('Database Integration', () => {
    it('resolves payroll accounts and verifies COA links', async () => {
      if (!isLiveDb) return;

      const accounts = await PayrollAccountingService.resolvePayrollAccounts(
        admin,
        DEMO_COMPANY_A
      );
      expect(accounts.salaryExpenseId).toBeDefined();
      expect(accounts.salaryPayableId).toBeDefined();
    });
  });
});

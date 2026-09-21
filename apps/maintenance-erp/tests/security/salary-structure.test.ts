/**
 * =============================================================================
 * Test Suite 6: Salary Structure, Component Configuration & Breakdown Engine
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { SalaryStructureService } from '../../src/services/salary-structure.service.js';
import {
  validateSalaryComponentCreate,
  validateSalaryStructureCreate,
} from '../../src/schemas/payroll.schema.js';

describe('Phase 6: Salary Structure & Component Breakdown Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('salary_components').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Salary Structure Breakdown Engine', () => {
    it('computes percentage and flat allowances, deductions, and employer contributions', () => {
      const baseSalary = 10000;
      const components = [
        {
          componentId: 'comp-hra',
          code: 'HRA',
          name: 'House Rent Allowance',
          type: 'earning' as const,
          calculationType: 'percentage' as const,
          percentage: 40, // 4,000
          isTaxable: true,
          isStatutory: false,
        },
        {
          componentId: 'comp-transport',
          code: 'TRANS',
          name: 'Transport Allowance',
          type: 'earning' as const,
          calculationType: 'flat' as const,
          amount: 1500, // 1,500
          isTaxable: true,
          isStatutory: false,
        },
        {
          componentId: 'comp-epf-emp',
          code: 'EPF',
          name: 'Employee Provident Fund',
          type: 'deduction' as const,
          calculationType: 'percentage' as const,
          percentage: 12, // 1,200
          isTaxable: false,
          isStatutory: true,
        },
        {
          componentId: 'comp-pt',
          code: 'PT',
          name: 'Professional Tax',
          type: 'deduction' as const,
          calculationType: 'flat' as const,
          amount: 200, // 200
          isTaxable: false,
          isStatutory: true,
        },
        {
          componentId: 'comp-epf-co',
          code: 'EPF_ER',
          name: 'Employer Provident Fund Match',
          type: 'employer_contribution' as const,
          calculationType: 'percentage' as const,
          percentage: 12, // 1,200
          isTaxable: false,
          isStatutory: true,
        },
      ];

      const breakdown = SalaryStructureService.computeStructureBreakdown(baseSalary, components);

      expect(breakdown.baseSalary).toBe(10000);
      expect(breakdown.totalEarnings).toBe(5500);
      expect(breakdown.grossPay).toBe(15500); // 10,000 + 4,000 + 1,500
      expect(breakdown.totalDeductions).toBe(1400); // 1,200 + 200
      expect(breakdown.totalEmployerContributions).toBe(1200); // 1,200
      expect(breakdown.netPay).toBe(14100); // 15,500 - 1,400

      expect(breakdown.earnings).toHaveLength(2);
      expect(breakdown.deductions).toHaveLength(2);
      expect(breakdown.employerContributions).toHaveLength(1);
    });

    it('validates salary component schema', () => {
      const valid = validateSalaryComponentCreate({
        companyId: DEMO_COMPANY_A,
        code: 'MED_ALLOW',
        name: 'Medical Allowance',
        componentType: 'earning',
        calculationType: 'flat',
        defaultAmount: 2500,
        isTaxable: true,
      });

      expect(valid.code).toBe('MED_ALLOW');
      expect(valid.componentType).toBe('earning');
      expect(valid.defaultAmount).toBe(2500);

      expect(() =>
        validateSalaryComponentCreate({
          companyId: DEMO_COMPANY_A,
          code: 'MED_ALLOW',
          name: 'Medical Allowance',
          componentType: 'invalid_type' as any,
        })
      ).toThrow(/componentType must be one of/i);
    });

    it('validates salary structure create schema with nested components', () => {
      const valid = validateSalaryStructureCreate({
        companyId: DEMO_COMPANY_A,
        code: 'ENG-LVL3',
        name: 'Senior Systems Engineer Compensation Package',
        components: [
          {
            componentId: 'comp-1',
            calculationType: 'percentage',
            percentage: 30,
            sortOrder: 1,
          },
          {
            componentId: 'comp-2',
            calculationType: 'flat',
            amount: 500,
            sortOrder: 2,
          },
        ],
      });

      expect(valid.code).toBe('ENG-LVL3');
      expect(valid.components).toHaveLength(2);
      expect(valid.components![0].percentage).toBe(30);
    });
  });

  describe('Database Integration', () => {
    it('creates salary component and structure in database', async () => {
      if (!isLiveDb) return;

      const comp = await SalaryStructureService.createSalaryComponent(admin, {
        companyId: DEMO_COMPANY_A,
        code: `COMP-${Date.now()}`,
        name: 'Field Hardship Allowance',
        componentType: 'earning',
        calculationType: 'flat',
        defaultAmount: 1200,
      });
      expect(comp.id).toBeDefined();

      const structure = await SalaryStructureService.createSalaryStructure(admin, {
        companyId: DEMO_COMPANY_A,
        code: `STR-${Date.now()}`,
        name: 'Heavy Equipment Field Crew Package',
        components: [
          {
            componentId: comp.id,
            calculationType: 'flat',
            amount: 1500,
            sortOrder: 1,
          },
        ],
      });

      expect(structure.id).toBeDefined();
      expect(structure.components).toHaveLength(1);
    });
  });
});

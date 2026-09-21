/**
 * =============================================================================
 * Test Suite 2: Technician Skills, Certifications & Promotion Job History
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { DepartmentService } from '../../src/services/department.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import {
  validateTechnicianProfileUpdate,
  validateJobHistoryCreate,
  validateSkillCreate,
  validateEmployeeSkillAssign,
} from '../../src/schemas/employee.schema.js';

describe('Phase 6: Technician Skills & Promotion Job History', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('skills').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Validation & Proficiency Logic (Pure)', () => {
    it('validates technician profile rates and capacity', () => {
      const valid = validateTechnicianProfileUpdate({
        isTechnician: true,
        laborRate: 185.5,
        overtimeRate: 278.25,
        serviceCapacity: 80,
        serviceRegions: ['Dubai North', 'Sharjah Industrial'],
      });

      expect(valid.isTechnician).toBe(true);
      expect(valid.laborRate).toBe(185.5);
      expect(valid.overtimeRate).toBe(278.25);
      expect(valid.serviceRegions).toContain('Dubai North');
    });

    it('rejects negative technician labor rates', () => {
      expect(() =>
        validateTechnicianProfileUpdate({
          isTechnician: true,
          laborRate: -50,
        })
      ).toThrow(/non-negative number/i);
    });

    it('validates skill assignment proficiency bounds (1 to 5)', () => {
      const valid = validateEmployeeSkillAssign({
        companyId: DEMO_COMPANY_A,
        employeeId: 'emp-123',
        skillId: 'skill-456',
        proficiencyLevel: 4,
        certified: true,
        certificateNumber: 'HVAC-CERT-9901',
      });

      expect(valid.proficiencyLevel).toBe(4);
      expect(valid.certified).toBe(true);

      // Level out of bounds
      expect(() =>
        validateEmployeeSkillAssign({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-123',
          skillId: 'skill-456',
          proficiencyLevel: 6, // max is 5
        })
      ).toThrow(/between 1 and 5/i);

      expect(() =>
        validateEmployeeSkillAssign({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-123',
          skillId: 'skill-456',
          proficiencyLevel: 0, // min is 1
        })
      ).toThrow(/between 1 and 5/i);
    });

    it('validates job history promotion/transfer DTO schema', () => {
      const valid = validateJobHistoryCreate({
        companyId: DEMO_COMPANY_A,
        employeeId: 'emp-123',
        effectiveDate: '2026-03-01',
        changeType: 'promotion',
        fromSalary: 75000,
        toSalary: 90000,
        reason: 'Annual Performance Appraisal Promotion to Lead Specialist',
      });

      expect(valid.changeType).toBe('promotion');
      expect(valid.fromSalary).toBe(75000);
      expect(valid.toSalary).toBe(90000);
    });

    it('rejects invalid change types in job history', () => {
      expect(() =>
        validateJobHistoryCreate({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-123',
          effectiveDate: '2026-03-01',
          changeType: 'random_change' as any,
        })
      ).toThrow(/changeType must be one of/i);
    });
  });

  describe('Database Integration', () => {
    it('creates skills, assigns to technician with certification, and records job history', async () => {
      if (!isLiveDb) return;

      const skill = await DepartmentService.createSkill(admin, {
        companyId: DEMO_COMPANY_A,
        code: `SKL-CHILLER-${Date.now()}`,
        name: 'Centrifugal Chiller Overhaul',
        category: 'HVAC Heavy',
      });
      expect(skill.id).toBeDefined();

      const emp = await EmployeeService.createEmployee(admin, {
        companyId: DEMO_COMPANY_A,
        firstName: 'Marcus',
        lastName: 'Vance',
        workEmail: `marcus.vance.${Date.now()}@maintenance-erp.test`,
        joiningDate: '2026-01-10',
        isTechnician: true,
        laborRate: 200,
      });

      // Assign skill
      const assigned = await DepartmentService.assignSkill(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        skillId: skill.id,
        proficiencyLevel: 5,
        certified: true,
        certificateNumber: 'DAIKIN-MASTER-2026',
      });
      expect(assigned.proficiency_level).toBe(5);
      expect(assigned.certified).toBe(true);

      // Record promotion in job history
      const history = await DepartmentService.recordJobHistory(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        effectiveDate: '2026-06-01',
        changeType: 'promotion',
        fromSalary: 80000,
        toSalary: 100000,
        reason: 'Promoted to Lead Chiller Diagnostic Technician',
      });
      expect(history.id).toBeDefined();

      // Retrieve skills list
      const skills = await DepartmentService.listEmployeeSkills(admin, emp.id);
      expect(skills.length).toBeGreaterThan(0);
    });
  });
});

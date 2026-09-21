/**
 * =============================================================================
 * Test Suite 1: Employee Master, Department Hierarchy & Designation Engine
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import { DepartmentService } from '../../src/services/department.service.js';
import {
  validateEmployeeCreate,
  validateDepartmentCreate,
  validateDesignationCreate,
} from '../../src/schemas/employee.schema.js';

describe('Phase 6: Employee Master & Department Hierarchy', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('departments').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Validation & State Machine Logic (Pure)', () => {
    it('validates employee creation DTO schema', () => {
      const valid = validateEmployeeCreate({
        companyId: DEMO_COMPANY_A,
        firstName: 'John',
        lastName: 'Doe',
        workEmail: 'john.doe@example.com',
        joiningDate: '2026-01-15',
        employmentStatus: 'ACTIVE',
        employmentType: 'FULL_TIME',
        laborRate: 150,
      });

      expect(valid.firstName).toBe('John');
      expect(valid.workEmail).toBe('john.doe@example.com');
      expect(valid.laborRate).toBe(150);
      expect(valid.displayName).toBe('John Doe');
    });

    it('rejects invalid employee emails or missing required fields', () => {
      expect(() =>
        validateEmployeeCreate({
          companyId: DEMO_COMPANY_A,
          firstName: 'John',
          lastName: 'Doe',
          workEmail: 'not-an-email',
          joiningDate: '2026-01-15',
        })
      ).toThrow(/workEmail/i);

      expect(() =>
        validateEmployeeCreate({
          companyId: DEMO_COMPANY_A,
          firstName: 'John',
          lastName: 'Doe',
          workEmail: 'john@example.com',
          joiningDate: 'invalid-date',
        })
      ).toThrow(/joiningDate/i);
    });

    it('enforces permitted employment status transitions', () => {
      // Allowed transitions
      expect(EmployeeService.isValidStatusTransition('ACTIVE', 'ON_NOTICE')).toBe(true);
      expect(EmployeeService.isValidStatusTransition('ACTIVE', 'ON_LEAVE')).toBe(true);
      expect(EmployeeService.isValidStatusTransition('ON_NOTICE', 'RESIGNED')).toBe(true);
      expect(EmployeeService.isValidStatusTransition('ON_NOTICE', 'TERMINATED')).toBe(true);
      expect(EmployeeService.isValidStatusTransition('RESIGNED', 'INACTIVE')).toBe(true);

      // Prohibited transitions
      expect(EmployeeService.isValidStatusTransition('TERMINATED', 'ACTIVE')).toBe(false);
      expect(EmployeeService.isValidStatusTransition('RESIGNED', 'ON_NOTICE')).toBe(false);
      expect(EmployeeService.isValidStatusTransition('TERMINATED', 'ON_LEAVE')).toBe(false);
    });

    it('detects direct and indirect circular references in department hierarchy', () => {
      const depts = [
        { id: 'dept-eng', parent_department_id: null },
        { id: 'dept-field', parent_department_id: 'dept-eng' },
        { id: 'dept-hvac', parent_department_id: 'dept-field' },
      ];

      // Self parent cycle
      expect(DepartmentService.detectCycle(depts, 'dept-eng', 'dept-eng')).toBe(true);

      // Indirect cycle: making dept-eng a child of dept-hvac -> eng -> field -> hvac -> eng
      expect(DepartmentService.detectCycle(depts, 'dept-eng', 'dept-hvac')).toBe(true);

      // Non-cyclic update: making dept-hvac a child of dept-eng directly
      expect(DepartmentService.detectCycle(depts, 'dept-hvac', 'dept-eng')).toBe(false);
    });

    it('builds a hierarchical department tree from flat array', () => {
      const flat = [
        { id: 'd1', code: 'EXEC', name: 'Executive', parent_department_id: null },
        { id: 'd2', code: 'OPS', name: 'Operations', parent_department_id: 'd1' },
        { id: 'd3', code: 'HVAC', name: 'HVAC Field', parent_department_id: 'd2' },
        { id: 'd4', code: 'PLUMB', name: 'Plumbing', parent_department_id: 'd2' },
      ];

      const tree = DepartmentService.buildDepartmentTree(flat);
      expect(tree).toHaveLength(1);
      expect(tree[0].code).toBe('EXEC');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].code).toBe('OPS');
      expect(tree[0].children[0].children).toHaveLength(2);
    });

    it('validates designation salary band limits', () => {
      expect(() =>
        validateDesignationCreate({
          companyId: DEMO_COMPANY_A,
          code: 'TECH-L1',
          title: 'Junior Technician',
          minSalary: 50000,
          maxSalary: 30000, // min > max
        })
      ).toThrow(/minSalary cannot be greater than maxSalary/i);
    });
  });

  describe('Database Integration', () => {
    it('creates departments, designations, and employees with relations', async () => {
      if (!isLiveDb) return;

      const dept = await DepartmentService.createDepartment(admin, {
        companyId: DEMO_COMPANY_A,
        code: `DEPT-${Date.now()}`,
        name: 'Technical Services Group',
      });
      expect(dept.id).toBeDefined();

      const desig = await DepartmentService.createDesignation(admin, {
        companyId: DEMO_COMPANY_A,
        code: `DSG-${Date.now()}`,
        title: 'Senior Field Specialist',
        minSalary: 60000,
        maxSalary: 120000,
      });
      expect(desig.id).toBeDefined();

      const emp = await EmployeeService.createEmployee(admin, {
        companyId: DEMO_COMPANY_A,
        firstName: 'Robert',
        lastName: 'Taylor',
        workEmail: `robert.taylor.${Date.now()}@maintenance-erp.test`,
        joiningDate: '2026-02-01',
        departmentId: dept.id,
        designationId: desig.id,
        isTechnician: true,
        laborRate: 175,
      });

      expect(emp.id).toBeDefined();
      expect(emp.department_id).toBe(dept.id);
      expect(emp.designation_id).toBe(desig.id);
      expect(emp.is_technician).toBe(true);
    });
  });
});

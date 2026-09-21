/**
 * =============================================================================
 * Test Suite 5: Leave Management, Policies, Balance Ledger & Overlap Detection
 * Maintenance Management ERP — Phase 6 HR Foundation
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { LeaveService, LeaveInterval } from '../../src/services/leave.service.js';
import { EmployeeService } from '../../src/services/employee.service.js';
import {
  validateLeaveTypeCreate,
  validateLeavePolicyCreate,
  validateLeaveRequestSubmit,
} from '../../src/schemas/attendance-leave.schema.js';

describe('Phase 6: Leave Management & Overlap Prevention', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('leave_types').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Overlap Detection & Calculation Logic', () => {
    it('calculates calendar days correctly including half days', () => {
      expect(LeaveService.calculateLeaveDays('2026-05-01', '2026-05-05')).toBe(5);
      expect(LeaveService.calculateLeaveDays('2026-05-01', '2026-05-01')).toBe(1);
      expect(LeaveService.calculateLeaveDays('2026-05-01', '2026-05-01', true)).toBe(0.5);
    });

    it('detects direct overlapping leave requests', () => {
      const existing: LeaveInterval[] = [
        { id: 'lev-1', startDate: '2026-06-01', endDate: '2026-06-10', status: 'approved' },
      ];

      // Overlapping start
      expect(LeaveService.checkLeaveOverlap(existing, '2026-06-05', '2026-06-15')).toBe(true);
      // Overlapping end
      expect(LeaveService.checkLeaveOverlap(existing, '2026-05-25', '2026-06-05')).toBe(true);
      // Enclosed overlap
      expect(LeaveService.checkLeaveOverlap(existing, '2026-06-02', '2026-06-08')).toBe(true);
      // Completely surrounding overlap
      expect(LeaveService.checkLeaveOverlap(existing, '2026-05-20', '2026-06-20')).toBe(true);
    });

    it('permits non-overlapping adjacent leave dates', () => {
      const existing: LeaveInterval[] = [
        { id: 'lev-1', startDate: '2026-06-01', endDate: '2026-06-05', status: 'approved' },
      ];

      // Starts next day (June 6)
      expect(LeaveService.checkLeaveOverlap(existing, '2026-06-06', '2026-06-10')).toBe(false);
      // Ends previous day (May 31)
      expect(LeaveService.checkLeaveOverlap(existing, '2026-05-25', '2026-05-31')).toBe(false);
    });

    it('ignores rejected or cancelled leaves during overlap checks', () => {
      const existing: LeaveInterval[] = [
        { id: 'lev-1', startDate: '2026-06-01', endDate: '2026-06-10', status: 'rejected' },
        { id: 'lev-2', startDate: '2026-06-15', endDate: '2026-06-20', status: 'cancelled' },
      ];

      expect(LeaveService.checkLeaveOverlap(existing, '2026-06-05', '2026-06-18')).toBe(false);
    });

    it('validates leave request submission DTO schema', () => {
      const valid = validateLeaveRequestSubmit({
        companyId: DEMO_COMPANY_A,
        employeeId: 'emp-10',
        leaveTypeId: 'type-annual',
        startDate: '2026-07-01',
        endDate: '2026-07-05',
        reason: 'Annual Family Summer Vacation',
      });

      expect(valid.startDate).toBe('2026-07-01');
      expect(valid.endDate).toBe('2026-07-05');
      expect(valid.reason).toBe('Annual Family Summer Vacation');

      // Start after End
      expect(() =>
        validateLeaveRequestSubmit({
          companyId: DEMO_COMPANY_A,
          employeeId: 'emp-10',
          leaveTypeId: 'type-annual',
          startDate: '2026-07-10',
          endDate: '2026-07-05',
        })
      ).toThrow(/startDate must be on or before endDate/i);
    });
  });

  describe('Database Integration', () => {
    it('creates leave type, policy, balance, and executes approval workflow', async () => {
      if (!isLiveDb) return;

      const leaveType = await LeaveService.createLeaveType(admin, {
        companyId: DEMO_COMPANY_A,
        code: `ANNUAL-${Date.now()}`,
        name: 'Paid Annual Leave',
        isPaid: true,
      });
      expect(leaveType.id).toBeDefined();

      const policy = await LeaveService.createLeavePolicy(admin, {
        companyId: DEMO_COMPANY_A,
        leaveTypeId: leaveType.id,
        annualAllocation: 24,
        allowHalfDay: true,
        allowNegativeBalance: false,
      });
      expect(policy.id).toBeDefined();

      const emp = await EmployeeService.createEmployee(admin, {
        companyId: DEMO_COMPANY_A,
        firstName: 'Farhan',
        lastName: 'Qureshi',
        workEmail: `farhan.qureshi.${Date.now()}@maintenance-erp.test`,
        joiningDate: '2026-01-01',
      });

      // Init balance
      await LeaveService.initializeLeaveBalance(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        year: 2026,
        openingBalance: 24,
      });

      // Submit leave request
      const leaveReq = await LeaveService.submitLeaveRequest(admin, {
        companyId: DEMO_COMPANY_A,
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        startDate: '2026-08-03',
        endDate: '2026-08-07',
        reason: 'Family wedding trip',
      });
      expect(leaveReq.id).toBeDefined();
      expect(leaveReq.status).toBe('submitted');
      expect(leaveReq.total_days).toBe(5);

      // Approve leave request
      const approved = await LeaveService.approveLeaveRequest(admin, {
        requestId: leaveReq.id,
        approverId: emp.id,
        approved: true,
      });
      expect(approved.status).toBe('approved');

      // Verify balance was deducted
      const bal = await LeaveService.getLeaveBalance(admin, emp.id, leaveType.id, 2026);
      expect(Number(bal.used_days)).toBe(5);
      expect(Number(bal.closing_balance)).toBe(19);
    });
  });
});

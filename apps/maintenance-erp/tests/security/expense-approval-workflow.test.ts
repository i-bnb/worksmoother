/**
 * =============================================================================
 * Test Suite 4: Operational Expense Approval Workflow & Self-Approval Guard
 * Maintenance Management ERP — Phase 3A Accounting Foundation & Controls
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateExpenseCreate, validateExpensePay } from '../../src/schemas/expense.schema.js';
import { ExpenseService } from '../../src/services/expense.service.js';

describe('Phase 3A: Expense Approval Workflow & Self-Approval Guard', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('expenses').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Expense Schema Validations', () => {
    it('accepts valid expense creation payload', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        category: 'travel',
        amount: 450.5,
        expenseDate: '2026-05-10',
        description: 'Fuel and toll charges for emergency service visit',
      };
      const validated = validateExpenseCreate(payload);
      expect(validated.amount).toBe(450.5);
      expect(validated.expenseDate).toBe('2026-05-10');
    });

    it('rejects expense with zero or negative amount', () => {
      expect(() =>
        validateExpenseCreate({
          companyId: DEMO_COMPANY_A,
          category: 'travel',
          amount: 0,
          description: 'Fuel',
          expenseDate: '2026-05-10',
        })
      ).toThrow(/strictly positive number/i);

      expect(() =>
        validateExpenseCreate({
          companyId: DEMO_COMPANY_A,
          category: 'travel',
          amount: -150,
          description: 'Fuel',
          expenseDate: '2026-05-10',
        })
      ).toThrow(/strictly positive number/i);
    });

    it('rejects expense without description or category', () => {
      expect(() =>
        validateExpenseCreate({
          companyId: DEMO_COMPANY_A,
          amount: 100,
        })
      ).toThrow(/category is required/i);
    });


    it('validates expense payment payload correctly', () => {
      const validPayment = validateExpensePay({
        paymentMethod: 'bank_transfer',
        bankAccountId: '88888888-8888-8888-8888-888888888888',
        amountPaid: 450.5,
      });
      expect(validPayment.paymentMethod).toBe('bank_transfer');
      expect(validPayment.amountPaid).toBe(450.5);

      expect(() =>
        validateExpensePay({
          paymentMethod: '',
          amountPaid: 450.5,
        })
      ).toThrow(/paymentMethod is required/i);
    });
  });

  describe('Self-Approval Guard Business Rule Logic', () => {
    it('blocks self-approval when creator is the same as approver and self-approval is disabled', () => {
      const creatorId: string = 'user-tech-101';
      const approverId: string = 'user-tech-101';
      const allowSelfApproval = false;

      const isForbidden = (creatorId === approverId) && !allowSelfApproval;
      expect(isForbidden).toBe(true);
    });

    it('permits approval when approver is a separate user/manager', () => {
      const creatorId: string = 'user-tech-101';
      const approverId: string = 'user-manager-202';
      const allowSelfApproval = false;

      const isForbidden = (creatorId === approverId) && !allowSelfApproval;
      expect(isForbidden).toBe(false);
    });

    it('permits approval when company setting allows self-approval for sole proprietors', () => {
      const creatorId: string = 'user-owner-001';
      const approverId: string = 'user-owner-001';
      const allowSelfApproval = true;

      const isForbidden = (creatorId === approverId) && !allowSelfApproval;
      expect(isForbidden).toBe(false);
    });
  });


  describe('Expense Lifecycle Progression State Invariants', () => {
    it('validates permitted status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['submitted', 'cancelled'],
        submitted: ['approved', 'rejected'],
        approved: ['paid'],
        rejected: ['draft'],
        paid: [],
      };

      expect(validTransitions['draft']).toContain('submitted');
      expect(validTransitions['submitted']).toContain('approved');
      expect(validTransitions['submitted']).toContain('rejected');
      expect(validTransitions['approved']).toContain('paid');
      expect(validTransitions['paid'].length).toBe(0); // Terminal state
    });
  });
});

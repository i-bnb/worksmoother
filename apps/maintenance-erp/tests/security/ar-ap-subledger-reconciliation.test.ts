/**
 * =============================================================================
 * Phase 11 - Test Suite 10: AR & AP Subledger-to-GL Reconciliation & Cash Position
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ArApReconciliationService } from '../../src/services/ar-ap-reconciliation.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: AR/AP Subledger Reconciliation & Cash Position', () => {
  const AR_GL_ACCOUNT_ID = 'gl-ar-control-1200';
  const AP_GL_ACCOUNT_ID = 'gl-ap-control-2010';

  it('reconciles AR subledger against GL control account balance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({
                    data: [
                      { grand_total: 50000.0, amount_paid: 20000.0 }, // Open: 30000
                      { grand_total: 20000.0, amount_paid: 5000.0 },  // Open: 15000
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [
                      { grand_total: 5000.0, amount_applied: 2000.0, refunded_amount: 0.0 }, // Unapplied: 3000
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      { amount: 10000.0, allocated_amount: 8000.0 }, // Unallocated: 2000
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                // Net GL Debit = 40000.0
                data: [
                  { debit: 70000.0, credit: 30000.0 },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    // Expected:
    // Open Invoices: 45000
    // Unapplied Credit Notes: 3000
    // Unallocated Payments: 2000
    // Net AR Subledger = 45000 - 3000 - 2000 = 40000
    // GL Balance = 70000 - 30000 = 40000
    // Variance = 0, isReconciled = true
    const result = await ArApReconciliationService.reconcileArSubledger(
      mockClient,
      DEMO_COMPANY_A,
      AR_GL_ACCOUNT_ID,
      '2026-09-30'
    );

    expect(result.openInvoiceReceivables).toBe(45000.0);
    expect(result.unappliedCreditNotes).toBe(3000.0);
    expect(result.unallocatedCustomerPayments).toBe(2000.0);
    expect(result.netSubledgerBalance).toBe(40000.0);
    expect(result.glControlAccountBalance).toBe(40000.0);
    expect(result.variance).toBe(0.0);
    expect(result.isReconciled).toBe(true);
  });

  it('detects variance when AP subledger and GL diverge', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({
                    data: [
                      { grand_total: 60000.0, amount_paid: 10000.0 }, // Open: 50000
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                // GL Credit balance: 48000 (differs from subledger 50000)
                data: [
                  { debit: 12000.0, credit: 60000.0 }, // 60000 - 12000 = 48000
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await ArApReconciliationService.reconcileApSubledger(
      mockClient,
      DEMO_COMPANY_A,
      AP_GL_ACCOUNT_ID,
      '2026-09-30'
    );

    expect(result.netSubledgerBalance).toBe(50000.0);
    expect(result.glControlAccountBalance).toBe(48000.0);
    expect(result.variance).toBe(-2000.0);
    expect(result.isReconciled).toBe(false);
  });

  it('aggregates consolidated cash position across all bank and treasury accounts', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'acc-1',
                        account_name: 'HDFC Current',
                        bank_name: 'HDFC',
                        account_number_last4: '1122',
                        account_type: 'current',
                        current_balance: 150000.0,
                        statement_balance: 140000.0,
                        cleared_balance: 140000.0,
                      },
                      {
                        id: 'acc-2',
                        account_name: 'ICICI Petty Cash',
                        bank_name: 'ICICI',
                        account_number_last4: '3344',
                        account_type: 'cash',
                        current_balance: 25000.0,
                        statement_balance: 25000.0,
                        cleared_balance: 25000.0,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const report = await ArApReconciliationService.getCashPosition(mockClient, DEMO_COMPANY_A);

    expect(report.totalBookCash).toBe(175000.0);
    expect(report.totalClearedCash).toBe(165000.0);
    expect(report.totalUnclearedDifference).toBe(10000.0); // 150000 - 140000
    expect(report.byType['current']).toBe(150000.0);
    expect(report.byType['cash']).toBe(25000.0);
    expect(report.accounts[0].accountNumberMasked).toBe('****1122');
  });
});

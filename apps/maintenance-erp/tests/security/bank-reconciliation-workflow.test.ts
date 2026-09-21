/**
 * =============================================================================
 * Phase 11 - Test Suite 3: Bank Reconciliation Workflow & Zero-Difference Guard
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { BankReconciliationService } from '../../src/services/bank-reconciliation.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Bank Reconciliation Workflow & Difference Guard', () => {
  const BANK_ACC_ID = 'bank-rec-acc-201';
  const SESSION_ID = 'rec-sess-201';
  const TX_CREDIT_ID = 'btx-cr-201';
  const TX_DEBIT_ID = 'btx-dr-201';

  it('starts reconciliation session with opening/closing balances and initial difference', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'REC-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: BANK_ACC_ID,
                      current_balance: 75000.0,
                      cleared_balance: 50000.0,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'bank_reconciliation_sessions') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.statement_opening_balance).toBe(50000.0);
              expect(payload.statement_closing_balance).toBe(75000.0);
              expect(payload.cleared_balance).toBe(50000.0);
              expect(payload.difference).toBe(25000.0); // 75000 - 50000
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: SESSION_ID, ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const session = await BankReconciliationService.startSession(mockClient, {
      companyId: DEMO_COMPANY_A,
      bankAccountId: BANK_ACC_ID,
      statementDate: '2026-09-30',
      statementOpeningBalance: 50000.0,
      statementClosingBalance: 75000.0,
    });

    expect(session.session_number).toBe('REC-2026-0001');
    expect(session.difference).toBe(25000.0);
  });

  it('manually matches a transaction and updates cleared balance and difference', async () => {
    let currentCleared = 50000.0;
    let currentDiff = 25000.0;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_reconciliation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: SESSION_ID,
                      company_id: DEMO_COMPANY_A,
                      bank_account_id: BANK_ACC_ID,
                      statement_closing_balance: 75000.0,
                      cleared_balance: currentCleared,
                      status: 'in_progress',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              currentCleared = payload.cleared_balance;
              currentDiff = payload.difference;
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: SESSION_ID,
                        cleared_balance: currentCleared,
                        difference: currentDiff,
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'bank_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: TX_CREDIT_ID,
                    amount: 25000.0,
                    transaction_type: 'credit',
                    reconciliation_status: 'UNMATCHED',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'bank_reconciliation_matches') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'match-001', matched_amount: 25000.0 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await BankReconciliationService.manualMatch(mockClient, {
      companyId: DEMO_COMPANY_A,
      sessionId: SESSION_ID,
      bankTransactionId: TX_CREDIT_ID,
      matchedEntityType: 'customer_payment',
      matchedEntityId: 'pmt-101',
      matchedAmount: 25000.0,
    });

    expect(result.session.cleared_balance).toBe(75000.0);
    expect(result.session.difference).toBe(0.0);
  });

  it('rejects completing reconciliation session when difference is not zero', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_reconciliation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: SESSION_ID,
                      company_id: DEMO_COMPANY_A,
                      difference: 500.0, // Non-zero difference
                      status: 'in_progress',
                    },
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

    await expect(
      BankReconciliationService.completeSession(mockClient, DEMO_COMPANY_A, SESSION_ID)
    ).rejects.toThrow('Difference must be 0.000 before completing');
  });

  it('successfully completes session when difference is 0 and updates bank account', async () => {
    let sessionStatus = 'in_progress';
    let accountReconciledDate = null;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_reconciliation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: SESSION_ID,
                      company_id: DEMO_COMPANY_A,
                      bank_account_id: BANK_ACC_ID,
                      statement_date: '2026-09-30',
                      statement_closing_balance: 75000.0,
                      cleared_balance: 75000.0,
                      difference: 0.0,
                      status: sessionStatus,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              sessionStatus = payload.status;
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: SESSION_ID, status: 'reconciled' },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'bank_reconciliation_matches') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ bank_transaction_id: TX_CREDIT_ID }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'bank_transactions') {
          return {
            update: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'bank_accounts') {
          return {
            update: vi.fn().mockImplementation((payload: any) => {
              accountReconciledDate = payload.last_reconciled_date;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const completed = await BankReconciliationService.completeSession(
      mockClient,
      DEMO_COMPANY_A,
      SESSION_ID,
      'user-cfo-1'
    );

    expect(completed.status).toBe('reconciled');
    expect(accountReconciledDate).toBe('2026-09-30');
  });
});

/**
 * =============================================================================
 * Phase 11 - Test Suite 7: Customer & Supplier Refunds, Bounds & Idempotency
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { FinancialRefundService } from '../../src/services/financial-refund.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Customer & Supplier Refunds', () => {
  const CUSTOMER_ID = 'cust-ref-601';
  const CN_ID = 'cn-ref-601';
  const BANK_ACC_ID = 'bank-ref-601';
  const IDEMPOTENCY_KEY = 'idem-ref-778899';

  it('rejects refund if amount exceeds credit note remaining balance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'financial_refunds') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: BANK_ACC_ID,
                      account_name: 'Main Bank',
                      current_balance: 100000.0,
                    },
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
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: CN_ID,
                      grand_total: 5000.0,
                      amount_applied: 4000.0,
                      refunded_amount: 0.0,
                      amount_remaining: 1000.0, // Only 1000 left
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

    // Trying to refund 2500 when only 1000 is available
    await expect(
      FinancialRefundService.processRefund(mockClient, {
        companyId: DEMO_COMPANY_A,
        refundType: 'customer_refund',
        partyId: CUSTOMER_ID,
        sourceType: 'credit_note',
        sourceId: CN_ID,
        bankAccountId: BANK_ACC_ID,
        amount: 2500.0,
        reason: 'Customer requested excess cash return',
      })
    ).rejects.toThrow('exceeds credit note refundable balance');
  });

  it('processes customer refund, decrements bank balance and posts GL', async () => {
    let currentBankBal = 50000.0;
    let cnRefunded = 0.0;

    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'REF-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'financial_refunds') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.amount).toBe(2000.0);
              expect(payload.refund_type).toBe('customer_refund');
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'ref-rec-001', ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: BANK_ACC_ID,
                      account_name: 'Main Bank',
                      current_balance: currentBankBal,
                      gl_account_id: 'gl-bank-1010',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              currentBankBal = payload.current_balance;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: CN_ID,
                      grand_total: 5000.0,
                      amount_applied: 0.0,
                      refunded_amount: cnRefunded,
                      amount_remaining: 5000.0,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              cnRefunded = payload.refunded_amount;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-ref-001', journal_number: 'JRN-2026-0006' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify: Debit AR (2000) = Credit Bank (2000)
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(2000.0);
              expect(credit).toBe(2000.0);
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await FinancialRefundService.processRefund(
      mockClient,
      {
        companyId: DEMO_COMPANY_A,
        refundType: 'customer_refund',
        partyId: CUSTOMER_ID,
        sourceType: 'credit_note',
        sourceId: CN_ID,
        bankAccountId: BANK_ACC_ID,
        amount: 2000.0,
        reason: 'Customer credit cash settlement',
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      'cfo-user-1',
      {
        arOrApAccountId: 'gl-ar-1200',
        bankGlAccountId: 'gl-bank-1010',
      }
    );

    expect(result.newBankBalance).toBe(48000.0); // 50000 - 2000
    expect(currentBankBal).toBe(48000.0);
    expect(cnRefunded).toBe(2000.0);
    expect(result.isDuplicate).toBe(false);
  });

  it('safely handles idempotency key replay without double debiting', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'financial_refunds') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'ref-existing-999',
                      refund_number: 'REF-2026-0001',
                      amount: 2000.0,
                      idempotency_key: IDEMPOTENCY_KEY,
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

    const result = await FinancialRefundService.processRefund(mockClient, {
      companyId: DEMO_COMPANY_A,
      refundType: 'customer_refund',
      partyId: CUSTOMER_ID,
      sourceType: 'credit_note',
      sourceId: CN_ID,
      bankAccountId: BANK_ACC_ID,
      amount: 2000.0,
      reason: 'Retry payload',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.refund.id).toBe('ref-existing-999');
  });
});

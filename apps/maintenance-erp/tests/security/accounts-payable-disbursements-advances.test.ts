/**
 * =============================================================================
 * Phase 10 - Test Suite 9: AP Disbursements, Advance Settlements & Payment Reversals
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { AccountsPayablePaymentService } from '../../src/services/accounts-payable-payment.service.js';
import {
  validateSupplierPaymentCreate,
  validateSupplierPaymentReversal,
} from '../../src/schemas/accounts-payable.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: AP Disbursements, Advance Settlements & Payment Reversals', () => {
  const SUPPLIER_ID = 'sup-ap-901';
  const BILL_ID = 'bill-ap-901';
  const ADVANCE_PAYMENT_ID = 'pay-adv-901';
  const STANDARD_PAYMENT_ID = 'pay-std-901';

  it('records a partial supplier bill payment and updates bill balance and status', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      supplierId: SUPPLIER_ID,
      billId: BILL_ID,
      amount: 2000.0,
      paymentType: 'standard',
      referenceNumber: 'CHK-998811',
    };

    const validated = validateSupplierPaymentCreate(rawDto);

    const mockClient = {
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'generate_document_number') return Promise.resolve({ data: 'PAY-1001', error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    grand_total: 5000.0,
                    amount_paid: 0.0,
                    amount_due: 5000.0,
                    status: 'posted',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.amount_paid).toBe(2000.0);
              expect(payload.amount_due).toBe(3000.0);
              expect(payload.status).toBe('partially_paid');
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: BILL_ID, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'supplier_payments') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => ({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: STANDARD_PAYMENT_ID, ...payload },
                  error: null,
                }),
              }),
            })),
          };
        }
        if (table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const result = await AccountsPayablePaymentService.recordPayment(mockClient, validated, 'acc-user-1');
    expect(result.payment.id).toBe(STANDARD_PAYMENT_ID);
    expect(result.updatedBill?.status).toBe('partially_paid');
    expect(result.updatedBill?.amount_due).toBe(3000.0);
  });

  it('prevents overpayment: rejects payment amount exceeding bill balance due', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      supplierId: SUPPLIER_ID,
      billId: BILL_ID,
      amount: 6000.0, // Bill balance is only 5000!
    };

    const validated = validateSupplierPaymentCreate(rawDto);

    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'PAY-1002', error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: BILL_ID,
                grand_total: 5000.0,
                amount_paid: 0.0,
                amount_due: 5000.0,
                status: 'posted',
              },
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      AccountsPayablePaymentService.recordPayment(mockClient, validated, 'acc-user-1')
    ).rejects.toThrow('Payment amount (6000) exceeds outstanding bill balance (5000)');
  });

  it('applies an advance payment against an outstanding supplier bill', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'SPAY-2001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_payments') {
          return {
            select: vi.fn().mockImplementation((fields: string) => {
              if (fields === 'amount') {
                // Previously applied query
                return {
                  eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockResolvedValue({
                      data: [], // 0 previously applied
                      error: null,
                    }),
                  }),
                };
              }
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: ADVANCE_PAYMENT_ID,
                      company_id: DEMO_COMPANY_A,
                      supplier_id: SUPPLIER_ID,
                      payment_type: 'advance',
                      payment_number: 'ADV-001',
                      amount: 10000.0, // Total advance: 10,000
                      currency: 'AED',
                      reversed_at: null,
                    },
                    error: null,
                  }),
                }),
              };
            }),
            insert: vi.fn().mockImplementation((payload: any) => ({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'settle-pay-1', ...payload },
                  error: null,
                }),
              }),
            })),
          };
        }
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    supplier_id: SUPPLIER_ID,
                    grand_total: 4000.0,
                    amount_paid: 0.0,
                    amount_due: 4000.0,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.amount_paid).toBe(4000.0);
              expect(payload.amount_due).toBe(0.0);
              expect(payload.status).toBe('paid');
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: BILL_ID, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const settlement = await AccountsPayablePaymentService.applyAdvanceToBill(
      mockClient,
      ADVANCE_PAYMENT_ID,
      BILL_ID,
      4000.0,
      'acc-user-1'
    );

    expect(settlement.updatedBill?.status).toBe('paid');
    expect(settlement.remainingAdvanceBalance).toBe(6000.0); // 10,000 - 4,000 = 6,000
  });

  it('reverses a supplier payment with mandatory reason and reinstates bill balance', async () => {
    const reversalDto = validateSupplierPaymentReversal({
      paymentId: STANDARD_PAYMENT_ID,
      reversalReason: 'Check bounced due to incorrect vendor bank details',
    });

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: STANDARD_PAYMENT_ID,
                    company_id: DEMO_COMPANY_A,
                    supplier_id: SUPPLIER_ID,
                    bill_id: BILL_ID,
                    payment_number: 'PAY-1001',
                    amount: 2000.0,
                    reversed_at: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => ({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: STANDARD_PAYMENT_ID,
                      reversed_at: payload.reversed_at,
                      reversal_reason: payload.reversal_reason,
                      status: 'cancelled',
                    },
                    error: null,
                  }),
                }),
              }),
            })),
          };
        }
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    grand_total: 5000.0,
                    amount_paid: 2000.0,
                    amount_due: 3000.0,
                    status: 'partially_paid',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              // Reinstated: paid reverts to 0, due reverts to 5000, status reverts to posted
              expect(payload.amount_paid).toBe(0.0);
              expect(payload.amount_due).toBe(5000.0);
              expect(payload.status).toBe('posted');
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: BILL_ID, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const result = await AccountsPayablePaymentService.reversePayment(
      mockClient,
      reversalDto,
      'acc-supervisor-1'
    );

    expect(result.reversedPayment.status).toBe('cancelled');
    expect(result.reinstatedBill?.amount_due).toBe(5000.0);
    expect(result.reinstatedBill?.status).toBe('posted');
  });
});

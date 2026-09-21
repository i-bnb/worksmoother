/**
 * =============================================================================
 * Phase 11 - Test Suite 8: Multi-Invoice Payment Allocation & Advance Waterfall
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { PaymentAllocationService } from '../../src/services/payment-allocation.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Payment Allocation Engine & Bounds', () => {
  const PAYMENT_ID = 'pmt-alloc-701';
  const INV_1_ID = 'inv-alloc-101';
  const INV_2_ID = 'inv-alloc-102';

  it('rejects multi-invoice allocation if total exceeds payment unallocated balance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: PAYMENT_ID,
                      amount: 5000.0,
                      allocated_amount: 3000.0,
                      unallocated_amount: 2000.0, // Only 2000 available
                      status: 'received',
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

    // Allocating 1500 + 1000 = 2500 > 2000
    await expect(
      PaymentAllocationService.allocatePaymentMultiInvoice(
        mockClient,
        DEMO_COMPANY_A,
        PAYMENT_ID,
        [
          { invoiceId: INV_1_ID, amount: 1500.0 },
          { invoiceId: INV_2_ID, amount: 1000.0 },
        ]
      )
    ).rejects.toThrow('exceeds payment unallocated balance');
  });

  it('rejects allocation if amount exceeds individual invoice balance due', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: PAYMENT_ID,
                      amount: 10000.0,
                      allocated_amount: 0.0,
                      unallocated_amount: 10000.0,
                      status: 'received',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: INV_1_ID,
                      invoice_number: 'INV-2026-0001',
                      grand_total: 3000.0,
                      amount_paid: 2000.0, // Due: 1000
                      status: 'partially_paid',
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

    // Attempting to allocate 1500 to invoice with only 1000 due
    await expect(
      PaymentAllocationService.allocatePaymentMultiInvoice(
        mockClient,
        DEMO_COMPANY_A,
        PAYMENT_ID,
        [{ invoiceId: INV_1_ID, amount: 1500.0 }]
      )
    ).rejects.toThrow('exceeds outstanding balance');
  });

  it('distributes payment across multiple invoices and updates status to paid / partially_paid', async () => {
    const invoiceStates: Record<string, { paid: number; status: string }> = {
      [INV_1_ID]: { paid: 1000.0, status: 'partially_paid' }, // grand_total = 3000 -> due 2000
      [INV_2_ID]: { paid: 0.0, status: 'issued' },           // grand_total = 5000 -> due 5000
    };

    let paymentAllocated = 0.0;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: PAYMENT_ID,
                      amount: 6000.0,
                      allocated_amount: 0.0,
                      unallocated_amount: 6000.0,
                      status: 'received',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              paymentAllocated = payload.allocated_amount;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation((col: string, invId: string) => {
                  const state = invoiceStates[invId];
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: invId,
                        invoice_number: `INV-${invId}`,
                        grand_total: invId === INV_1_ID ? 3000.0 : 5000.0,
                        amount_paid: state.paid,
                        status: state.status,
                      },
                      error: null,
                    }),
                  };
                }),
              }),
            })),
            update: vi.fn().mockImplementation((payload: any) => ({
              eq: vi.fn().mockImplementation((col: string, invId: string) => {
                invoiceStates[invId].paid = payload.amount_paid;
                invoiceStates[invId].status = payload.status;
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        if (table === 'payment_allocations') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'alloc-1' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    // Allocate: 2000 to INV_1 (full settlement), 4000 to INV_2 (partial settlement)
    const result = await PaymentAllocationService.allocatePaymentMultiInvoice(
      mockClient,
      DEMO_COMPANY_A,
      PAYMENT_ID,
      [
        { invoiceId: INV_1_ID, amount: 2000.0 },
        { invoiceId: INV_2_ID, amount: 4000.0 },
      ]
    );

    expect(result.totalAllocated).toBe(6000.0);
    expect(result.remainingUnallocated).toBe(0.0);
    expect(paymentAllocated).toBe(6000.0);

    expect(invoiceStates[INV_1_ID].paid).toBe(3000.0);
    expect(invoiceStates[INV_1_ID].status).toBe('paid'); // Fully settled

    expect(invoiceStates[INV_2_ID].paid).toBe(4000.0);
    expect(invoiceStates[INV_2_ID].status).toBe('partially_paid'); // 1000 still due
  });
});

/**
 * =============================================================================
 * Phase 10 - Test Suite 8: 3-Way Matching Engine & Variance Analysis
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ThreeWayMatchingService } from '../../src/services/three-way-matching.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: 3-Way Matching Engine & Variance Analysis', () => {
  const BILL_ID = 'bill-uuid-801';
  const PO_ID = 'po-uuid-801';
  const GRN_ID = 'grn-uuid-801';
  const ITEM_ID = 'item-pump-01';

  it('flags status as matched when Bill, PO, and GRN accepted quantities match within tolerance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    company_id: DEMO_COMPANY_A,
                    supplier_id: 'sup-1',
                    po_id: PO_ID,
                    goods_receipt_id: GRN_ID,
                    lines: [
                      {
                        id: 'bline-1',
                        item_id: ITEM_ID,
                        description: 'Centrifugal Pump 2HP',
                        quantity: 10,
                        unit_price: 500.0,
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.matching_status).toBe('matched');
              expect(payload.matching_variance).toHaveLength(0);
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: PO_ID,
                    lines: [
                      {
                        id: 'poline-1',
                        item_id: ITEM_ID,
                        quantity: 10,
                        unit_price: 500.0, // Same price!
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    po_line_id: 'poline-1',
                    item_id: ITEM_ID,
                    accepted_quantity: 10, // Same quantity!
                    received_quantity: 10,
                  },
                ],
                error: null,
              }),
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

    const result = await ThreeWayMatchingService.matchSupplierBill(
      mockClient,
      { billId: BILL_ID, priceTolerancePercent: 1.0, quantityTolerancePercent: 2.0 },
      'accountant-1'
    );

    expect(result.matchingStatus).toBe('matched');
    expect(result.variances).toHaveLength(0);
  });

  it('detects price variance when bill price exceeds PO price beyond tolerance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    company_id: DEMO_COMPANY_A,
                    supplier_id: 'sup-1',
                    po_id: PO_ID,
                    goods_receipt_id: GRN_ID,
                    lines: [
                      {
                        id: 'bline-1',
                        item_id: ITEM_ID,
                        description: 'Centrifugal Pump 2HP',
                        quantity: 10,
                        unit_price: 550.0, // 550 vs 500 is a 10% price variance! (> 1% tolerance)
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.matching_status).toBe('price_variance');
              expect(payload.matching_variance[0].issue).toBe('Price variance');
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: PO_ID,
                    lines: [
                      {
                        id: 'poline-1',
                        item_id: ITEM_ID,
                        quantity: 10,
                        unit_price: 500.0,
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    po_line_id: 'poline-1',
                    item_id: ITEM_ID,
                    accepted_quantity: 10,
                  },
                ],
                error: null,
              }),
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

    const result = await ThreeWayMatchingService.matchSupplierBill(
      mockClient,
      { billId: BILL_ID, priceTolerancePercent: 1.0, quantityTolerancePercent: 2.0 },
      'accountant-1'
    );

    expect(result.matchingStatus).toBe('price_variance');
    expect(result.variances).toHaveLength(1);
    expect(result.variances[0].issue).toBe('Price variance');
  });

  it('detects quantity variance when billed quantity differs from accepted GRN quantity', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: BILL_ID,
                    company_id: DEMO_COMPANY_A,
                    supplier_id: 'sup-1',
                    po_id: PO_ID,
                    goods_receipt_id: GRN_ID,
                    lines: [
                      {
                        id: 'bline-1',
                        item_id: ITEM_ID,
                        description: 'Centrifugal Pump 2HP',
                        quantity: 10, // Vendor billed for 10
                        unit_price: 500.0,
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.matching_status).toBe('quantity_variance');
              expect(payload.matching_variance[0].issue).toBe('Quantity variance');
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: PO_ID,
                    lines: [
                      {
                        id: 'poline-1',
                        item_id: ITEM_ID,
                        quantity: 10,
                        unit_price: 500.0,
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    po_line_id: 'poline-1',
                    item_id: ITEM_ID,
                    accepted_quantity: 6, // Only 6 were accepted in GRN! (40% variance > 2% tol)
                  },
                ],
                error: null,
              }),
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

    const result = await ThreeWayMatchingService.matchSupplierBill(
      mockClient,
      { billId: BILL_ID, priceTolerancePercent: 1.0, quantityTolerancePercent: 2.0 },
      'accountant-1'
    );

    expect(result.matchingStatus).toBe('quantity_variance');
    expect(result.variances).toHaveLength(1);
    expect(result.variances[0].issue).toBe('Quantity variance');
  });

  it('allows authorized manual override of matching status with required justification', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: BILL_ID,
                matching_status: 'price_variance',
                matching_variance: [{ issue: 'Price variance' }],
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
                  id: BILL_ID,
                  matching_status: payload.matching_status,
                  matching_variance: payload.matching_variance,
                },
                error: null,
              }),
            }),
          }),
        })),
      }),
    } as any;

    const overridden = await ThreeWayMatchingService.overrideMatchingStatus(
      mockClient,
      BILL_ID,
      'matched',
      'Vendor provided revised price quote approval from CFO',
      'cfo-user-1'
    );

    expect(overridden.matching_status).toBe('matched');
    expect(overridden.matching_variance[1].override).toBe(true);
    expect(overridden.matching_variance[1].reason).toContain('CFO');
  });
});

/**
 * =============================================================================
 * Phase 10 - Test Suite 6: Goods Receipt Quality Inspection & Partial Delivery
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { GoodsReceiptService } from '../../src/services/goods-receipt.service.js';
import { validateGoodsReceiptCreate } from '../../src/schemas/procurement-receipt.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Goods Receipt Quality Inspection & Partial Delivery', () => {
  const PO_ID = 'po-grn-501';
  const PO_LINE_ID = 'poline-501';
  const WAREHOUSE_ID = 'loc-wh-main';

  it('rejects receipt if Purchase Order is not in approved or sent status', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      poId: PO_ID,
      locationId: WAREHOUSE_ID,
      lines: [
        {
          poLineId: PO_LINE_ID,
          itemId: 'item-fan-1',
          quantityReceived: 5,
        },
      ],
    };

    const validated = validateGoodsReceiptCreate(rawDto);

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: PO_ID, status: 'draft' }, // Draft!
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      GoodsReceiptService.processGoodsReceipt(mockClient, validated, 'store-user-1')
    ).rejects.toThrow('Cannot receive goods: Purchase Order is in "draft" status');
  });

  it('rejects over-receiving beyond the remaining quantity on the PO line', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      poId: PO_ID,
      locationId: WAREHOUSE_ID,
      lines: [
        {
          poLineId: PO_LINE_ID,
          itemId: 'item-fan-1',
          quantityReceived: 10, // Attempting 10
        },
      ],
    };

    const validated = validateGoodsReceiptCreate(rawDto);

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: PO_ID, status: 'approved' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'purchase_order_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: PO_LINE_ID,
                    item_id: 'item-fan-1',
                    quantity: 5, // Ordered only 5!
                    received_quantity: 0,
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    await expect(
      GoodsReceiptService.processGoodsReceipt(mockClient, validated, 'store-user-1')
    ).rejects.toThrow('Over-receiving rejected: Line for item item-fan-1 ordered 5, already received 0, attempted to receive 10');
  });

  it('processes quality inspection breakdown (accepted vs damaged vs rejected)', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      poId: PO_ID,
      locationId: WAREHOUSE_ID,
      lines: [
        {
          poLineId: PO_LINE_ID,
          itemId: 'item-fan-1',
          quantityReceived: 10,
          acceptedQuantity: 7,
          damagedQuantity: 2,
          rejectedQuantity: 1,
          inspectionStatus: 'accepted',
          rejectionReason: '1 unit dented housing, 2 damaged in transit',
        },
      ],
    };

    const validated = validateGoodsReceiptCreate(rawDto);
    let lineInserted = false;
    let poUpdated = false;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: PO_ID, status: 'approved' },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              poUpdated = true;
              expect(payload.status).toBe('received'); // 10 out of 10 delivered
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'purchase_order_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: PO_LINE_ID,
                    item_id: 'item-fan-1',
                    quantity: 10,
                    received_quantity: 0,
                  },
                ],
                error: null,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'goods_receipts') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'grn-1', receipt_number: 'GRN-9999' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              lineInserted = true;
              expect(payload.quantity_received).toBe(10);
              expect(payload.accepted_quantity).toBe(7);
              expect(payload.damaged_quantity).toBe(2);
              expect(payload.rejected_quantity).toBe(1);
              expect(payload.rejection_reason).toContain('dented housing');
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }
        if (table === 'stock_movements' || table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const result = await GoodsReceiptService.processGoodsReceipt(mockClient, validated, 'store-user-1');
    expect(result.receiptId).toBe('grn-1');
    expect(result.poStatus).toBe('received');
    expect(lineInserted).toBe(true);
    expect(poUpdated).toBe(true);
  });
});

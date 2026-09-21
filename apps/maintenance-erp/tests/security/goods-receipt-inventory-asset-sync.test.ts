/**
 * =============================================================================
 * Phase 10 - Test Suite 7: Goods Receipt Inventory Stock & Serialized Asset Sync
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { GoodsReceiptService } from '../../src/services/goods-receipt.service.js';
import { validateGoodsReceiptCreate } from '../../src/schemas/procurement-receipt.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Goods Receipt Inventory Stock & Serialized Asset Sync', () => {
  const PO_ID = 'po-sync-601';
  const PO_LINE_ID = 'poline-sync-601';
  const WAREHOUSE_ID = 'wh-loc-sync';

  it('only increments inventory stock ledger for accepted quantity (quarantining damaged/rejected)', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      poId: PO_ID,
      locationId: WAREHOUSE_ID,
      lines: [
        {
          poLineId: PO_LINE_ID,
          itemId: 'item-compressor-5hp',
          quantityReceived: 10,
          acceptedQuantity: 6, // 6 accepted
          damagedQuantity: 2,  // 2 damaged
          rejectedQuantity: 2, // 2 rejected
        },
      ],
    };

    const validated = validateGoodsReceiptCreate(rawDto);
    let stockMovementQty = 0;

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
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
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
                    item_id: 'item-compressor-5hp',
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
                  data: { id: 'grn-sync-1', receipt_number: 'GRN-SYNC-1' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'stock_movements') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              stockMovementQty = payload.quantity;
              expect(payload.movement_type).toBe('purchase_receipt');
              expect(payload.item_id).toBe('item-compressor-5hp');
              return Promise.resolve({ data: null, error: null });
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

    await GoodsReceiptService.processGoodsReceipt(mockClient, validated, 'store-user-2');

    // Crucial check: 6 units added to stock, NOT 10!
    expect(stockMovementQty).toBe(6);
  });

  it('automatically registers serialized equipment asset in customer_assets when serial number is present', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      poId: PO_ID,
      locationId: WAREHOUSE_ID,
      lines: [
        {
          poLineId: PO_LINE_ID,
          itemId: 'item-generator-20kva',
          quantityReceived: 1,
          acceptedQuantity: 1,
          serialNumber: 'SN-GEN-2026-999',
          warrantyEndDate: '2028-04-01',
        },
      ],
    };

    const validated = validateGoodsReceiptCreate(rawDto);
    let assetCreated = false;

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
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
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
                    item_id: 'item-generator-20kva',
                    quantity: 1,
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
        if (table === 'customer_assets') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              assetCreated = true;
              expect(payload.serial_number).toBe('SN-GEN-2026-999');
              expect(payload.asset_code).toBe('EQ-SN-GEN-2026-999');
              expect(payload.warranty_end_date).toBe('2028-04-01');
              return {
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'asset-new-777' },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'goods_receipts') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'grn-sync-2', receipt_number: 'GRN-SYNC-2' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipt_lines') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.created_asset_id).toBe('asset-new-777');
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

    await GoodsReceiptService.processGoodsReceipt(mockClient, validated, 'store-user-2');
    expect(assetCreated).toBe(true);
  });
});

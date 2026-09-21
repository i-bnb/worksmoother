/**
 * =============================================================================
 * Phase 10 - Test Suite 4: Purchase Order Approval & Immutable Revisions
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcurementOrderService } from '../../src/services/procurement-order.service.js';
import { validatePurchaseOrderCreate, validatePurchaseOrderUpdate } from '../../src/schemas/procurement-order.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Purchase Order Approval & Immutable Revisions', () => {
  const PO_ID = 'po-uuid-301';
  const ACTIVE_SUPPLIER_ID = 'sup-active-01';
  const BLACKLISTED_SUPPLIER_ID = 'sup-blacklisted-02';

  it('rejects purchase order creation if supplier is blacklisted or suspended', async () => {
    const rawPO = {
      companyId: DEMO_COMPANY_A,
      supplierId: BLACKLISTED_SUPPLIER_ID,
      lines: [
        {
          itemId: 'item-01',
          quantity: 5,
          unitPrice: 100,
        },
      ],
    };

    const validated = validatePurchaseOrderCreate(rawPO);

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: BLACKLISTED_SUPPLIER_ID,
                  name: 'Bad Vendor Inc',
                  status: 'BLACKLISTED',
                  is_active: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      ProcurementOrderService.createPurchaseOrder(mockClient, validated, 'buyer-1')
    ).rejects.toThrow('Supplier "Bad Vendor Inc" is currently BLACKLISTED');
  });

  it('creates purchase order and flags as draft when amount exceeds approval threshold', async () => {
    const rawPO = {
      companyId: DEMO_COMPANY_A,
      supplierId: ACTIVE_SUPPLIER_ID,
      lines: [
        {
          itemId: 'item-motor-01',
          quantity: 5,
          unitPrice: 3000, // 5 * 3000 = 15,000 > threshold 10,000
          taxRate: 5.0,
        },
      ],
    };

    const validated = validatePurchaseOrderCreate(rawPO);

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'suppliers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: ACTIVE_SUPPLIER_ID,
                      name: 'Reliable Motors',
                      status: 'ACTIVE',
                      is_active: true,
                      payment_terms_days: 30,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { po_approval_threshold: 10000 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'purchase_orders') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.status).toBe('draft'); // Requires approval!
              expect(payload.total_amount).toBe(15750); // 15000 + 5% tax (750)
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: PO_ID, ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'purchase_order_lines' || table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const po = await ProcurementOrderService.createPurchaseOrder(mockClient, validated, 'buyer-1');
    expect(po.id).toBe(PO_ID);
    expect(po.status).toBe('draft');
    expect(po.total_amount).toBe(15750);
  });

  it('creates an immutable revision snapshot when modifying a purchase order', async () => {
    let revisionCreated = false;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: PO_ID,
                      po_number: 'PO-2026-001',
                      revision_number: 1,
                      status: 'approved',
                      expected_date: '2026-04-01',
                      shipping_address: 'Warehouse A',
                      purchase_order_lines: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.revision_number).toBe(2); // Incremented!
              expect(payload.expected_date).toBe('2026-04-15');
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: PO_ID, ...payload },
                      error: null,
                    }),
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'purchase_order_revisions') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              revisionCreated = true;
              expect(payload.po_id).toBe(PO_ID);
              expect(payload.revision_number).toBe(1); // Saved snapshot of rev 1
              expect(payload.change_reason).toBe('Vendor requested delivery date extension');
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const updateDto = validatePurchaseOrderUpdate({
      expectedDate: '2026-04-15',
      changeReason: 'Vendor requested delivery date extension',
    });

    const updated = await ProcurementOrderService.updatePurchaseOrderWithRevision(
      mockClient,
      DEMO_COMPANY_A,
      PO_ID,
      updateDto,
      'buyer-user-5'
    );

    expect(updated.revision_number).toBe(2);
    expect(revisionCreated).toBe(true);
  });
});

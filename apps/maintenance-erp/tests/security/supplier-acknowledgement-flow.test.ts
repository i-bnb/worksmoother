/**
 * =============================================================================
 * Phase 10 - Test Suite 5: Supplier PO Acknowledgement Flow
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcurementOrderService } from '../../src/services/procurement-order.service.js';
import { validatePurchaseOrderAcknowledgement } from '../../src/schemas/procurement-order.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Supplier PO Acknowledgement Flow', () => {
  const PO_ID = 'po-ack-401';

  it('records full acknowledgement from supplier with promised delivery date', async () => {
    const rawAck = {
      status: 'acknowledged',
      expectedDeliveryDate: '2026-04-10',
      notes: 'Order accepted, scheduled for dispatch next week',
    };

    const validated = validatePurchaseOrderAcknowledgement(rawAck);

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: PO_ID, po_number: 'PO-401', status: 'sent' },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              expect(payload.acknowledgement_status).toBe('acknowledged');
              expect(payload.expected_date).toBe('2026-04-10');
              expect(payload.acknowledgement_notes).toContain('scheduled for dispatch');
              expect(payload.acknowledged_at).toBeDefined();

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
        return {};
      }),
    } as any;

    const result = await ProcurementOrderService.acknowledgePurchaseOrder(
      mockClient,
      DEMO_COMPANY_A,
      PO_ID,
      validated
    );

    expect(result.acknowledgement_status).toBe('acknowledged');
    expect(result.expected_date).toBe('2026-04-10');
  });

  it('records partial acceptance with supplier notes', async () => {
    const rawAck = {
      status: 'partially_accepted',
      notes: 'Only 3 units in stock, remaining 2 backordered',
    };

    const validated = validatePurchaseOrderAcknowledgement(rawAck);

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: PO_ID, po_number: 'PO-401', status: 'sent' },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: PO_ID, acknowledgement_status: 'partially_accepted' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await ProcurementOrderService.acknowledgePurchaseOrder(
      mockClient,
      DEMO_COMPANY_A,
      PO_ID,
      validated
    );

    expect(result.acknowledgement_status).toBe('partially_accepted');
  });
});

/**
 * =============================================================================
 * Transactional Test: Goods Receipt & Weighted Average Costing
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - Partial receipt updates PO lines and sets PO status to 'partially_received'
 *   - Final receipt updates PO lines to 0 remaining and sets status to 'fully_received'
 *   - Weighted average costing formula is strictly enforced upon positive receipt
 *   - Overshipment/over-receiving beyond remaining PO line quantity is rejected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Goods Receipt & Weighted Average Costing', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let testSupplierId: string;
  let testLocationId: string;
  let testPoId: string;
  let testPoLineId: string;

  beforeAll(async () => {
    // 1. Create unique UOM & Item for clean test isolation
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-TST-${Date.now()}`,
        name: 'Test Pieces',
        allow_decimals: false,
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-COST-${Date.now()}`,
        name: 'Test Heavy Motor',
        uom_id: uom!.id,
        item_type: 'spare',
        standard_cost: 100.0,
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // 2. Create Supplier
    const { data: supp } = await admin
      .from('suppliers')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `SUP-TST-${Date.now()}`,
        name: 'Reliable Motors Ltd',
      })
      .select('id')
      .single();
    testSupplierId = supp!.id;

    // 3. Create Warehouse Location
    const { data: loc } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-WH-${Date.now()}`,
        name: 'Testing Depot Warehouse',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    testLocationId = loc!.id;

    // 4. Create Purchase Order for 10 units @ 100.00
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        supplier_id: testSupplierId,
        status: 'approved',
        order_date: '2026-03-01',
      })
      .select('id')
      .single();
    testPoId = po!.id;

    const { data: poLine } = await admin
      .from('purchase_order_lines')
      .insert({
        po_id: testPoId,
        item_id: testItemId,
        quantity: 10,
        unit_price: 100.0,
        line_total: 1000.0,
      })
      .select('id')
      .single();
    testPoLineId = poLine!.id;
  });

  it('performs partial goods receipt (4 of 10 units) and records initial average cost', async () => {
    const { data: result, error } = await admin.rpc('receive_goods_receipt', {
      p_po_id: testPoId,
      p_location_id: testLocationId,
      p_lines: [
        {
          po_line_id: testPoLineId,
          item_id: testItemId,
          quantity: 4,
          unit_cost: 100.0,
        },
      ],
      p_vendor_delivery_note: 'DN-PARTIAL-01',
      p_notes: 'First batch of 4 motors received',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      po_status: 'partially_received',
    });

    // Verify PO status and PO line balances
    const { data: po } = await admin
      .from('purchase_orders')
      .select('status')
      .eq('id', testPoId)
      .single();
    expect(po?.status).toBe('partially_received');

    const { data: poLine } = await admin
      .from('purchase_order_lines')
      .select('received_quantity, remaining_quantity')
      .eq('id', testPoLineId)
      .single();
    expect(Number(poLine?.received_quantity)).toBe(4);
    expect(Number(poLine?.remaining_quantity)).toBe(6);

    // Verify stock balance
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity, average_cost, stock_value')
      .eq('item_id', testItemId)
      .eq('location_id', testLocationId)
      .single();
    expect(Number(balance?.quantity)).toBe(4);
    expect(Number(balance?.available_quantity)).toBe(4);
    expect(Number(balance?.average_cost)).toBe(100.0);
    expect(Number(balance?.stock_value)).toBe(400.0);
  });

  it('rejects receiving more than remaining PO line quantity', async () => {
    // Attempt to receive 7 units when only 6 remain
    const { error } = await admin.rpc('receive_goods_receipt', {
      p_po_id: testPoId,
      p_location_id: testLocationId,
      p_lines: [
        {
          po_line_id: testPoLineId,
          item_id: testItemId,
          quantity: 7,
          unit_cost: 100.0,
        },
      ],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceeds remaining PO quantity/i);
  });

  it('receives remaining 6 units at new cost (200.00) and calculates weighted average cost', async () => {
    // Current state: 4 units @ 100 = 400.
    // Incoming: 6 units @ 200 = 1200.
    // Total stock: 10 units. Total value: 1600.
    // New average cost: 1600 / 10 = 160.00.
    const { data: result, error } = await admin.rpc('receive_goods_receipt', {
      p_po_id: testPoId,
      p_location_id: testLocationId,
      p_lines: [
        {
          po_line_id: testPoLineId,
          item_id: testItemId,
          quantity: 6,
          unit_cost: 200.0,
        },
      ],
      p_vendor_delivery_note: 'DN-FINAL-02',
      p_notes: 'Remaining 6 motors received with updated freight/duty cost',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      po_status: 'fully_received',
    });

    // Verify PO status and PO line balances
    const { data: po } = await admin
      .from('purchase_orders')
      .select('status')
      .eq('id', testPoId)
      .single();
    expect(po?.status).toBe('fully_received');

    const { data: poLine } = await admin
      .from('purchase_order_lines')
      .select('received_quantity, remaining_quantity')
      .eq('id', testPoLineId)
      .single();
    expect(Number(poLine?.received_quantity)).toBe(10);
    expect(Number(poLine?.remaining_quantity)).toBe(0);

    // Verify weighted average cost in stock balances
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, average_cost, stock_value')
      .eq('item_id', testItemId)
      .eq('location_id', testLocationId)
      .single();

    expect(Number(balance?.quantity)).toBe(10);
    expect(Number(balance?.average_cost)).toBe(160.0);
    expect(Number(balance?.stock_value)).toBe(1600.0);
  });
});

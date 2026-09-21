/**
 * =============================================================================
 * Integration Test: Sales Orders & Stock Ledger Material Fulfillment
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
 * =============================================================================
 * Verifies:
 *   - Sales order confirmation
 *   - fulfill_sales_order deducts physical stock through the append-only stock ledger
 *   - Partial fulfillment leaves remaining_quantity and marks order partially_fulfilled
 *   - Full fulfillment marks order as fulfilled
 *   - Over-fulfillment beyond sales order lines is strictly rejected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Sales: Orders & Stock Ledger Fulfillment Integration', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testItemId: string;
  let testLocId: string;
  let testSoId: string;
  let testSoLineId: string;

  beforeAll(async () => {
    // 1. Create Customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Meraas Real Estate Holding',
        code: `CUST-MRAS-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create UOM & Item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-SO-${Date.now()}`,
        name: 'Pieces',
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-SO-${Date.now()}`,
        name: 'Thermostatic Expansion Valve',
        uom_id: uom!.id,
        item_type: 'spare',
        standard_cost: 180.0,
        sale_price: 320.0,
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // 3. Create Warehouse & Seed 10 units of opening stock
    const { data: loc } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-WH-SO-${Date.now()}`,
        name: 'Fulfillment Parts Hub',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    testLocId = loc!.id;

    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: testLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 10,
      p_unit_cost: 180.0,
      p_reference_type: 'opening_balance',
      p_reference_id: testLocId,
    });

    // 4. Create Sales Order for 5 units @ 320.00
    const { data: so } = await admin
      .from('sales_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        status: 'confirmed',
        subtotal: 1600.0,
        taxable_amount: 1600.0,
        tax_amount: 80.0,
        grand_total: 1680.0,
      })
      .select('id')
      .single();
    testSoId = so!.id;

    const { data: soLine } = await admin
      .from('sales_order_lines')
      .insert({
        sales_order_id: testSoId,
        line_number: 1,
        item_id: testItemId,
        description: 'Thermostatic Expansion Valve Supply',
        quantity: 5,
        uom_id: uom!.id,
        unit_price: 320.0,
        line_total: 1680.0,
      })
      .select('id')
      .single();
    testSoLineId = soLine!.id;
  });

  it('partially fulfills sales order (3 of 5 units) and deducts from stock ledger', async () => {
    const { data: result, error } = await admin.rpc('fulfill_sales_order', {
      p_sales_order_id: testSoId,
      p_location_id: testLocId,
      p_lines: [
        {
          sales_order_line_id: testSoLineId,
          item_id: testItemId,
          quantity: 3,
        },
      ],
      p_notes: 'Batch 1 of 3 valves dispatched to client site',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      status: 'partially_fulfilled',
    });

    // Verify warehouse balance reduced from 10 to 7
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', testLocId)
      .single();
    expect(Number(balance?.quantity)).toBe(7);

    // Verify stock ledger movement entry
    const { data: ledger } = await admin
      .from('stock_ledger')
      .select('movement_type, movement_direction, quantity')
      .eq('reference_id', testSoId)
      .single();
    expect(ledger?.movement_type).toBe('customer_sale');
    expect(ledger?.movement_direction).toBe('out');
    expect(Number(ledger?.quantity)).toBe(3);

    // Verify sales order line quantities
    const { data: soLine } = await admin
      .from('sales_order_lines')
      .select('fulfilled_quantity, remaining_quantity')
      .eq('id', testSoLineId)
      .single();
    expect(Number(soLine?.fulfilled_quantity)).toBe(3);
    expect(Number(soLine?.remaining_quantity)).toBe(2);
  });

  it('rejects fulfilling more than remaining sales order quantity', async () => {
    // Attempting to fulfill 4 units when only 2 remain
    const { error } = await admin.rpc('fulfill_sales_order', {
      p_sales_order_id: testSoId,
      p_location_id: testLocId,
      p_lines: [
        {
          sales_order_line_id: testSoLineId,
          item_id: testItemId,
          quantity: 4,
        },
      ],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceeds remaining sales order quantity/i);
  });

  it('fulfills remaining 2 units and advances sales order status to fulfilled', async () => {
    const { data: result, error } = await admin.rpc('fulfill_sales_order', {
      p_sales_order_id: testSoId,
      p_location_id: testLocId,
      p_lines: [
        {
          sales_order_line_id: testSoLineId,
          item_id: testItemId,
          quantity: 2,
        },
      ],
      p_notes: 'Final batch of 2 valves dispatched',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      status: 'fulfilled',
    });

    // Verify final SO status
    const { data: so } = await admin
      .from('sales_orders')
      .select('status')
      .eq('id', testSoId)
      .single();
    expect(so?.status).toBe('fulfilled');

    // Verify warehouse balance reduced from 7 to 5
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', testLocId)
      .single();
    expect(Number(balance?.quantity)).toBe(5);
  });
});

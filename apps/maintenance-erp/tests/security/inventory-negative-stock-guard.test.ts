/**
 * =============================================================================
 * Integrity Test: Negative Stock Guard & Settings Flag
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - By default (allow_negative_stock = false), stock balance cannot drop below 0
 *   - Over-consumption / over-issue transactions are blocked with clear diagnostic messages
 *   - When company setting allow_negative_stock is enabled, negative balances are permitted
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Negative Stock Guard & Policy Enforcement', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let testLocId: string;

  beforeAll(async () => {
    // Ensure settings has allow_negative_stock = false
    await admin
      .from('settings')
      .update({ allow_negative_stock: false })
      .eq('company_id', DEMO_COMPANY_A);

    // Create item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-NEG-${Date.now()}`,
        name: 'Negative Test UOM',
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-NEG-${Date.now()}`,
        name: 'Brass Fitting 1/4 inch',
        uom_id: uom!.id,
        item_type: 'material',
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // Create Location
    const { data: loc } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-NEG-${Date.now()}`,
        name: 'Test Parts Stockroom',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    testLocId = loc!.id;

    // Seed 2 units
    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: testLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 2,
      p_unit_cost: 15.0,
      p_reference_type: 'opening_balance',
      p_reference_id: testLocId,
    });
  });

  afterAll(async () => {
    // Restore default setting
    await admin
      .from('settings')
      .update({ allow_negative_stock: false })
      .eq('company_id', DEMO_COMPANY_A);
  });

  it('strictly rejects deducting more than available quantity when allow_negative_stock is false', async () => {
    // Available is 2. Attempt to deduct 5 units via adjust_stock
    const { error } = await admin.rpc('adjust_stock', {
      p_location_id: testLocId,
      p_item_id: testItemId,
      p_quantity_change: -5,
      p_reason: 'Scrapped due to rust damage',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient stock available/i);

    // Verify balance remains unchanged at 2
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', testLocId)
      .single();
    expect(Number(balance?.quantity)).toBe(2);
  });

  it('permits negative stock when allow_negative_stock is explicitly enabled', async () => {
    // Enable allow_negative_stock
    await admin
      .from('settings')
      .update({ allow_negative_stock: true })
      .eq('company_id', DEMO_COMPANY_A);

    // Attempt adjustment of -5 units again
    const { data: result, error } = await admin.rpc('adjust_stock', {
      p_location_id: testLocId,
      p_item_id: testItemId,
      p_quantity_change: -5,
      p_reason: 'Emergency dispatch before receiving vendor shipment',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      new_quantity: -3,
    });

    // Verify balance is now negative (-3)
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', testLocId)
      .single();

    expect(Number(balance?.quantity)).toBe(-3);
    expect(Number(balance?.available_quantity)).toBe(-3);
  });
});

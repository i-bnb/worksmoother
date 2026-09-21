/**
 * =============================================================================
 * Concurrency Test: Row-Level Locking on Stock Balances
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - Concurrent deductions against stock_balances use FOR UPDATE row-level locking
 *   - Prevents race conditions and double-spending
 *   - When 10 concurrent requests attempt to consume 1 unit each from a pool of 5,
 *     exactly 5 succeed and exactly 5 fail with insufficient stock.
 *   - The final balance is guaranteed to be exactly 0.0000.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Concurrency Locks & Race Condition Protection', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let testLocId: string;

  beforeAll(async () => {
    // Ensure negative stock is disabled
    await admin
      .from('settings')
      .update({ allow_negative_stock: false })
      .eq('company_id', DEMO_COMPANY_A);

    // Create item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-CNC-${Date.now()}`,
        name: 'Concurrent Unit',
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-CNC-${Date.now()}`,
        name: 'Critical Pressure Valve',
        uom_id: uom!.id,
        item_type: 'spare',
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
        code: `LOC-CNC-${Date.now()}`,
        name: 'Fast-Paced Depot',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    testLocId = loc!.id;

    // Seed exactly 5 units
    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: testLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 5,
      p_unit_cost: 250.0,
      p_reference_type: 'opening_balance',
      p_reference_id: testLocId,
    });
  });

  it('handles 10 concurrent deduction requests against 5 available units safely', async () => {
    // Launch 10 simultaneous deduction requests
    const tasks = Array.from({ length: 10 }).map((_, idx) =>
      admin.rpc('adjust_stock', {
        p_location_id: testLocId,
        p_item_id: testItemId,
        p_quantity_change: -1,
        p_reason: `Concurrent deduction thread ${idx}`,
        p_idempotency_key: `CNC-ADJ-${idx}-${Date.now()}`,
      })
    );

    const results = await Promise.allSettled(tasks);

    let succeededCount = 0;
    let failedCount = 0;

    for (const res of results) {
      if (res.status === 'fulfilled') {
        if (res.value.error) {
          failedCount++;
        } else {
          succeededCount++;
        }
      } else {
        failedCount++;
      }
    }

    // Exactly 5 should succeed and 5 should fail due to insufficient stock
    expect(succeededCount).toBe(5);
    expect(failedCount).toBe(5);

    // Final balance MUST be exactly 0
    const { data: finalBalance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', testLocId)
      .single();

    expect(Number(finalBalance?.quantity)).toBe(0);
    expect(Number(finalBalance?.available_quantity)).toBe(0);
  });
});

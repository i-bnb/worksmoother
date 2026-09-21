/**
 * =============================================================================
 * Security & Audit Test: Stock Ledger Immutability Guard
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - The stock_ledger is strictly append-only
 *   - Any direct UPDATE attempt is aborted by trg_stock_ledger_no_update_delete
 *   - Any direct DELETE attempt is aborted by trg_stock_ledger_no_update_delete
 *   - Audit integrity and financial ledger data cannot be tampered with even by admins
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Stock Ledger Immutability & Audit Guard', () => {
  const admin = getAdminClient();
  let testLedgerId: string;
  let testItemId: string;
  let testLocId: string;

  beforeAll(async () => {
    // 1. Create unique Item and Location
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-IMM-${Date.now()}`,
        name: 'Immutable Test UOM',
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-IMM-${Date.now()}`,
        name: 'Copper Bushing',
        uom_id: uom!.id,
        item_type: 'spare',
      })
      .select('id')
      .single();
    testItemId = item!.id;

    const { data: loc } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-IMM-${Date.now()}`,
        name: 'Vault Store',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    testLocId = loc!.id;

    // 2. Append a ledger movement
    const { data: mId } = await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: testLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 10,
      p_unit_cost: 50.0,
      p_reference_type: 'opening_balance',
      p_reference_id: testLocId,
    });
    testLedgerId = mId;
  });

  it('strictly rejects any direct SQL UPDATE on stock_ledger rows', async () => {
    const { error } = await admin
      .from('stock_ledger')
      .update({ quantity: 9999 } as any)
      .eq('id', testLedgerId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/append-only/i);

    // Verify record remains untouched
    const { data: record } = await admin
      .from('stock_ledger')
      .select('quantity')
      .eq('id', testLedgerId)
      .single();
    expect(Number(record?.quantity)).toBe(10);
  });

  it('strictly rejects any direct SQL DELETE on stock_ledger rows', async () => {
    const { error } = await admin
      .from('stock_ledger')
      .delete()
      .eq('id', testLedgerId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/append-only/i);

    // Verify record still exists
    const { data: record } = await admin
      .from('stock_ledger')
      .select('id')
      .eq('id', testLedgerId)
      .single();
    expect(record?.id).toBe(testLedgerId);
  });
});

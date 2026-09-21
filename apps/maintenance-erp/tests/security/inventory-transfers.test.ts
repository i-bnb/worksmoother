/**
 * =============================================================================
 * Transactional Test: Multi-Legged Stock Transfers (Warehouse <-> Van)
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - Balanced transfer atomically creates transfer_out and transfer_in ledger legs
 *   - Source balance decrements and destination balance increments accurately
 *   - Transfer rejected if source location lacks stock
 *   - Cross-company transfers are rejected to enforce tenant isolation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_COMPANY_B, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Multi-Legged Stock Transfers', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let sourceLocId: string;
  let destLocId: string;
  let crossCompanyLocId: string;

  beforeAll(async () => {
    // 1. Create unique Item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-TRN-${Date.now()}`,
        name: 'Transfer Units',
        allow_decimals: false,
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-TRN-${Date.now()}`,
        name: 'Relay Contactor 24V',
        uom_id: uom!.id,
        item_type: 'spare',
        standard_cost: 50.0,
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // 2. Create Warehouse (Source) and Van (Destination) in Company A
    const { data: src } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-SRC-${Date.now()}`,
        name: 'Central Warehouse Hub',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    sourceLocId = src!.id;

    const { data: dst } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-DST-${Date.now()}`,
        name: 'Technician Van 12',
        location_type: 'technician_van',
      })
      .select('id')
      .single();
    destLocId = dst!.id;

    // 3. Create Location in Company B for cross-tenant check
    const { data: bLoc } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_B,
        code: `LOC-COMPB-${Date.now()}`,
        name: 'Company B Depot',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    crossCompanyLocId = bLoc!.id;

    // 4. Seed opening stock of 10 units in source warehouse
    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: sourceLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 10,
      p_unit_cost: 50.0,
      p_reference_type: 'opening_balance',
      p_reference_id: sourceLocId,
    });
  });

  it('atomically transfers 3 units from warehouse to technician van', async () => {
    const { data: result, error } = await admin.rpc('transfer_stock', {
      p_from_location_id: sourceLocId,
      p_to_location_id: destLocId,
      p_lines: [
        {
          item_id: testItemId,
          quantity: 3,
        },
      ],
      p_notes: 'Replenishing Van 12 with contactors',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      transfer_id: expect.any(String),
      transfer_number: expect.stringMatching(/^TRN-/),
    });

    // Verify source location balance has reduced to 7
    const { data: srcBalance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', sourceLocId)
      .single();
    expect(Number(srcBalance?.quantity)).toBe(7);
    expect(Number(srcBalance?.available_quantity)).toBe(7);

    // Verify destination location balance has increased to 3
    const { data: dstBalance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity, average_cost')
      .eq('item_id', testItemId)
      .eq('location_id', destLocId)
      .single();
    expect(Number(dstBalance?.quantity)).toBe(3);
    expect(Number(dstBalance?.available_quantity)).toBe(3);
    expect(Number(dstBalance?.average_cost)).toBe(50.0);

    // Verify both transfer_out and transfer_in ledger entries exist
    const { data: ledgerEntries } = await admin
      .from('stock_ledger')
      .select('movement_type, movement_direction, location_id, quantity')
      .eq('reference_id', result.transfer_id);

    expect(ledgerEntries).toHaveLength(2);
    const outLeg = ledgerEntries?.find((e: any) => e.movement_direction === 'out');
    const inLeg = ledgerEntries?.find((e: any) => e.movement_direction === 'in');

    expect(outLeg?.location_id).toBe(sourceLocId);
    expect(Number(outLeg?.quantity)).toBe(3);
    expect(inLeg?.location_id).toBe(destLocId);
    expect(Number(inLeg?.quantity)).toBe(3);
  });

  it('rejects transfer exceeding source available stock', async () => {
    // Current source balance is 7. Attempting to transfer 10 must fail.
    const { error } = await admin.rpc('transfer_stock', {
      p_from_location_id: sourceLocId,
      p_to_location_id: destLocId,
      p_lines: [
        {
          item_id: testItemId,
          quantity: 10,
        },
      ],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient stock/i);
  });

  it('rejects cross-company inventory transfers', async () => {
    const { error } = await admin.rpc('transfer_stock', {
      p_from_location_id: sourceLocId,
      p_to_location_id: crossCompanyLocId,
      p_lines: [
        {
          item_id: testItemId,
          quantity: 1,
        },
      ],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/across companies/i);
  });
});

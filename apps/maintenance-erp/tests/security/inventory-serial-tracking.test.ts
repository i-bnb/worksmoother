/**
 * =============================================================================
 * Lifecycle Test: Serialized Parts Identity & Asset Installation Tracking
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - Serial numbers are registered in serial_numbers table upon receipt
 *   - Transferring serialized items updates current_location_id to destination
 *   - Issuing serialized parts to a work order updates status to 'installed'
 *     and links installed_customer_asset_id to the target equipment
 *   - Returning decommissioned serialized parts moves them to quarantine or scrap
 *   - Attempting to issue a serial number not present in the location is rejected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Serial Number Lifecycle & Asset Traceability', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let whLocId: string;
  let vanLocId: string;
  let quarLocId: string;
  let testCustomerId: string;
  let testSiteId: string;
  let testAssetId: string;
  let testWoId: string;
  let testVisitId: string;
  const testSerialNo = `SN-SRL-${Date.now()}`;

  beforeAll(async () => {
    // 1. Create Serial-Tracked Item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-SRL-${Date.now()}`,
        name: 'Pieces',
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-SRL-${Date.now()}`,
        name: 'Inverter Compressor 3TR',
        uom_id: uom!.id,
        item_type: 'spare',
        track_serial: true,
        standard_cost: 2100.0,
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // 2. Create Locations
    const { data: wh } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-WH-SRL-${Date.now()}`,
        name: 'Central Warehouse',
        location_type: 'warehouse',
      })
      .select('id')
      .single();
    whLocId = wh!.id;

    const { data: van } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-VAN-SRL-${Date.now()}`,
        name: 'Van 5',
        location_type: 'technician_van',
      })
      .select('id')
      .single();
    vanLocId = van!.id;

    const { data: quar } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-QUAR-SRL-${Date.now()}`,
        name: 'Quarantine Yard',
        location_type: 'quarantine',
      })
      .select('id')
      .single();
    quarLocId = quar!.id;

    // 3. Create Customer, Site, Asset, Work Order, and Visit
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Hospitality Group UAE',
        code: `CUST-HOSP-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    const { data: site } = await admin
      .from('customer_sites')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Grand Hotel Chiller Room',
        code: `SITE-HOSP-${Date.now()}`,
      })
      .select('id')
      .single();
    testSiteId = site!.id;

    const { data: asset } = await admin
      .from('customer_assets')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        site_id: testSiteId,
        name: 'York Roof Chiller #3',
        asset_code: `AST-YORK-${Date.now()}`,
      })
      .select('id')
      .single();
    testAssetId = asset!.id;

    const { data: wo } = await admin
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        site_id: testSiteId,
        asset_id: testAssetId,
        description: 'Compressor replacement job',
        status: 'in_progress',
      })
      .select('id')
      .single();
    testWoId = wo!.id;

    const { data: v } = await admin
      .from('visits')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        work_order_id: testWoId,
        visit_number: 1,
        status: 'in_progress',
      })
      .select('id')
      .single();
    testVisitId = v!.id;
  });

  it('registers serialized item into warehouse stock', async () => {
    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: whLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 1,
      p_unit_cost: 2100.0,
      p_reference_type: 'opening_balance',
      p_reference_id: whLocId,
      p_serial_number: testSerialNo,
    });

    // Check serial_numbers table
    const { data: sn } = await admin
      .from('serial_numbers')
      .select('*')
      .eq('item_id', testItemId)
      .eq('serial_number', testSerialNo)
      .single();

    expect(sn).not.toBeNull();
    expect(sn?.status).toBe('in_stock');
    expect(sn?.current_location_id).toBe(whLocId);
    expect(sn?.installed_customer_asset_id).toBeNull();
  });

  it('updates serial location when transferred from warehouse to technician van', async () => {
    const { error } = await admin.rpc('transfer_stock', {
      p_from_location_id: whLocId,
      p_to_location_id: vanLocId,
      p_lines: [
        {
          item_id: testItemId,
          quantity: 1,
          serial_number: testSerialNo,
        },
      ],
    });
    expect(error).toBeNull();

    // Verify serial location is now the van
    const { data: sn } = await admin
      .from('serial_numbers')
      .select('current_location_id, status')
      .eq('item_id', testItemId)
      .eq('serial_number', testSerialNo)
      .single();

    expect(sn?.current_location_id).toBe(vanLocId);
    expect(sn?.status).toBe('in_stock');
  });

  it('rejects issuing a serial number that is not present in the issuing location', async () => {
    // Attempt to issue this serial from WH (which no longer holds it)
    const { error } = await admin.rpc('issue_stock_to_job', {
      p_work_order_id: testWoId,
      p_visit_id: testVisitId,
      p_item_id: testItemId,
      p_quantity: 1,
      p_location_id: whLocId, // Wrong location
      p_serial_number: testSerialNo,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not located in location/i);
  });

  it('issues serial from van to customer asset and marks status as installed', async () => {
    const { data: result, error } = await admin.rpc('issue_stock_to_job', {
      p_work_order_id: testWoId,
      p_visit_id: testVisitId,
      p_item_id: testItemId,
      p_quantity: 1,
      p_location_id: vanLocId,
      p_serial_number: testSerialNo,
      p_coverage: 'chargeable',
      p_notes: 'New compressor installed on York Roof Chiller',
    });

    expect(error).toBeNull();
    expect(result?.success).toBe(true);

    // Verify serial record is now installed on the customer asset
    const { data: sn } = await admin
      .from('serial_numbers')
      .select('*')
      .eq('item_id', testItemId)
      .eq('serial_number', testSerialNo)
      .single();

    expect(sn?.status).toBe('installed');
    expect(sn?.installed_customer_asset_id).toBe(testAssetId);
    expect(sn?.installed_work_order_id).toBe(testWoId);
    expect(sn?.current_location_id).toBeNull();
  });

  it('returns removed part from job to quarantine yard', async () => {
    const defectiveSerialNo = `DEF-COMP-${Date.now()}`;

    // Register defective serial on the asset first
    await admin.from('serial_numbers').insert({
      company_id: DEMO_COMPANY_A,
      item_id: testItemId,
      serial_number: defectiveSerialNo,
      status: 'installed',
      installed_customer_asset_id: testAssetId,
    });

    const { data: result, error } = await admin.rpc('return_stock_from_job', {
      p_work_order_id: testWoId,
      p_visit_id: testVisitId,
      p_item_id: testItemId,
      p_quantity: 1,
      p_disposition: 'quarantine',
      p_serial_number: defectiveSerialNo,
      p_destination_location_id: quarLocId,
      p_reason: 'Burned stator winding requiring warranty inspection',
    });

    expect(error).toBeNull();
    expect(result?.success).toBe(true);

    // Verify serial updated to returned in quarantine yard
    const { data: sn } = await admin
      .from('serial_numbers')
      .select('*')
      .eq('item_id', testItemId)
      .eq('serial_number', defectiveSerialNo)
      .single();

    expect(sn?.status).toBe('returned');
    expect(sn?.current_location_id).toBe(quarLocId);
    expect(sn?.installed_customer_asset_id).toBeNull();
  });
});

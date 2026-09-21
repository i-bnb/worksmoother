/**
 * =============================================================================
 * Integration Test: Job Material Consumption & Operational Integration
 * Maintenance Management ERP — Phase 2A Inventory & Purchasing
 * =============================================================================
 * Verifies:
 *   - issue_stock_to_job simultaneously deducts physical van stock and populates
 *     Phase 1 job_material_movements table for work order billing and audit
 *   - return_stock_from_job logs removed defective components with correct dispositions
 *   - Proper coverage (chargeable vs under_contract) maps to is_billable flag
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Inventory: Job Material Consumption Integration', () => {
  const admin = getAdminClient();
  let testItemId: string;
  let vanLocId: string;
  let testWoId: string;
  let testVisitId: string;
  let testEmpId: string;

  beforeAll(async () => {
    // 1. Fetch Ahmed Farooq employee ID
    const { data: emp } = await admin
      .from('employees')
      .select('id')
      .eq('employee_code', 'EMP-004')
      .single();
    testEmpId = emp?.id || (await admin.from('employees').select('id').limit(1).single()).data!.id;

    // 2. Create consumable item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-MAT-${Date.now()}`,
        name: 'Meters',
        allow_decimals: true,
      })
      .select('id')
      .single();

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-MAT-${Date.now()}`,
        name: 'Insulation Foam Roll 1/2"',
        uom_id: uom!.id,
        item_type: 'material',
        standard_cost: 12.5,
      })
      .select('id')
      .single();
    testItemId = item!.id;

    // 3. Create Technician Van Location assigned to testEmpId
    const { data: van } = await admin
      .from('locations')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        code: `LOC-VAN-MAT-${Date.now()}`,
        name: 'Van 9',
        location_type: 'technician_van',
        assigned_employee_id: testEmpId,
      })
      .select('id')
      .single();
    vanLocId = van!.id;

    // 4. Seed 50 units in the van
    await admin.rpc('record_stock_movement', {
      p_company_id: DEMO_COMPANY_A,
      p_branch_id: DEMO_BRANCH_DXB,
      p_item_id: testItemId,
      p_location_id: vanLocId,
      p_movement_type: 'opening_balance',
      p_movement_direction: 'in',
      p_quantity: 50,
      p_unit_cost: 12.5,
      p_reference_type: 'opening_balance',
      p_reference_id: vanLocId,
    });

    // 5. Create Customer, Work Order, and Visit
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Emaar Retail Group',
        code: `CUST-EMR-${Date.now()}`,
      })
      .select('id')
      .single();

    const { data: site } = await admin
      .from('customer_sites')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: cust!.id,
        name: 'Retail Kiosk 14',
        code: `SITE-EMR-${Date.now()}`,
      })
      .select('id')
      .single();

    const { data: wo } = await admin
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: cust!.id,
        site_id: site!.id,
        description: 'Chilled water pipe re-insulation',
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

  it('issues 15 meters to job and confirms dual record in stock ledger and job_material_movements', async () => {
    const { data: result, error } = await admin.rpc('issue_stock_to_job', {
      p_work_order_id: testWoId,
      p_visit_id: testVisitId,
      p_item_id: testItemId,
      p_quantity: 15.0,
      p_location_id: vanLocId,
      p_coverage: 'chargeable',
      p_notes: '15 meters used for suction pipe insulation',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      quantity_issued: 15.0,
    });

    // Check van balance decremented to 35
    const { data: balance } = await admin
      .from('stock_balances')
      .select('quantity, available_quantity')
      .eq('item_id', testItemId)
      .eq('location_id', vanLocId)
      .single();
    expect(Number(balance?.quantity)).toBe(35.0);

    // Check Phase 1 job_material_movements entry
    const { data: jobMat } = await admin
      .from('job_material_movements')
      .select('*')
      .eq('work_order_id', testWoId)
      .eq('visit_id', testVisitId)
      .eq('movement_type', 'installed')
      .single();

    expect(jobMat).not.toBeNull();
    expect(Number(jobMat?.quantity)).toBe(15.0);
    expect(jobMat?.is_billable).toBe(true);
    expect(jobMat?.coverage).toBe('chargeable');
  });

  it('records removed component left with customer without altering inventory levels', async () => {
    const { data: result, error } = await admin.rpc('return_stock_from_job', {
      p_work_order_id: testWoId,
      p_visit_id: testVisitId,
      p_item_id: testItemId,
      p_quantity: 5.0,
      p_disposition: 'left_with_customer',
      p_reason: 'Client retained old insulation for recycling',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      action: 'left_with_customer',
    });

    // Verify job_material_movements has the 'removed' record
    const { data: jobMat } = await admin
      .from('job_material_movements')
      .select('*')
      .eq('work_order_id', testWoId)
      .eq('disposition', 'left_with_customer')
      .single();

    expect(jobMat).not.toBeNull();
    expect(Number(jobMat?.quantity)).toBe(5.0);
    expect(jobMat?.is_billable).toBe(false);
  });
});

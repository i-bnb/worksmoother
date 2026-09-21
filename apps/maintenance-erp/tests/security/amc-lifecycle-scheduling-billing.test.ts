/**
 * =============================================================================
 * Operational Test: AMC Lifecycle, Recurring Scheduling & Dispatch
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - AMC contract creation with customer asset coverage
 *   - Idempotent recurring PM visit generation (generate_amc_schedule)
 *   - Direct creation of Phase 1 Work Orders from AMC visits (generate_amc_work_order)
 *   - Recurring installment billing into Phase 2B invoices (bill_amc_contract)
 *   - Historical contract preservation during contract renewal (renew_amc_contract)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('AMC Management: Contract Lifecycle, Scheduling & Dispatch', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testSiteId: string;
  let testAssetId: string;
  let testContractId: string;
  let sampleScheduleId: string;

  beforeAll(async () => {
    // 1. Create customer, site, and equipment asset
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        name: 'Deira City Centre Mall LLC',
        code: `CUST-DCC-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    const { data: site } = await admin
      .from('customer_sites')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        name: 'DCC Food Court Air Handling Zone',
        address: '8th Street, Port Saeed, Dubai',
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
        name: 'Carrier 5000 CFM Air Handling Unit',
        asset_code: `EQ-AHU-${Date.now()}`,
        asset_type: 'AHU',
        status: 'active',
      })
      .select('id')
      .single();
    testAssetId = asset!.id;

    // 2. Create AMC Contract (AED 36,000 / year, Quarterly frequency)
    const { data: amc } = await admin
      .from('amc_contracts')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        site_id: testSiteId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        contract_value: 36000.000,
        tax_amount: 1800.000,
        billing_frequency: 'quarterly',
        service_frequency: 'quarterly',
        response_sla_hours: 4,
        included_visits: 4,
        status: 'active',
      })
      .select('id, contract_number')
      .single();
    testContractId = amc!.id;

    // 3. Attach covered asset
    await admin.from('amc_contract_assets').insert({
      amc_contract_id: testContractId,
      customer_asset_id: testAssetId,
      service_coverage: 'full',
      visit_frequency: 'quarterly',
    });
  });

  it('generates 4 quarterly recurring service schedules idempotently', async () => {
    const { data: schedRes, error } = await admin.rpc('generate_amc_schedule', {
      p_contract_id: testContractId,
    });

    expect(error).toBeNull();
    expect(schedRes.success).toBe(true);
    expect(schedRes.schedules_generated).toBe(4);

    const { data: schedules } = await admin
      .from('amc_schedules')
      .select('id, scheduled_date, period_label, status')
      .eq('amc_contract_id', testContractId)
      .order('scheduled_date', { ascending: true });

    expect(schedules).toHaveLength(4);
    sampleScheduleId = schedules![0].id;

    // Calling again does not duplicate
    const { data: retryRes } = await admin.rpc('generate_amc_schedule', {
      p_contract_id: testContractId,
    });
    expect(retryRes.schedules_generated).toBe(4);

    const { count } = await admin
      .from('amc_schedules')
      .select('*', { count: 'exact', head: true })
      .eq('amc_contract_id', testContractId);

    expect(count).toBe(4);
  });

  it('spawns a real Phase 1 Work Order from an AMC Schedule record', async () => {
    const { data: woRes, error: woErr } = await admin.rpc('generate_amc_work_order', {
      p_schedule_id: sampleScheduleId,
    });

    expect(woErr).toBeNull();
    expect(woRes.success).toBe(true);
    expect(woRes.work_order_id).toBeDefined();
    expect(woRes.order_number).toMatch(/^WO-\d{4}-\d+/);

    // Verify schedule is updated with work_order_id
    const { data: schedVerified } = await admin
      .from('amc_schedules')
      .select('status, work_order_id')
      .eq('id', sampleScheduleId)
      .single();

    expect(schedVerified?.status).toBe('work_order_generated');
    expect(schedVerified?.work_order_id).toBe(woRes.work_order_id);

    // Idempotency check: Calling again returns existing work order
    const { data: dupWoRes } = await admin.rpc('generate_amc_work_order', {
      p_schedule_id: sampleScheduleId,
    });
    expect(dupWoRes.already_generated).toBe(true);
    expect(dupWoRes.work_order_id).toBe(woRes.work_order_id);
  });

  it('bills AMC quarterly installment into Phase 2B invoices engine idempotently', async () => {
    const { data: billRes, error: billErr } = await admin.rpc('bill_amc_contract', {
      p_contract_id: testContractId,
      p_period_label: 'Q1-2026',
    });

    expect(billErr).toBeNull();
    expect(billRes.success).toBe(true);
    expect(billRes.invoice_id).toBeDefined();
    expect(billRes.invoice_number).toMatch(/^INV-\d{4}-\d+/);

    // 36000 / 4 = 9000 subtotal + 450 tax = 9450 grand total
    expect(Number(billRes.grand_total)).toBe(9450.000);

    // Idempotent retry check
    const { data: dupBillRes } = await admin.rpc('bill_amc_contract', {
      p_contract_id: testContractId,
      p_period_label: 'Q1-2026',
    });
    expect(dupBillRes.already_billed).toBe(true);
    expect(dupBillRes.invoice_id).toBe(billRes.invoice_id);
  });

  it('renews AMC contract preserving historical linkage and asset coverage', async () => {
    const { data: renewRes, error: renewErr } = await admin.rpc('renew_amc_contract', {
      p_contract_id: testContractId,
    });

    expect(renewErr).toBeNull();
    expect(renewRes.success).toBe(true);
    expect(renewRes.new_contract_id).toBeDefined();
    expect(renewRes.new_contract_number).toMatch(/^AMC-\d{4}-\d+/);

    // Verify original contract status is 'renewed'
    const { data: oldContract } = await admin
      .from('amc_contracts')
      .select('status')
      .eq('id', testContractId)
      .single();
    expect(oldContract?.status).toBe('renewed');

    // Verify new contract has previous_contract_id link
    const { data: newContract } = await admin
      .from('amc_contracts')
      .select('status, previous_contract_id, start_date')
      .eq('id', renewRes.new_contract_id)
      .single();
    expect(newContract?.previous_contract_id).toBe(testContractId);
    expect(newContract?.start_date).toBe('2027-01-01');

    // Verify covered assets were copied to new contract
    const { data: assets } = await admin
      .from('amc_contract_assets')
      .select('customer_asset_id')
      .eq('amc_contract_id', renewRes.new_contract_id);
    expect(assets).toHaveLength(1);
    expect(assets![0].customer_asset_id).toBe(testAssetId);
  });
});

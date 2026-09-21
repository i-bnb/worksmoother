/**
 * =============================================================================
 * Financial Reporting Test: Job Costing & Work Order Profitability
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - Aggregation of Materials (job_material_movements), Labor (timesheets), and Expenses
 *   - Integration with invoiced commercial revenue
 *   - Accurate gross margin and margin percentage calculations in view_job_profitability
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Job Costing & Profitability Reporting', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testWorkOrderId: string;

  beforeAll(async () => {
    // 1. Create customer & site
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        name: 'Omniyat Properties LLC',
        code: `CUST-OMN-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    const { data: site } = await admin
      .from('customer_sites')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        name: 'The Opus Tower Mechanical Room',
        address: 'Business Bay, Dubai',
      })
      .select('id')
      .single();

    // 2. Create work order
    const { data: wo } = await admin
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        site_id: site!.id,
        title: 'Emergency Fan Coil Unit Overhaul',
        priority: 'high',
        status: 'completed',
      })
      .select('id')
      .single();
    testWorkOrderId = wo!.id;

    // 3. Create visit
    const { data: visit } = await admin
      .from('visits')
      .insert({
        company_id: DEMO_COMPANY_A,
        work_order_id: testWorkOrderId,
        status: 'completed',
      })
      .select('id')
      .single();

    // 4. Record material consumption (AED 800)
    const { data: item } = await admin
      .from('items')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .limit(1)
      .single();

    await admin.from('job_material_movements').insert({
      company_id: DEMO_COMPANY_A,
      work_order_id: testWorkOrderId,
      visit_id: visit!.id,
      item_id: item!.id,
      movement_type: 'installed',
      quantity: 1.0000,
      unit_cost: 800.000,
      total_cost: 800.000,
      is_billable: true,
    });

    // 5. Record labor timesheet (120 minutes = 2 hours @ 50/hr = AED 100)
    const { data: emp } = await admin
      .from('employees')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .limit(1)
      .single();

    await admin.from('timesheets').insert({
      visit_id: visit!.id,
      work_order_id: testWorkOrderId,
      technician_id: emp!.id,
      start_time: '2026-03-12T08:00:00Z',
      end_time: '2026-03-12T10:00:00Z', // 120 mins
      duration_minutes: 120,
    });

    // 6. Record job direct expense (AED 150)
    await admin.from('expenses').insert({
      company_id: DEMO_COMPANY_A,
      work_order_id: testWorkOrderId,
      amount: 150.000,
      category: 'tools',
      description: 'Specialized refrigerant vacuum pump rental',
      status: 'posted',
    });

    // 7. Record issued invoice for work order (AED 2,500)
    await admin.from('invoices').insert({
      company_id: DEMO_COMPANY_A,
      customer_id: testCustomerId,
      work_order_id: testWorkOrderId,
      invoice_date: '2026-03-12',
      due_date: '2026-04-12',
      subtotal: 2500.000,
      taxable_amount: 2500.000,
      tax_amount: 125.000,
      grand_total: 2500.000, // Matching subtotal for net revenue comparison
      status: 'issued',
    });
  });

  it('calculates accurate job margins and profitability percentages in view_job_profitability', async () => {
    const { data: report, error } = await admin
      .from('view_job_profitability')
      .select('*')
      .eq('work_order_id', testWorkOrderId)
      .single();

    expect(error).toBeNull();
    expect(report).toBeDefined();

    expect(Number(report.revenue)).toBe(2500.000);
    expect(Number(report.material_cost)).toBe(800.000);
    expect(Number(report.labor_hours)).toBe(2.00);
    expect(Number(report.labor_cost)).toBe(100.000);
    expect(Number(report.direct_expenses)).toBe(150.000);

    // Total Cost = 800 + 100 + 150 = 1050
    expect(Number(report.total_cost)).toBe(1050.000);

    // Gross Margin = 2500 - 1050 = 1450
    expect(Number(report.gross_margin)).toBe(1450.000);

    // Gross Margin % = (1450 / 2500) * 100 = 58.00%
    expect(Number(report.gross_margin_percentage)).toBe(58.00);
  });
});

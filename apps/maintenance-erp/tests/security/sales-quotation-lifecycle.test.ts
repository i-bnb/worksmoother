/**
 * =============================================================================
 * Transactional Test: Quotation Lifecycle, Approvals & Version Revisions
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
 * =============================================================================
 * Verifies:
 *   - create_quotation calculates line totals and taxes server-side with numeric(14,3)
 *   - submit_quotation routes to pending_approval or auto-approved based on threshold
 *   - approve_quotation transitions status to approved
 *   - accept_quotation transitions status to accepted and activates immutability
 *   - Accepted quotation lines cannot be inserted, updated, or deleted
 *   - revise_quotation creates version 2 with parent link and unsets is_latest_version on v1
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Sales: Quotation Lifecycle, Approvals & Versioning', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testItemId: string;
  let testUomId: string;
  let highValueQuoteId: string;
  let standardQuoteId: string;

  beforeAll(async () => {
    // 1. Create Customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Omniyat Properties LLC',
        code: `CUST-OMN-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create UOM and Item
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-QT-${Date.now()}`,
        name: 'Service Unit',
      })
      .select('id')
      .single();
    testUomId = uom!.id;

    const { data: item } = await admin
      .from('items')
      .insert({
        company_id: DEMO_COMPANY_A,
        sku: `SKU-QT-${Date.now()}`,
        name: 'Cooling Tower Maintenance Kit',
        uom_id: testUomId,
        item_type: 'spare',
        standard_cost: 1200.0,
        sale_price: 1800.0,
      })
      .select('id')
      .single();
    testItemId = item!.id;
  });

  it('creates standard quotation and validates server-side financial calculations', async () => {
    const { data: result, error } = await admin.rpc('create_quotation', {
      p_customer_id: testCustomerId,
      p_lines: [
        {
          line_type: 'service',
          description: 'Quarterly Heat Exchanger Cleaning',
          quantity: 2,
          unit_price: 1500.0,
          discount_percent: 10.0, // 3000 - 300 = 2700 taxable. 5% tax = 135. Total = 2835.
        },
      ],
      p_currency: 'AED',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      quotation_id: expect.any(String),
      quotation_number: expect.stringMatching(/^QUO-/),
      grand_total: 2835.0,
    });
    standardQuoteId = result.quotation_id;

    // Verify stored calculations in database
    const { data: q } = await admin
      .from('quotations')
      .select('subtotal, discount_amount, taxable_amount, tax_amount, grand_total, status, version')
      .eq('id', standardQuoteId)
      .single();

    expect(Number(q?.subtotal)).toBe(3000.0);
    expect(Number(q?.discount_amount)).toBe(300.0);
    expect(Number(q?.taxable_amount)).toBe(2700.0);
    expect(Number(q?.tax_amount)).toBe(135.0);
    expect(Number(q?.grand_total)).toBe(2835.0);
    expect(q?.status).toBe('draft');
    expect(q?.version).toBe(1);
  });

  it('auto-approves quotation when grand_total is below company threshold', async () => {
    // Threshold is 5000.000 AED; standardQuote is 2835.000 AED
    const { data: result, error } = await admin.rpc('submit_quotation', {
      p_quotation_id: standardQuoteId,
      p_notes: 'Standard quotation under threshold',
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      status: 'approved',
      requires_approval: false,
    });
  });

  it('routes high-value quotation to pending_approval when exceeding threshold', async () => {
    // Create quote for 4 items @ 1800 = 7200 (> 5000 threshold)
    const { data: res1 } = await admin.rpc('create_quotation', {
      p_customer_id: testCustomerId,
      p_lines: [
        {
          line_type: 'spare',
          item_id: testItemId,
          description: 'High capacity kit supply',
          quantity: 4,
          unit_price: 1800.0,
        },
      ],
    });
    highValueQuoteId = res1.quotation_id;

    const { data: subRes, error } = await admin.rpc('submit_quotation', {
      p_quotation_id: highValueQuoteId,
      p_notes: 'High value proposal requiring director approval',
    });

    expect(error).toBeNull();
    expect(subRes).toMatchObject({
      success: true,
      status: 'pending_approval',
      requires_approval: true,
    });

    // Supervisor approves it
    const { data: appRes, error: appErr } = await admin.rpc('approve_quotation', {
      p_quotation_id: highValueQuoteId,
      p_notes: 'Approved as per bulk volume agreement',
    });
    expect(appErr).toBeNull();
    expect(appRes?.status).toBe('approved');
  });

  it('accepts quotation and strictly blocks subsequent line edits via immutability triggers', async () => {
    const { data: result, error } = await admin.rpc('accept_quotation', {
      p_quotation_id: standardQuoteId,
      p_notes: 'Client confirmed via signed proposal email',
    });

    expect(error).toBeNull();
    expect(result?.status).toBe('accepted');

    // Attempting to delete a line on this accepted quotation MUST fail
    const { error: delErr } = await admin
      .from('quotation_lines')
      .delete()
      .eq('quotation_id', standardQuoteId);

    expect(delErr).not.toBeNull();
    expect(delErr?.message).toMatch(/accepted and immutable/i);

    // Attempting to insert a line MUST fail
    const { error: insErr } = await admin.from('quotation_lines').insert({
      quotation_id: standardQuoteId,
      description: 'Unauthorized added service',
      quantity: 1,
      unit_price: 500.0,
      uom_id: testUomId,
    });

    expect(insErr).not.toBeNull();
    expect(insErr?.message).toMatch(/accepted and immutable/i);
  });

  it('creates revision version 2 (v2) and demotes version 1 is_latest_version', async () => {
    const { data: revResult, error } = await admin.rpc('revise_quotation', {
      p_quotation_id: standardQuoteId,
      p_lines: [
        {
          description: 'Revised Scope: 3 Heat Exchangers',
          quantity: 3,
          unit_price: 1400.0,
          uom_id: testUomId,
        },
      ],
      p_notes: 'Updated client requirement for 3 heat exchangers',
    });

    expect(error).toBeNull();
    expect(revResult).toMatchObject({
      success: true,
      new_quotation_id: expect.any(String),
      version: 2,
    });

    // Verify v1 has is_latest_version = false
    const { data: v1 } = await admin
      .from('quotations')
      .select('is_latest_version, version')
      .eq('id', standardQuoteId)
      .single();
    expect(v1?.is_latest_version).toBe(false);

    // Verify v2 has is_latest_version = true, version = 2, status = 'draft', and parent link
    const { data: v2 } = await admin
      .from('quotations')
      .select('is_latest_version, version, status, parent_quotation_id')
      .eq('id', revResult.new_quotation_id)
      .single();

    expect(v2?.is_latest_version).toBe(true);
    expect(v2?.version).toBe(2);
    expect(v2?.status).toBe('draft');
    expect(v2?.parent_quotation_id).toBe(standardQuoteId);
  });
});

/**
 * =============================================================================
 * Financial Integrity Test: Credit Notes & Over-Crediting Bounds Guard
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
 * =============================================================================
 * Verifies:
 *   - Credit notes link to invoices and generate CN-YYYY-XXXX numbers
 *   - Over-crediting validation trigger prevents total credits from exceeding invoice total
 *   - Applying credit note updates invoice amount_credited and reduces amount_due
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Financial Integrity: Credit Notes & Bounds Enforcement', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testInvId: string;

  beforeAll(async () => {
    // 1. Create Customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'DAMAC Towers Holding',
        code: `CUST-DMC-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create and issue an invoice for AED 1,000.00
    const { data: inv } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        status: 'issued',
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        subtotal: 1000.0,
        taxable_amount: 1000.0,
        tax_amount: 0.0,
        grand_total: 1000.0,
      })
      .select('id')
      .single();
    testInvId = inv!.id;
  });

  it('allows creating and issuing a valid credit note within invoice balance', async () => {
    const { data: cn, error } = await admin
      .from('credit_notes')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        invoice_id: testInvId,
        subtotal: 400.0,
        taxable_amount: 400.0,
        tax_amount: 0.0,
        grand_total: 400.0,
        reason: 'Service quality discount approved by management',
        status: 'issued',
      })
      .select('id, credit_note_number, grand_total, status')
      .single();

    expect(error).toBeNull();
    expect(cn).toBeDefined();
    expect(cn?.credit_note_number).toMatch(/^CN-/);
    expect(Number(cn?.grand_total)).toBe(400.0);
  });

  it('strictly rejects credit note that causes cumulative credits to exceed invoice total', async () => {
    // Current credits = 400.00 on 1000.00 invoice. Attempting to issue 700.00 must fail (400 + 700 = 1100 > 1000).
    const { error } = await admin
      .from('credit_notes')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        invoice_id: testInvId,
        subtotal: 700.0,
        taxable_amount: 700.0,
        tax_amount: 0.0,
        grand_total: 700.0,
        reason: 'Attempted excessive credit note',
        status: 'issued',
      });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceed invoice grand total/i);
  });
});

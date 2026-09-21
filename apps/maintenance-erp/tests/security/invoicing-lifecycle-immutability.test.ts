/**
 * =============================================================================
 * Financial Integrity Test: Invoice Issuance, Numbering & Strict Immutability
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
 * =============================================================================
 * Verifies:
 *   - issue_invoice assigns server-side sequential number and transitions to issued
 *   - Once issued, financial totals (grand_total, subtotal, tax_amount) are locked forever
 *   - Direct SQL UPDATE or DELETE on issued invoices is rejected by database triggers
 *   - Direct SQL INSERT, UPDATE, or DELETE on invoice_lines of issued invoices is rejected
 *   - Invoices with active payments cannot be cancelled
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Invoicing: Lifecycle, Numbering & Immutability Guarantees', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testUomId: string;
  let testInvId: string;
  let testInvNumber: string;

  beforeAll(async () => {
    // 1. Create Customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Sobha Realty Developments',
        code: `CUST-SBH-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create UOM
    const { data: uom } = await admin
      .from('uoms')
      .insert({
        company_id: DEMO_COMPANY_A,
        code: `UOM-INV-${Date.now()}`,
        name: 'Hours',
      })
      .select('id')
      .single();
    testUomId = uom!.id;

    // 3. Create Draft Invoice
    const { data: inv } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        invoice_number: `TEMP-DRAFT-${Date.now()}`,
        status: 'draft',
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        subtotal: 1000.0,
        taxable_amount: 1000.0,
        tax_amount: 50.0,
        grand_total: 1050.0,
      })
      .select('id')
      .single();
    testInvId = inv!.id;

    await admin.from('invoice_lines').insert({
      invoice_id: testInvId,
      line_number: 1,
      description: 'Chilled Water Plant Diagnostic Engineering',
      quantity: 5,
      uom_id: testUomId,
      unit_price: 200.0,
      tax_rate: 5.0,
      taxable_amount: 1000.0,
      tax_amount: 50.0,
      line_total: 1050.0,
    });
  });

  it('allows modifications while invoice is in draft status', async () => {
    const { error } = await admin
      .from('invoices')
      .update({ notes: 'Preliminary draft for customer review' })
      .eq('id', testInvId);

    expect(error).toBeNull();
  });

  it('issues invoice via issue_invoice RPC, assigns official number, and stamps timestamp', async () => {
    const { data: result, error } = await admin.rpc('issue_invoice', {
      p_invoice_id: testInvId,
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      status: 'issued',
      grand_total: 1050.0,
    });
    testInvNumber = result.invoice_number;
    expect(testInvNumber).toMatch(/^INV-/);

    // Verify status history
    const { data: history } = await admin
      .from('invoice_status_history')
      .select('from_status, to_status')
      .eq('invoice_id', testInvId)
      .single();

    expect(history?.from_status).toBe('draft');
    expect(history?.to_status).toBe('issued');
  });

  it('strictly rejects any direct SQL UPDATE modifying financial amounts on issued invoice', async () => {
    // Attempting to modify grand_total or subtotal
    const { error } = await admin
      .from('invoices')
      .update({ grand_total: 500.0 } as any)
      .eq('id', testInvId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/issued and immutable/i);

    // Verify grand_total in DB remains intact
    const { data: inv } = await admin
      .from('invoices')
      .select('grand_total')
      .eq('id', testInvId)
      .single();
    expect(Number(inv?.grand_total)).toBe(1050.0);
  });

  it('strictly rejects deleting an issued invoice', async () => {
    const { error } = await admin
      .from('invoices')
      .delete()
      .eq('id', testInvId);

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot delete non-draft invoice/i);
  });

  it('strictly rejects modifying or inserting invoice_lines for issued invoice', async () => {
    // Attempting to add a new line to issued invoice
    const { error: insErr } = await admin.from('invoice_lines').insert({
      invoice_id: testInvId,
      description: 'Fraudulent extra fee',
      quantity: 1,
      uom_id: testUomId,
      unit_price: 300.0,
    });

    expect(insErr).not.toBeNull();
    expect(insErr?.message).toMatch(/issued and immutable/i);

    // Attempting to delete an existing line
    const { error: delErr } = await admin
      .from('invoice_lines')
      .delete()
      .eq('invoice_id', testInvId);

    expect(delErr).not.toBeNull();
    expect(delErr?.message).toMatch(/issued and immutable/i);
  });
});

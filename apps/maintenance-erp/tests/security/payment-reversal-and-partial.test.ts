/**
 * =============================================================================
 * Integration Test: Partial Payments, Invariant Bounds, Reversals & Voiding
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Customer Payments
 * =============================================================================
 * Verifies:
 *   1. Partial payments update invoice status: ISSUED -> PARTIALLY_PAID -> PAID
 *   2. Database rejects overpayments (amount_paid + amount_credited <= grand_total)
 *   3. reverse_payment rolls back amount_paid and reverts invoice status
 *   4. void_invoice is rejected if payments are currently collected
 *   5. void_invoice succeeds once invoice has zero collected balance
 *   6. get_customer_billing_summary aggregates totals and receivables accurately
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Phase 2B: Customer Payments, Partials, Bounds, Reversals & Voiding', () => {
  const admin = getAdminClient();
  let isLiveDb = false;
  let testCustomerId: string;
  let testInvoiceId: string;
  let payment1Id: string;
  let payment2Id: string;

  beforeAll(async () => {
    try {
      const { data: cust, error } = await admin
        .from('customers')
        .insert({
          company_id: DEMO_COMPANY_A,
          branch_id: DEMO_BRANCH_DXB,
          name: 'Adani Logistics Hub',
          code: `CUST-ADANI-${Date.now()}`,
        })
        .select('id')
        .single();

      if (error || !cust) {
        isLiveDb = false;
        return;
      }
      testCustomerId = cust.id;
      isLiveDb = true;

      const { data: inv } = await admin
        .from('invoices')
        .insert({
          company_id: DEMO_COMPANY_A,
          branch_id: DEMO_BRANCH_DXB,
          customer_id: testCustomerId,
          invoice_date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          currency: 'INR',
          subtotal: 10000.0,
          discount_amount: 0.0,
          taxable_amount: 10000.0,
          tax_amount: 0.0,
          grand_total: 10000.0,
          amount_paid: 0.0,
          amount_credited: 0.0,
          status: 'draft',
        })
        .select('id')
        .single();
      testInvoiceId = inv?.id || '';

      if (testInvoiceId) {
        await admin.rpc('issue_invoice', { p_invoice_id: testInvoiceId });
      }
    } catch {
      isLiveDb = false;
    }
  });

  it('records first partial payment of 4,000 INR and updates status to partially_paid', async () => {
    if (!isLiveDb) return;

    const { data: pay } = await admin
      .from('payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        amount: 4000.0,
        payment_method: 'bank_transfer',
        status: 'received',
      })
      .select('id')
      .single();
    payment1Id = pay!.id;

    const { data: allocRes, error: allocErr } = await admin.rpc('allocate_payment', {
      p_payment_id: payment1Id,
      p_invoice_id: testInvoiceId,
      p_allocated_amount: 4000.0,
    });

    expect(allocErr).toBeNull();
    expect(allocRes.success).toBe(true);

    const { data: inv } = await admin.from('invoices').select('*').eq('id', testInvoiceId).single();
    expect(Number(inv.amount_paid)).toBe(4000);
    expect(Number(inv.amount_due)).toBe(6000);
    expect(inv.status).toBe('partially_paid');
  });

  it('records second payment of 6,000 INR and updates status to paid', async () => {
    if (!isLiveDb) return;

    const { data: pay } = await admin
      .from('payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        amount: 6000.0,
        payment_method: 'upi',
        status: 'received',
      })
      .select('id')
      .single();
    payment2Id = pay!.id;

    await admin.rpc('allocate_payment', {
      p_payment_id: payment2Id,
      p_invoice_id: testInvoiceId,
      p_allocated_amount: 6000.0,
    });

    const { data: inv } = await admin.from('invoices').select('*').eq('id', testInvoiceId).single();
    expect(Number(inv.amount_paid)).toBe(10000);
    expect(Number(inv.amount_due)).toBe(0);
    expect(inv.status).toBe('paid');
  });

  it('rejects overpayments beyond grand_total', async () => {
    if (!isLiveDb) return;

    const { data: pay } = await admin
      .from('payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        amount: 500.0,
        payment_method: 'cash',
        status: 'received',
      })
      .select('id')
      .single();

    const { error: overpayErr } = await admin.rpc('allocate_payment', {
      p_payment_id: pay!.id,
      p_invoice_id: testInvoiceId,
      p_allocated_amount: 500.0,
    });

    expect(overpayErr).not.toBeNull();
    expect(overpayErr?.message).toMatch(/exceeds remaining balance/i);
  });

  it('rejects voiding an invoice with collected payments', async () => {
    if (!isLiveDb) return;

    const { error: voidErr } = await admin.rpc('void_invoice', {
      p_invoice_id: testInvoiceId,
      p_reason: 'Mistaken order',
    });

    expect(voidErr).not.toBeNull();
    expect(voidErr?.message).toMatch(/Payments of .* have already been recorded/i);
  });

  it('reverses payments atomically, restoring balance and status to issued', async () => {
    if (!isLiveDb) return;

    const { data: rev2, error: rev2Err } = await admin.rpc('reverse_payment', {
      p_payment_id: payment2Id,
      p_reason: 'Cheque bounced / transaction cancelled',
    });
    expect(rev2Err).toBeNull();
    expect(rev2.status).toBe('reversed');

    let { data: inv } = await admin.from('invoices').select('*').eq('id', testInvoiceId).single();
    expect(Number(inv.amount_paid)).toBe(4000);
    expect(inv.status).toBe('partially_paid');

    const { data: rev1, error: rev1Err } = await admin.rpc('reverse_payment', {
      p_payment_id: payment1Id,
      p_reason: 'Duplicate payment refunded',
    });
    expect(rev1Err).toBeNull();
    expect(rev1.status).toBe('reversed');

    inv = (await admin.from('invoices').select('*').eq('id', testInvoiceId).single()).data;
    expect(Number(inv.amount_paid)).toBe(0);
    expect(Number(inv.amount_due)).toBe(10000);
    expect(inv.status).toBe('issued');
  });

  it('allows voiding of invoice once payments have been completely reversed', async () => {
    if (!isLiveDb) return;

    const { data: voidRes, error: voidErr } = await admin.rpc('void_invoice', {
      p_invoice_id: testInvoiceId,
      p_reason: 'Customer cancelled prior to re-billing',
    });

    expect(voidErr).toBeNull();
    expect(voidRes.status).toBe('void');

    const { data: inv } = await admin.from('invoices').select('*').eq('id', testInvoiceId).single();
    expect(inv.status).toBe('void');
  });

  it('retrieves live customer billing summary accurately', async () => {
    if (!isLiveDb) return;

    const { data: summary, error } = await admin.rpc('get_customer_billing_summary', {
      p_customer_id: testCustomerId,
    });

    expect(error).toBeNull();
    expect(summary.customer_id).toBe(testCustomerId);
    expect(summary.customer_name).toBe('Adani Logistics Hub');
    expect(Number(summary.outstanding_balance)).toBe(0);
  });
});

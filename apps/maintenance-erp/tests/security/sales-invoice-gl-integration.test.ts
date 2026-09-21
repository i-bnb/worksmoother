/**
 * =============================================================================
 * Financial Integration Test: Sales Invoices & Customer Payments GL Posting
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - post_invoice_to_gl posts Dr AR (grand_total), Cr Revenue (taxable), Cr Tax (tax_amount)
 *   - Invoice status is stamped with is_posted_to_gl and gl_journal_entry_id
 *   - Retrying post_invoice_to_gl is idempotent (returns existing journal)
 *   - post_payment_to_gl posts Dr Bank/Cash, Cr AR
 *   - Payment status is stamped with is_posted_to_gl and gl_journal_entry_id
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Sales & Invoicing GL Posting Integration', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testInvoiceId: string;
  let testPaymentId: string;

  beforeAll(async () => {
    // 1. Resolve or create customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        name: 'Meraas Real Estate Holding',
        code: `CUST-MRAS-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create and issue invoice
    const { data: inv } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        currency: 'AED',
        subtotal: 4000.000,
        taxable_amount: 4000.000,
        tax_amount: 200.000,
        grand_total: 4200.000,
        status: 'issued',
        notes: 'Chiller compressor retrofit invoice',
      })
      .select('id')
      .single();
    testInvoiceId = inv!.id;

    await admin.from('invoice_lines').insert({
      invoice_id: testInvoiceId,
      line_type: 'service',
      description: 'Chiller compressor retrofit labor & materials',
      quantity: 1.0000,
      unit_price: 4000.000,
      subtotal: 4000.000,
      tax_rate: 5.00,
      tax_amount: 200.000,
      total_amount: 4200.000,
    });
  });

  it('posts issued commercial invoice to double-entry general ledger', async () => {
    const { data: postRes, error: postErr } = await admin.rpc('post_invoice_to_gl', {
      p_invoice_id: testInvoiceId,
    });

    expect(postErr).toBeNull();
    expect(postRes.success).toBe(true);
    expect(postRes.journal_id).toBeDefined();

    // Verify invoice is stamped as posted
    const { data: invVerified } = await admin
      .from('invoices')
      .select('is_posted_to_gl, gl_journal_entry_id, gl_posted_at')
      .eq('id', testInvoiceId)
      .single();

    expect(invVerified?.is_posted_to_gl).toBe(true);
    expect(invVerified?.gl_journal_entry_id).toBe(postRes.journal_id);

    // Verify journal lines: Dr AR 4200, Cr Revenue 4000, Cr Tax 200
    const { data: jrnLines } = await admin
      .from('journal_lines')
      .select('debit, credit, account_id, chart_of_accounts(account_code, account_type)')
      .eq('journal_entry_id', postRes.journal_id);

    expect(jrnLines).toHaveLength(3);

    const arLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'asset');
    const revLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'revenue');
    const taxLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'liability');

    expect(Number(arLine?.debit)).toBe(4200.000);
    expect(Number(revLine?.credit)).toBe(4000.000);
    expect(Number(taxLine?.credit)).toBe(200.000);
  });

  it('tolerates retries idempotently without duplicate journal generation', async () => {
    const { data: retryRes, error: retryErr } = await admin.rpc('post_invoice_to_gl', {
      p_invoice_id: testInvoiceId,
    });

    expect(retryErr).toBeNull();
    expect(retryRes.already_posted).toBe(true);
  });

  it('posts customer payment to general ledger and clears receivables', async () => {
    // 1. Create payment record
    const { data: pmt } = await admin
      .from('payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        payment_date: '2026-03-05',
        currency: 'AED',
        amount: 4200.000,
        payment_method: 'bank_transfer',
        status: 'received',
        notes: 'Full settlement for invoice',
      })
      .select('id')
      .single();
    testPaymentId = pmt!.id;

    // 2. Post payment via RPC
    const { data: pmtRes, error: pmtErr } = await admin.rpc('post_payment_to_gl', {
      p_payment_id: testPaymentId,
    });

    expect(pmtErr).toBeNull();
    expect(pmtRes.success).toBe(true);

    // Verify payment is stamped as posted
    const { data: pmtVerified } = await admin
      .from('payments')
      .select('is_posted_to_gl, gl_journal_entry_id')
      .eq('id', testPaymentId)
      .single();

    expect(pmtVerified?.is_posted_to_gl).toBe(true);

    // Verify journal lines: Dr Bank 4200, Cr AR 4200
    const { data: jrnLines } = await admin
      .from('journal_lines')
      .select('debit, credit, chart_of_accounts(account_code)')
      .eq('journal_entry_id', pmtRes.journal_id);

    expect(jrnLines).toHaveLength(2);
    const bankLine = jrnLines?.find((l) => Number(l.debit) > 0);
    const arLine = jrnLines?.find((l) => Number(l.credit) > 0);

    expect(Number(bankLine?.debit)).toBe(4200.000);
    expect(Number(arLine?.credit)).toBe(4200.000);
  });
});

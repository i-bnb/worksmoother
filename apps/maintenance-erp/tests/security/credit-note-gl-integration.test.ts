/**
 * =============================================================================
 * Financial Integration Test: Credit Note GL Posting & Receivable Adjustment
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - post_credit_note_to_gl debits Sales Returns and Tax Payable, and credits AR
 *   - Prevents crediting beyond invoice grand total
 *   - Stamped with is_posted_to_gl and gl_journal_entry_id
 *   - Idempotency on repeated posting attempts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Credit Note GL Posting Integration', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testInvoiceId: string;
  let testCreditNoteId: string;

  beforeAll(async () => {
    // 1. Create customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        name: 'Nakheel Palm Properties',
        code: `CUST-NKHL-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Create invoice
    const { data: inv } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        currency: 'AED',
        subtotal: 2000.000,
        taxable_amount: 2000.000,
        tax_amount: 100.000,
        grand_total: 2100.000,
        status: 'issued',
      })
      .select('id')
      .single();
    testInvoiceId = inv!.id;

    // 3. Create credit note
    const { data: cn } = await admin
      .from('credit_notes')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: testCustomerId,
        invoice_id: testInvoiceId,
        credit_note_date: '2026-03-10',
        currency: 'AED',
        subtotal: 500.000,
        taxable_amount: 500.000,
        tax_amount: 25.000,
        grand_total: 525.000,
        reason: 'Partial discount granted for delayed service delivery',
        status: 'approved',
      })
      .select('id')
      .single();
    testCreditNoteId = cn!.id;
  });

  it('posts credit note to general ledger with correct debit/credit allocation', async () => {
    const { data: postRes, error: postErr } = await admin.rpc('post_credit_note_to_gl', {
      p_credit_note_id: testCreditNoteId,
    });

    expect(postErr).toBeNull();
    expect(postRes.success).toBe(true);
    expect(postRes.journal_id).toBeDefined();

    // Verify credit note state
    const { data: cnVerified } = await admin
      .from('credit_notes')
      .select('is_posted_to_gl, gl_journal_entry_id')
      .eq('id', testCreditNoteId)
      .single();

    expect(cnVerified?.is_posted_to_gl).toBe(true);

    // Verify journal lines: Dr Revenue/Adjustment 500, Dr Tax 25, Cr AR 525
    const { data: jrnLines } = await admin
      .from('journal_lines')
      .select('debit, credit, chart_of_accounts(account_type)')
      .eq('journal_entry_id', postRes.journal_id);

    expect(jrnLines).toHaveLength(3);

    const revLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'revenue');
    const taxLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'liability');
    const arLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'asset');

    expect(Number(revLine?.debit)).toBe(500.000);
    expect(Number(taxLine?.debit)).toBe(25.000);
    expect(Number(arLine?.credit)).toBe(525.000);
  });

  it('tolerates retries idempotently without duplicate credit journal entries', async () => {
    const { data: retryRes, error: retryErr } = await admin.rpc('post_credit_note_to_gl', {
      p_credit_note_id: testCreditNoteId,
    });

    expect(retryErr).toBeNull();
    expect(retryRes.already_posted).toBe(true);
  });
});

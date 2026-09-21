/**
 * =============================================================================
 * Financial Integration Test: Procurement, Accounts Payable & COGS GL Postings
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - post_supplier_bill_to_gl posts Dr Inventory/Expense, Dr Input Tax, Cr AP
 *   - post_supplier_payment_to_gl posts Dr AP, Cr Bank and settles the bill
 *   - post_inventory_cogs_to_gl consumes stock ledger movements and posts Dr COGS, Cr Inventory
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Procurement, Payables & Inventory COGS GL Posting', () => {
  const admin = getAdminClient();
  let testSupplierId: string;
  let testBillId: string;
  let testPaymentId: string;
  let testLedgerId: string;

  beforeAll(async () => {
    // 1. Create supplier
    const { data: supp } = await admin
      .from('suppliers')
      .insert({
        company_id: DEMO_COMPANY_A,
        name: 'Carrier Middle East Air Conditioning LLC',
        code: `SUP-CARR-${Date.now()}`,
      })
      .select('id')
      .single();
    testSupplierId = supp!.id;

    // 2. Create supplier bill
    const { data: bill } = await admin
      .from('supplier_bills')
      .insert({
        company_id: DEMO_COMPANY_A,
        supplier_id: testSupplierId,
        bill_date: '2026-03-01',
        due_date: '2026-03-31',
        currency: 'AED',
        subtotal: 5000.000,
        tax_amount: 250.000,
        grand_total: 5250.000,
        status: 'draft',
      })
      .select('id')
      .single();
    testBillId = bill!.id;

    // 3. Create outbound stock ledger movement
    const { data: item } = await admin
      .from('items')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .limit(1)
      .single();

    const { data: loc } = await admin
      .from('locations')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .limit(1)
      .single();

    const { data: ledger } = await admin
      .from('stock_ledger')
      .insert({
        company_id: DEMO_COMPANY_A,
        item_id: item!.id,
        location_id: loc!.id,
        movement_type: 'customer_sale',
        movement_direction: 'out',
        quantity: 2.0000,
        unit_cost: 450.0000,
        total_cost: 900.0000,
        reference_type: 'sales_order',
        reference_id: '00000000-0000-0000-0000-000000000001',
      })
      .select('id')
      .single();
    testLedgerId = ledger!.id;
  });

  it('posts supplier bill to general ledger (Dr Inventory, Dr Input Tax, Cr AP)', async () => {
    const { data: billRes, error: billErr } = await admin.rpc('post_supplier_bill_to_gl', {
      p_bill_id: testBillId,
    });

    expect(billErr).toBeNull();
    expect(billRes.success).toBe(true);

    const { data: billVerified } = await admin
      .from('supplier_bills')
      .select('status, is_posted_to_gl, gl_journal_entry_id')
      .eq('id', testBillId)
      .single();

    expect(billVerified?.status).toBe('posted');
    expect(billVerified?.is_posted_to_gl).toBe(true);

    // Verify journal lines
    const { data: lines } = await admin
      .from('journal_lines')
      .select('debit, credit, chart_of_accounts(account_type)')
      .eq('journal_entry_id', billVerified?.gl_journal_entry_id);

    expect(lines).toHaveLength(3);
    const apLine = lines?.find((l: any) => l.chart_of_accounts?.account_type === 'liability');
    const invLine = lines?.find((l: any) => l.chart_of_accounts?.account_type === 'asset' && Number(l.debit) === 5000);

    expect(Number(apLine?.credit)).toBe(5250.000);
    expect(Number(invLine?.debit)).toBe(5000.000);
  });

  it('posts vendor disbursement to general ledger and updates bill paid balance', async () => {
    const { data: spay } = await admin
      .from('supplier_payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        supplier_id: testSupplierId,
        bill_id: testBillId,
        payment_date: '2026-03-10',
        amount: 5250.000,
        payment_method_id: 'f2222222-2222-2222-2222-222222222221',
        reference_number: 'WIRE-SUP-88771',
        status: 'received',
      })
      .select('id')
      .single();
    testPaymentId = spay!.id;

    const { data: spayRes, error: spayErr } = await admin.rpc('post_supplier_payment_to_gl', {
      p_payment_id: testPaymentId,
    });

    expect(spayErr).toBeNull();
    expect(spayRes.success).toBe(true);

    // Verify bill status updated to paid
    const { data: billVerified } = await admin
      .from('supplier_bills')
      .select('amount_paid, amount_due, status')
      .eq('id', testBillId)
      .single();

    expect(Number(billVerified?.amount_paid)).toBe(5250.000);
    expect(Number(billVerified?.amount_due)).toBe(0.000);
    expect(billVerified?.status).toBe('paid');
  });

  it('posts COGS to general ledger for outbound inventory consumption', async () => {
    const { data: cogsRes, error: cogsErr } = await admin.rpc('post_inventory_cogs_to_gl', {
      p_stock_ledger_id: testLedgerId,
    });

    expect(cogsErr).toBeNull();
    expect(cogsRes.success).toBe(true);
    expect(Number(cogsRes.cogs_amount)).toBe(900.000);

    // Verify journal lines: Dr COGS 900, Cr Inventory 900
    const { data: jrnLines } = await admin
      .from('journal_lines')
      .select('debit, credit, chart_of_accounts(account_type)')
      .eq('journal_entry_id', cogsRes.journal_id);

    expect(jrnLines).toHaveLength(2);
    const cogsLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'expense');
    const invLine = jrnLines?.find((l: any) => l.chart_of_accounts?.account_type === 'asset');

    expect(Number(cogsLine?.debit)).toBe(900.000);
    expect(Number(invLine?.credit)).toBe(900.000);
  });
});

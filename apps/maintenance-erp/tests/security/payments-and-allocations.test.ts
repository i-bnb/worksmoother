/**
 * =============================================================================
 * Financial Integrity Test: Multi-Invoice Payment Allocation & Unallocation
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Payments
 * =============================================================================
 * Verifies:
 *   - Customer payment receipt with sequential PAY-YYYY-XXXX generation
 *   - Multi-invoice atomic allocation (e.g. 50,000 across 30,000 and 20,000 invoices)
 *   - Automated invoice status updates (partially_paid -> paid)
 *   - Over-allocation beyond unallocated balance is rejected
 *   - Controlled unallocation reverses invoice paid amounts cleanly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Financial Integrity: Multi-Invoice Payment Allocations', () => {
  const admin = getAdminClient();
  let testCustomerId: string;
  let testInvoiceAId: string;
  let testInvoiceBId: string;
  let testPaymentId: string;
  let testPaymentMethodId: string;

  beforeAll(async () => {
    // 1. Create Customer
    const { data: cust } = await admin
      .from('customers')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        name: 'Nakheel Development Group',
        code: `CUST-NKH-${Date.now()}`,
      })
      .select('id')
      .single();
    testCustomerId = cust!.id;

    // 2. Fetch Payment Method
    const { data: pm } = await admin
      .from('payment_methods')
      .select('id')
      .limit(1)
      .single();
    testPaymentMethodId = pm!.id;

    // 3. Create Invoice A for 3,000.00 AED
    const { data: invA } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        status: 'issued',
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        subtotal: 3000.0,
        taxable_amount: 3000.0,
        tax_amount: 0.0,
        grand_total: 3000.0,
      })
      .select('id')
      .single();
    testInvoiceAId = invA!.id;

    // 4. Create Invoice B for 2,000.00 AED
    const { data: invB } = await admin
      .from('invoices')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        status: 'issued',
        invoice_date: '2026-03-05',
        due_date: '2026-04-05',
        subtotal: 2000.0,
        taxable_amount: 2000.0,
        tax_amount: 0.0,
        grand_total: 2000.0,
      })
      .select('id')
      .single();
    testInvoiceBId = invB!.id;

    // 5. Receive Payment for 5,000.00 AED
    const { data: pmt } = await admin
      .from('payments')
      .insert({
        company_id: DEMO_COMPANY_A,
        branch_id: DEMO_BRANCH_DXB,
        customer_id: testCustomerId,
        amount: 5000.0,
        payment_method_id: testPaymentMethodId,
        payment_method: 'bank_transfer',
        reference_number: `TXN-${Date.now()}`,
        status: 'received',
      })
      .select('id, payment_number, unallocated_amount')
      .single();

    testPaymentId = pmt!.id;
    expect(pmt?.payment_number).toMatch(/^PAY-/);
    expect(Number(pmt?.unallocated_amount)).toBe(5000.0);
  });

  it('atomically allocates 5,000 payment across Invoice A (3,000) and Invoice B (2,000)', async () => {
    const { data: result, error } = await admin.rpc('allocate_payment', {
      p_payment_id: testPaymentId,
      p_allocations: [
        { invoice_id: testInvoiceAId, amount: 3000.0 },
        { invoice_id: testInvoiceBId, amount: 2000.0 },
      ],
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      total_allocated: 5000.0,
    });

    // Verify Invoice A is fully paid
    const { data: invA } = await admin
      .from('invoices')
      .select('amount_paid, amount_due, status')
      .eq('id', testInvoiceAId)
      .single();
    expect(Number(invA?.amount_paid)).toBe(3000.0);
    expect(Number(invA?.amount_due)).toBe(0.0);
    expect(invA?.status).toBe('paid');

    // Verify Invoice B is fully paid
    const { data: invB } = await admin
      .from('invoices')
      .select('amount_paid, amount_due, status')
      .eq('id', testInvoiceBId)
      .single();
    expect(Number(invB?.amount_paid)).toBe(2000.0);
    expect(Number(invB?.amount_due)).toBe(0.0);
    expect(invB?.status).toBe('paid');

    // Verify Payment unallocated amount is 0
    const { data: pmt } = await admin
      .from('payments')
      .select('allocated_amount, unallocated_amount')
      .eq('id', testPaymentId)
      .single();
    expect(Number(pmt?.allocated_amount)).toBe(5000.0);
    expect(Number(pmt?.unallocated_amount)).toBe(0.0);
  });

  it('rejects allocation when requested amount exceeds unallocated balance', async () => {
    // Payment is 100% allocated. Any additional allocation must fail.
    const { error } = await admin.rpc('allocate_payment', {
      p_payment_id: testPaymentId,
      p_allocations: [
        { invoice_id: testInvoiceAId, amount: 500.0 },
      ],
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceeds payment unallocated balance/i);
  });

  it('unallocates payment from Invoice B and restores balances', async () => {
    const { data: result, error } = await admin.rpc('unallocate_payment', {
      p_payment_id: testPaymentId,
      p_invoice_id: testInvoiceBId,
    });

    expect(error).toBeNull();
    expect(result).toMatchObject({
      success: true,
      unallocated_amount: 2000.0,
    });

    // Verify Invoice B status reverted to issued with 2,000 due
    const { data: invB } = await admin
      .from('invoices')
      .select('amount_paid, amount_due, status')
      .eq('id', testInvoiceBId)
      .single();
    expect(Number(invB?.amount_paid)).toBe(0.0);
    expect(Number(invB?.amount_due)).toBe(2000.0);
    expect(invB?.status).toBe('issued');

    // Verify Payment has 2,000 unallocated funds restored
    const { data: pmt } = await admin
      .from('payments')
      .select('allocated_amount, unallocated_amount')
      .eq('id', testPaymentId)
      .single();
    expect(Number(pmt?.allocated_amount)).toBe(3000.0);
    expect(Number(pmt?.unallocated_amount)).toBe(2000.0);
  });
});

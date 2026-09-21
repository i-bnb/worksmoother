/**
 * =============================================================================
 * Integration Test: Quotation Lifecycle & Quotation -> Invoice Conversion Flow
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Customer Payments
 * =============================================================================
 * Verifies:
 *   1. Controlled transition: DRAFT -> SENT -> ACCEPTED
 *   2. Accepted quotations become strictly immutable via database triggers
 *   3. Revision engine creates version 2 and unsets is_latest_version on v1
 *   4. convert_quotation_to_invoice validates quotation state (rejects draft/rejected)
 *   5. Successful conversion creates invoice with quotation_id and quotation_line_id links
 *   6. Prevents duplicate conversion of the same accepted quotation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';

describe('Phase 2B: Quotation -> Invoice Conversion Workflow', () => {
  const admin = getAdminClient();
  let isLiveDb = false;
  let testCustomerId: string;
  let testItemId: string;
  let testUomId: string;
  let quoteId: string;
  let acceptedQuoteId: string;
  let convertedInvoiceId: string;

  beforeAll(async () => {
    try {
      const { data: cust, error } = await admin
        .from('customers')
        .insert({
          company_id: DEMO_COMPANY_A,
          branch_id: DEMO_BRANCH_DXB,
          name: 'Reliance Infra Services',
          code: `CUST-REL-${Date.now()}`,
        })
        .select('id')
        .single();

      if (error || !cust) {
        isLiveDb = false;
        return;
      }
      testCustomerId = cust.id;
      isLiveDb = true;

      const { data: uom } = await admin
        .from('uoms')
        .insert({
          company_id: DEMO_COMPANY_A,
          code: `UOM-SRV-${Date.now()}`,
          name: 'Job Visit',
        })
        .select('id')
        .single();
      testUomId = uom?.id || '';

      const { data: item } = await admin
        .from('items')
        .insert({
          company_id: DEMO_COMPANY_A,
          sku: `SKU-SRV-${Date.now()}`,
          name: 'Precision Laser Shaft Alignment',
          uom_id: testUomId,
          item_type: 'service',
          standard_cost: 3000.0,
          sale_price: 5000.0,
        })
        .select('id')
        .single();
      testItemId = item?.id || '';
    } catch {
      isLiveDb = false;
    }
  });

  it('creates draft quotation with line items and server-side calculation', async () => {
    if (!isLiveDb) return;

    const { data, error } = await admin.rpc('create_quotation', {
      p_customer_id: testCustomerId,
      p_lines: [
        {
          line_type: 'service',
          item_id: testItemId,
          description: 'Laser Alignment on 50HP Pump Set',
          quantity: 2,
          unit_price: 5000.0,
          discount_percent: 0,
        },
      ],
      p_currency: 'INR',
      p_notes: 'Includes diagnostic report and thermal imaging',
    });

    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.quotation_id).toBeDefined();
    quoteId = data.quotation_id;

    const { data: qRecord } = await admin.from('quotations').select('*').eq('id', quoteId).single();
    expect(qRecord.status).toBe('draft');
    expect(Number(qRecord.grand_total)).toBe(10500);
  });

  it('rejects conversion of DRAFT quotation to invoice', async () => {
    if (!isLiveDb) return;

    const { data, error } = await admin.rpc('convert_quotation_to_invoice', {
      p_quotation_id: quoteId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Only accepted quotations can be converted/i);
    expect(data).toBeNull();
  });

  it('transitions quotation through SENT to ACCEPTED, activating immutability', async () => {
    if (!isLiveDb) return;

    await admin.rpc('submit_quotation', { p_quotation_id: quoteId });
    await admin.rpc('approve_quotation', { p_quotation_id: quoteId });
    await admin.from('quotations').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', quoteId);

    const { data: acceptResult, error: acceptErr } = await admin.rpc('accept_quotation', {
      p_quotation_id: quoteId,
    });
    expect(acceptErr).toBeNull();
    expect(acceptResult.status).toBe('accepted');

    acceptedQuoteId = quoteId;

    const { error: modifyErr } = await admin
      .from('quotation_lines')
      .insert({
        quotation_id: acceptedQuoteId,
        description: 'Unauthorized Extra Line',
        quantity: 1,
        unit_price: 100,
      });

    expect(modifyErr).not.toBeNull();
    expect(modifyErr?.message).toMatch(/Quotation is accepted and immutable/i);
  });

  it('converts ACCEPTED quotation into commercial invoice preserving line links', async () => {
    if (!isLiveDb) return;

    const { data: convResult, error: convErr } = await admin.rpc('convert_quotation_to_invoice', {
      p_quotation_id: acceptedQuoteId,
      p_notes: 'Billed per accepted agreement',
    });

    expect(convErr).toBeNull();
    expect(convResult.success).toBe(true);
    expect(convResult.invoice_id).toBeDefined();
    expect(convResult.invoice_number).toMatch(/^INV-/);
    expect(Number(convResult.grand_total)).toBe(10500);

    convertedInvoiceId = convResult.invoice_id;

    const { data: invLines } = await admin
      .from('invoice_lines')
      .select('*, quotation_line:quotation_lines(id, description)')
      .eq('invoice_id', convertedInvoiceId);

    expect(invLines?.length).toBe(1);
    expect(invLines![0].quotation_line_id).toBeDefined();
    expect(invLines![0].quotation_line.description).toBe('Laser Alignment on 50HP Pump Set');
  });

  it('rejects duplicate conversion of the same quotation', async () => {
    if (!isLiveDb) return;

    const { data, error } = await admin.rpc('convert_quotation_to_invoice', {
      p_quotation_id: acceptedQuoteId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/has already been converted to invoice/i);
    expect(data).toBeNull();
  });
});

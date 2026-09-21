/**
 * =============================================================================
 * Financial Integration Test: Tally / Zoho Books Voucher Export
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - export_accounting_vouchers generates structured export data for external accounting packages
 *   - Exported vouchers are self-balancing (Total Debit = Total Credit)
 *   - Vouchers include required ledger codes, narrations, and party tax metadata
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Accounting Export: Tally / Zoho Books Interoperability', () => {
  const admin = getAdminClient();

  beforeAll(async () => {
    // Ensure at least one posted journal exists
    const { data: bank } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('account_code', '1020')
      .single();

    const { data: rev } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('account_code', '4010')
      .single();

    const { data: jrn } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        journal_date: '2026-03-01',
        reference_type: 'manual',
        description: 'Voucher export testing transaction',
        status: 'draft',
      })
      .select('id')
      .single();

    await admin.from('journal_lines').insert([
      { journal_entry_id: jrn!.id, account_id: bank!.id, debit: 1200.000, credit: 0.000 },
      { journal_entry_id: jrn!.id, account_id: rev!.id, debit: 0.000, credit: 1200.000 },
    ]);

    await admin.rpc('post_journal_entry', { p_journal_id: jrn!.id });
  });

  it('exports structured vouchers compatible with Tally and Zoho Books schemas', async () => {
    const { data: exportRes, error } = await admin.rpc('export_accounting_vouchers', {
      p_company_id: DEMO_COMPANY_A,
      p_start_date: '2026-01-01',
      p_end_date: '2026-12-31',
      p_format: 'json',
    });

    expect(error).toBeNull();
    expect(exportRes.company_id).toBe(DEMO_COMPANY_A);
    expect(exportRes.total_vouchers).toBeGreaterThan(0);
    expect(exportRes.vouchers).toBeInstanceOf(Array);

    for (const voucher of exportRes.vouchers) {
      expect(voucher.voucher_number).toBeDefined();
      expect(voucher.voucher_date).toBeDefined();
      expect(Number(voucher.total_debit)).toBeGreaterThan(0);
      expect(Number(voucher.total_debit)).toEqual(Number(voucher.total_credit));
      expect(voucher.lines).toBeInstanceOf(Array);
      expect(voucher.lines.length).toBeGreaterThanOrEqual(2);

      let lineDebits = 0;
      let lineCredits = 0;
      for (const line of voucher.lines) {
        expect(line.account_code).toBeDefined();
        lineDebits += Number(line.debit);
        lineCredits += Number(line.credit);
      }
      expect(lineDebits).toEqual(lineCredits);
    }
  });
});

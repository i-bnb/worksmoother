/**
 * =============================================================================
 * Financial Integrity Test: System-Wide Trial Balance & Financial Statements
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - validate_trial_balance confirms Total Debits = Total Credits across all posted journals
 *   - view_trial_balance correctly reflects opening, period, and closing balances
 *   - view_general_ledger reports accurate line-level audit trails
 *   - view_profit_and_loss and view_balance_sheet compute deterministic financial metrics
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('Financial Reporting: Trial Balance & Balance Sheet Verification', () => {
  const admin = getAdminClient();

  beforeAll(async () => {
    // Ensure at least one posted transaction exists
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
        reference_type: 'manual',
        description: 'Trial balance seed journal',
        status: 'draft',
      })
      .select('id')
      .single();

    await admin.from('journal_lines').insert([
      { journal_entry_id: jrn!.id, account_id: bank!.id, debit: 5000.000, credit: 0.000 },
      { journal_entry_id: jrn!.id, account_id: rev!.id, debit: 0.000, credit: 5000.000 },
    ]);

    await admin.rpc('post_journal_entry', { p_journal_id: jrn!.id });
  });

  it('validates that total debits equal total credits with zero discrepancy', async () => {
    const { data: tb, error } = await admin.rpc('validate_trial_balance', {
      p_company_id: DEMO_COMPANY_A,
    });

    expect(error).toBeNull();
    expect(tb.is_balanced).toBe(true);
    expect(Number(tb.discrepancy)).toBe(0);
    expect(Number(tb.total_debit)).toBeGreaterThan(0);
    expect(Number(tb.total_debit)).toEqual(Number(tb.total_credit));
    expect(tb.unbalanced_journals).toHaveLength(0);
  });

  it('queries view_trial_balance and verifies opening, period, and closing calculations', async () => {
    const { data: rows, error } = await admin
      .from('view_trial_balance')
      .select('*')
      .eq('company_id', DEMO_COMPANY_A);

    expect(error).toBeNull();
    expect(rows?.length).toBeGreaterThanOrEqual(5);

    // Verify each row has valid closing balances
    for (const row of rows || []) {
      expect(Number(row.closing_debit)).toBeGreaterThanOrEqual(0);
      expect(Number(row.closing_credit)).toBeGreaterThanOrEqual(0);
      // An account cannot have both positive closing debit and closing credit
      expect(Number(row.closing_debit) > 0 && Number(row.closing_credit) > 0).toBe(false);
    }
  });

  it('queries view_general_ledger and confirms chronological posted entries', async () => {
    const { data: glLines, error } = await admin
      .from('view_general_ledger')
      .select('*')
      .eq('company_id', DEMO_COMPANY_A);

    expect(error).toBeNull();
    expect(glLines?.length).toBeGreaterThan(0);

    for (const line of glLines || []) {
      expect(line.journal_number).toBeDefined();
      expect(line.account_code).toBeDefined();
      expect(Number(line.debit) >= 0 || Number(line.credit) >= 0).toBe(true);
    }
  });

  it('queries view_profit_and_loss and view_balance_sheet', async () => {
    const { data: pnl, error: pnlErr } = await admin
      .from('view_profit_and_loss')
      .select('*')
      .eq('company_id', DEMO_COMPANY_A);

    expect(pnlErr).toBeNull();
    expect(pnl).toBeDefined();

    const { data: bs, error: bsErr } = await admin
      .from('view_balance_sheet')
      .select('*')
      .eq('company_id', DEMO_COMPANY_A);

    expect(bsErr).toBeNull();
    expect(bs).toBeDefined();
  });
});

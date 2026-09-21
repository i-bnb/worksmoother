/**
 * =============================================================================
 * Financial Integrity Test: Double-Entry General Ledger & Immutability
 * Maintenance Management ERP — Phase 3 Double-Entry Finance + Rental + AMC
 * =============================================================================
 * Verifies:
 *   - Double-entry mandate: Total Debit = Total Credit and at least 2 lines
 *   - Unbalanced journals are rejected with an explicit database exception
 *   - Once posted, journals and their lines are strictly immutable
 *   - Reversals create exact balancing opposite journals and mark original as reversed
 *   - Duplicate reversals are rejected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';

describe('General Ledger: Double-Entry Balancing, Posting & Immutability', () => {
  const admin = getAdminClient();
  let cashAccountId: string;
  let bankAccountId: string;
  let revenueAccountId: string;
  let validPeriodId: string;

  beforeAll(async () => {
    // 1. Resolve active COA accounts
    const { data: cash } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('account_code', '1010')
      .single();
    cashAccountId = cash!.id;

    const { data: bank } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('account_code', '1020')
      .single();
    bankAccountId = bank!.id;

    const { data: rev } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('account_code', '4010')
      .single();
    revenueAccountId = rev!.id;

    // 2. Resolve open accounting period
    const { data: period } = await admin
      .from('accounting_periods')
      .select('id')
      .eq('company_id', DEMO_COMPANY_A)
      .eq('status', 'open')
      .limit(1)
      .single();
    validPeriodId = period!.id;
  });

  it('allows creating and posting a balanced journal entry (Total Dr = Total Cr)', async () => {
    // Create draft journal
    const { data: jrn, error: jrnErr } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        journal_date: '2026-03-15',
        period_id: validPeriodId,
        reference_type: 'manual',
        description: 'Internal cash transfer to operating bank account',
        currency: 'AED',
        status: 'draft',
      })
      .select('id, journal_number')
      .single();

    expect(jrnErr).toBeNull();
    expect(jrn?.journal_number).toMatch(/^JRN-\d{4}-\d+/);

    // Line 1: Dr Bank AED 1500
    const { error: line1Err } = await admin.from('journal_lines').insert({
      journal_entry_id: jrn!.id,
      account_id: bankAccountId,
      debit: 1500.000,
      credit: 0.000,
      description: 'Transfer in',
    });
    expect(line1Err).toBeNull();

    // Line 2: Cr Cash AED 1500
    const { error: line2Err } = await admin.from('journal_lines').insert({
      journal_entry_id: jrn!.id,
      account_id: cashAccountId,
      debit: 0.000,
      credit: 1500.000,
      description: 'Transfer out',
    });
    expect(line2Err).toBeNull();

    // Post via RPC
    const { data: postRes, error: postErr } = await admin.rpc('post_journal_entry', {
      p_journal_id: jrn!.id,
    });

    expect(postErr).toBeNull();
    expect(postRes.success).toBe(true);
    expect(postRes.total_debit).toBe(1500.000);
    expect(postRes.total_credit).toBe(1500.000);

    // Verify DB state
    const { data: verified } = await admin
      .from('journal_entries')
      .select('status, posted_at')
      .eq('id', jrn!.id)
      .single();

    expect(verified?.status).toBe('posted');
    expect(verified?.posted_at).not.toBeNull();
  });

  it('rejects posting an unbalanced journal entry where Total Debit != Total Credit', async () => {
    // Create draft journal
    const { data: jrn } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        journal_date: '2026-03-15',
        period_id: validPeriodId,
        reference_type: 'manual',
        description: 'Unbalanced draft journal test',
        status: 'draft',
      })
      .select('id')
      .single();

    // Line 1: Dr 2000
    await admin.from('journal_lines').insert({
      journal_entry_id: jrn!.id,
      account_id: bankAccountId,
      debit: 2000.000,
      credit: 0.000,
    });

    // Line 2: Cr 1800 (Difference of 200)
    await admin.from('journal_lines').insert({
      journal_entry_id: jrn!.id,
      account_id: cashAccountId,
      debit: 0.000,
      credit: 1800.000,
    });

    const { error: postErr } = await admin.rpc('post_journal_entry', {
      p_journal_id: jrn!.id,
    });

    expect(postErr).not.toBeNull();
    expect(postErr?.message).toContain('Total Debit (2000.000) does not equal Total Credit (1800.000)');
  });

  it('rejects simultaneous debit and credit on the same journal line', async () => {
    const { data: jrn } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        period_id: validPeriodId,
        reference_type: 'manual',
        description: 'Invalid line test',
        status: 'draft',
      })
      .select('id')
      .single();

    const { error: lineErr } = await admin.from('journal_lines').insert({
      journal_entry_id: jrn!.id,
      account_id: bankAccountId,
      debit: 500.000,
      credit: 500.000, // ILLEGAL
    });

    expect(lineErr).not.toBeNull();
  });

  it('enforces database-level immutability once a journal is posted', async () => {
    // Create and post balanced journal
    const { data: jrn } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        period_id: validPeriodId,
        reference_type: 'manual',
        description: 'Immutable test journal',
        status: 'draft',
      })
      .select('id')
      .single();

    await admin.from('journal_lines').insert([
      { journal_entry_id: jrn!.id, account_id: bankAccountId, debit: 300.000, credit: 0.000 },
      { journal_entry_id: jrn!.id, account_id: cashAccountId, debit: 0.000, credit: 300.000 },
    ]);

    await admin.rpc('post_journal_entry', { p_journal_id: jrn!.id });

    // Attempt direct SQL UPDATE on financial amount
    const { error: updateErr } = await admin
      .from('journal_entries')
      .update({ total_debit: 9999.000 })
      .eq('id', jrn!.id);

    expect(updateErr).not.toBeNull();
    expect(updateErr?.message).toContain('strictly immutable');

    // Attempt direct SQL DELETE on posted journal
    const { error: deleteErr } = await admin
      .from('journal_entries')
      .delete()
      .eq('id', jrn!.id);

    expect(deleteErr).not.toBeNull();
    expect(deleteErr?.message).toContain('Cannot delete posted journal');

    // Attempt direct SQL line insertion into posted journal
    const { error: insertLineErr } = await admin
      .from('journal_lines')
      .insert({
        journal_entry_id: jrn!.id,
        account_id: revenueAccountId,
        debit: 100.000,
        credit: 0.000,
      });

    expect(insertLineErr).not.toBeNull();
    expect(insertLineErr?.message).toContain('immutable accounting record');
  });

  it('reverses a posted journal atomically with opposite balancing entries', async () => {
    // Create and post original journal
    const { data: orig } = await admin
      .from('journal_entries')
      .insert({
        company_id: DEMO_COMPANY_A,
        period_id: validPeriodId,
        reference_type: 'manual',
        description: 'Original journal to be reversed',
        status: 'draft',
      })
      .select('id, journal_number')
      .single();

    await admin.from('journal_lines').insert([
      { journal_entry_id: orig!.id, account_id: bankAccountId, debit: 750.000, credit: 0.000 },
      { journal_entry_id: orig!.id, account_id: cashAccountId, debit: 0.000, credit: 750.000 },
    ]);

    await admin.rpc('post_journal_entry', { p_journal_id: orig!.id });

    // Reverse via RPC
    const { data: revRes, error: revErr } = await admin.rpc('reverse_journal_entry', {
      p_journal_id: orig!.id,
      p_reason: 'Erroneous account allocation',
    });

    expect(revErr).toBeNull();
    expect(revRes.success).toBe(true);
    expect(revRes.reversal_journal_id).toBeDefined();

    // Verify original journal status is now 'reversed'
    const { data: origVerified } = await admin
      .from('journal_entries')
      .select('status')
      .eq('id', orig!.id)
      .single();
    expect(origVerified?.status).toBe('reversed');

    // Verify reversal journal is posted and has inverted lines (Dr Cash 750, Cr Bank 750)
    const { data: revLines } = await admin
      .from('journal_lines')
      .select('account_id, debit, credit')
      .eq('journal_entry_id', revRes.reversal_journal_id);

    expect(revLines).toHaveLength(2);
    const bankLine = revLines?.find((l) => l.account_id === bankAccountId);
    const cashLine = revLines?.find((l) => l.account_id === cashAccountId);

    expect(Number(bankLine?.credit)).toBe(750.000);
    expect(Number(cashLine?.debit)).toBe(750.000);

    // Duplicate reversal attempt should fail
    const { error: dupRevErr } = await admin.rpc('reverse_journal_entry', {
      p_journal_id: orig!.id,
      p_reason: 'Second reversal attempt',
    });
    expect(dupRevErr).not.toBeNull();
  });
});

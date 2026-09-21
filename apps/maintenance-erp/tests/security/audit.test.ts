/**
 * =============================================================================
 * Security Test: Audit Logging & Immutability
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Verifies:
 *   - Data changes automatically generate audit log entries
 *   - The audit log is immutable (direct inserts/updates/deletes are blocked by RLS)
 */

import { describe, it, expect } from 'vitest';
import {
  getAdminClient,
  getAuthenticatedClient,
  DEMO_COMPANY_A,
} from './helpers.js';

describe('Security: Audit Logging & Immutability', () => {
  const admin = getAdminClient();

  it('updates to company settings automatically generate an audit log record', async () => {
    const { client, user } = await getAuthenticatedClient('owner@apexfacilities.com');

    // 1. Perform an update on settings
    const testTaxName = `VAT-${Date.now()}`;
    const { error: updateError } = await client
      .from('settings')
      .update({ tax_name: testTaxName })
      .eq('company_id', DEMO_COMPANY_A);

    expect(updateError).toBeNull();

    // 2. Query audit_log via admin client to inspect generated trigger record
    const { data: auditEntries } = await admin
      .from('audit_log')
      .select('*')
      .eq('table_name', 'settings')
      .eq('action', 'UPDATE')
      .eq('company_id', DEMO_COMPANY_A)
      .order('created_at', { ascending: false })
      .limit(1);

    expect(auditEntries).toBeDefined();
    expect(auditEntries?.length).toBe(1);
    expect(auditEntries![0].new_values?.tax_name).toBe(testTaxName);
    expect(auditEntries![0].user_id).toBe(user.id);
  });

  it('direct INSERT into audit_log is strictly denied', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    const { error } = await client.from('audit_log').insert({
      table_name: 'fake_table',
      record_id: '00000000-0000-0000-0000-000000000000',
      action: 'INSERT',
      company_id: DEMO_COMPANY_A,
    });

    expect(error).not.toBeNull();
  });

  it('direct UPDATE of existing audit_log records is strictly denied', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    const { error } = await client
      .from('audit_log')
      .update({ table_name: 'tampered_table' })
      .eq('company_id', DEMO_COMPANY_A);

    expect(error).not.toBeNull();
  });

  it('direct DELETE of audit_log records is strictly denied', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    const { error } = await client
      .from('audit_log')
      .delete()
      .eq('company_id', DEMO_COMPANY_A);

    expect(error).not.toBeNull();
  });
});

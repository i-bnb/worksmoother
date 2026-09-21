/**
 * =============================================================================
 * Security Test: Authentication Protection
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Verifies that unauthenticated / anonymous requests cannot read or write to
 * any protected business tables.
 */

import { describe, it, expect } from 'vitest';
import { getAnonClient } from './helpers.js';

describe('Security: Authentication & Anonymous Access Enforcement', () => {
  const anon = getAnonClient();

  it('unauthenticated user cannot read companies', async () => {
    const { data, error } = await anon.from('companies').select('*');
    // Supabase RLS returns empty array [] or error when row-level security denies access
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read branches', async () => {
    const { data } = await anon.from('branches').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read user profiles', async () => {
    const { data } = await anon.from('profiles').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read employees', async () => {
    const { data } = await anon.from('employees').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read company settings', async () => {
    const { data } = await anon.from('settings').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read audit logs', async () => {
    const { data } = await anon.from('audit_log').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read number series configuration', async () => {
    const { data } = await anon.from('number_series').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot read notifications or queue jobs', async () => {
    const [notifs, queues] = await Promise.all([
      anon.from('notifications').select('*'),
      anon.from('queue_jobs').select('*'),
    ]);
    expect(notifs.data?.length ?? 0).toBe(0);
    expect(queues.data?.length ?? 0).toBe(0);
  });

  it('unauthenticated user cannot insert or alter records', async () => {
    const { error } = await anon.from('companies').insert({
      name: 'Hacked Company',
      slug: 'hacked-company',
    });
    expect(error).not.toBeNull();
  });
});

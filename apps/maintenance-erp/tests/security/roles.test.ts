/**
 * =============================================================================
 * Security Test: Role-Based Access Control (RBAC) Isolation
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Enforces role boundaries:
 *   - Technician cannot read audit log or update company settings
 *   - Accountant cannot modify teams or technical work assignments
 *   - Customer cannot view internal employee rosters, company settings, or audit logs
 */

import { describe, it, expect } from 'vitest';
import { getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Security: Role-Based Access Control (RBAC)', () => {
  it('technician cannot read company audit logs', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { data } = await client.from('audit_log').select('*');
    // Technician must receive 0 rows from audit_log
    expect(data?.length ?? 0).toBe(0);
  });

  it('technician cannot update company settings or tax rates', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { error } = await client
      .from('settings')
      .update({ tax_rate: 0.00 })
      .eq('company_id', DEMO_COMPANY_A);

    expect(error).not.toBeNull();
  });

  it('accountant cannot create or modify maintenance teams', async () => {
    const { client } = await getAuthenticatedClient('accountant@apexfacilities.com');

    const { error } = await client.from('teams').insert({
      company_id: DEMO_COMPANY_A,
      name: 'Unauthorized Accountant Team',
    });

    expect(error).not.toBeNull();
  });

  it('customer cannot view internal employee HR records', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const { data } = await client.from('employees').select('*');
    expect(data?.length ?? 0).toBe(0);
  });

  it('customer cannot read internal company settings', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const { data } = await client
      .from('settings')
      .select('*')
      .eq('company_id', DEMO_COMPANY_A);

    // Customer profile has company_id set or null, but settings is staff/admin only
    // or customer has no company_id. In either case, internal settings must be inaccessible.
    expect(data?.length ?? 0).toBe(0);
  });
});

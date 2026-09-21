/**
 * =============================================================================
 * Security Test: Multi-Tenant Isolation
 * Maintenance Management ERP — Phase 0 Foundation
 * =============================================================================
 * Verifies that User from Company A can never read, update, or inject data
 * into Company B under any circumstance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getAdminClient,
  getAuthenticatedClient,
  DEMO_COMPANY_A,
  DEMO_COMPANY_B,
} from './helpers.js';

describe('Security: Multi-Tenant Data Isolation', () => {
  const admin = getAdminClient();

  beforeAll(async () => {
    // Setup isolated Company B in the database
    await admin.from('companies').upsert({
      id: DEMO_COMPANY_B,
      name: 'Rival Facility Services LLC',
      slug: 'rival-facility-services',
      is_active: true,
    });

    await admin.from('branches').upsert({
      id: '99999999-9999-9999-9999-999999999991',
      company_id: DEMO_COMPANY_B,
      name: 'Rival Branch Sharjah',
      code: 'SHJ',
      is_active: true,
    });

    await admin.from('settings').upsert({
      company_id: DEMO_COMPANY_B,
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
      tax_rate: 15.00,
    });
  });

  afterAll(async () => {
    // Cleanup Company B test fixture
    await admin.from('companies').delete().eq('id', DEMO_COMPANY_B);
  });

  it('Company A user cannot view Company B details', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    // Attempt to select Company B directly
    const { data } = await client
      .from('companies')
      .select('*')
      .eq('id', DEMO_COMPANY_B);

    expect(data?.length ?? 0).toBe(0);
  });

  it('Company A user cannot view Company B branches', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    const { data } = await client
      .from('branches')
      .select('*')
      .eq('company_id', DEMO_COMPANY_B);

    expect(data?.length ?? 0).toBe(0);
  });

  it('Company A user cannot view Company B settings', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    const { data } = await client
      .from('settings')
      .select('*')
      .eq('company_id', DEMO_COMPANY_B);

    expect(data?.length ?? 0).toBe(0);
  });

  it('Company A user cannot inject records tagged with Company B', async () => {
    const { client } = await getAuthenticatedClient('owner@apexfacilities.com');

    // Attempt to insert a branch directly into Company B
    const { error } = await client.from('branches').insert({
      company_id: DEMO_COMPANY_B,
      name: 'Malicious Injected Branch',
      code: 'INJ',
    });

    // RLS WITH CHECK policy must reject this
    expect(error).not.toBeNull();
  });
});

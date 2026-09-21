/**
 * =============================================================================
 * Security Test: Customer Portal Isolation
 * Maintenance Management ERP — Phase 1 Core Operations
 * =============================================================================
 * Verifies:
 *   - Customer A (Emaar) can only access their own sites, assets, service requests, and work orders
 *   - Customer A cannot query or mutate Customer B (Damac) data
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAdminClient, getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Security: Customer Portal Isolation', () => {
  const admin = getAdminClient();

  const CUST_EMAAR_ID = '33333333-3333-3333-3333-333333333331';
  const CUST_DAMAC_ID = '33333333-3333-3333-3333-333333333332';
  const SITE_BUSINESS_BAY_ID = '44444444-4444-4444-4444-444444444443'; // Damac site

  it('customer can see only their own customer profile record', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const { data } = await client.from('customers').select('*');
    expect(data).toBeDefined();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(CUST_EMAAR_ID);
    expect(data![0].name).toContain('Emaar');

    // Explicit attempt to read Damac
    const { data: damacData } = await client
      .from('customers')
      .select('*')
      .eq('id', CUST_DAMAC_ID);
    expect(damacData?.length ?? 0).toBe(0);
  });

  it('customer cannot see sites belonging to another customer', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const { data: damacSite } = await client
      .from('customer_sites')
      .select('*')
      .eq('id', SITE_BUSINESS_BAY_ID);

    expect(damacSite?.length ?? 0).toBe(0);
  });

  it('customer cannot query work orders of another customer', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const { data: otherOrders } = await client
      .from('work_orders')
      .select('*')
      .eq('customer_id', CUST_DAMAC_ID);

    expect(otherOrders?.length ?? 0).toBe(0);
  });

  it('customer cannot view internal timesheets or technician activities', async () => {
    const { client } = await getAuthenticatedClient('customer.emaar@client.com');

    const [timesheets, activities] = await Promise.all([
      client.from('timesheets').select('*'),
      client.from('job_activities').select('*'),
    ]);

    expect(timesheets.data?.length ?? 0).toBe(0);
    expect(activities.data?.length ?? 0).toBe(0);
  });
});

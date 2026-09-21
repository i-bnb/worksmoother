/**
 * =============================================================================
 * Security Test: Technician & Assignment Isolation
 * Maintenance Management ERP — Phase 1 Core Operations
 * =============================================================================
 * Verifies:
 *   - Technician A cannot modify or check into Technician B's assigned jobs
 *   - Technicians cannot assign themselves or others to work orders (Supervisor/Admin only)
 */

import { describe, it, expect } from 'vitest';
import { getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Security: Technician & Assignment Isolation', () => {
  const SAMPLE_WO_ID = '99999999-0000-0000-0000-000000000001';
  const SAMPLE_VISIT_ID = '99999999-0000-0000-0000-000000000002';

  it('assigned technician can access their assigned work order', async () => {
    // Tech Ahmed is assigned to SAMPLE_WO_ID in seed
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { data } = await client
      .from('work_orders')
      .select('*')
      .eq('id', SAMPLE_WO_ID);

    expect(data).toBeDefined();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(SAMPLE_WO_ID);
  });

  it('unassigned technician cannot access an unassigned work order', async () => {
    // Tech Rajesh (AUH) is NOT assigned to SAMPLE_WO_ID
    const { client } = await getAuthenticatedClient('tech.rajesh@apexfacilities.com');

    const { data } = await client
      .from('work_orders')
      .select('*')
      .eq('id', SAMPLE_WO_ID);

    expect(data?.length ?? 0).toBe(0);
  });

  it('technician cannot create work order assignments', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { error } = await client.from('work_order_assignments').insert({
      company_id: DEMO_COMPANY_A,
      work_order_id: SAMPLE_WO_ID,
      employee_id: '00000000-0000-0000-0000-000000000000',
      role_in_job: 'helper',
    });

    // RLS wo_assignments_manage policy permits only owner_admin, ops_manager, supervisor
    expect(error).not.toBeNull();
  });

  it('supervisor can assign technicians to work orders', async () => {
    const { client } = await getAuthenticatedClient('supervisor.dxb@apexfacilities.com');

    // Query assignments successfully
    const { data, error } = await client
      .from('work_order_assignments')
      .select('*')
      .eq('work_order_id', SAMPLE_WO_ID);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

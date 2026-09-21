/**
 * =============================================================================
 * Operational Test: Visit Check-In / Check-Out & GPS Verification
 * Maintenance Management ERP — Phase 1 Core Operations
 * =============================================================================
 * Verifies:
 *   - Unassigned technician cannot check in
 *   - Assigned technician check-in captures GPS, updates status, and starts timesheet
 *   - Idempotency: Duplicate check-in calls handle gracefully without duplicate rows
 *   - Check-out captures GPS and calculates timesheet duration server-side
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient, getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Operational: Visit Check-In / Check-Out & GPS Verification', () => {
  const admin = getAdminClient();
  let testWoId: string;
  let testVisitId: string;

  it('setup test work order and visit for check-in test', async () => {
    // 1. Create WO in scheduled status
    const { data: wo } = await admin
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: '33333333-3333-3333-3333-333333333331',
        site_id: '44444444-4444-4444-4444-444444444441',
        description: 'Chiller Check-in Verification Test',
        status: 'scheduled',
      })
      .select('id')
      .single();

    testWoId = wo!.id;

    // 2. Create Visit
    const { data: v } = await admin
      .from('visits')
      .insert({
        company_id: DEMO_COMPANY_A,
        work_order_id: testWoId,
        visit_number: 1,
        status: 'scheduled',
      })
      .select('id')
      .single();

    testVisitId = v!.id;

    // 3. Look up Tech Ahmed's employee id and assign to visit
    const { data: empAhmed } = await admin
      .from('employees')
      .select('id')
      .eq('employee_code', 'EMP-004')
      .single();

    await admin.from('visit_technicians').insert({
      company_id: DEMO_COMPANY_A,
      visit_id: testVisitId,
      employee_id: empAhmed!.id,
      role_in_visit: 'lead',
      status: 'assigned',
    });
  });

  it('unassigned technician (Rajesh) cannot check into Ahmed visit', async () => {
    const { client } = await getAuthenticatedClient('tech.rajesh@apexfacilities.com');

    const { error } = await client.rpc('check_in_visit', {
      p_visit_id: testVisitId,
      p_latitude: 25.1972,
      p_longitude: 55.2797,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('Technician is not assigned to this visit');
  });

  it('assigned technician (Ahmed) can successfully check in with GPS', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { data, error } = await client.rpc('check_in_visit', {
      p_visit_id: testVisitId,
      p_latitude: 25.1972,
      p_longitude: 55.2797,
      p_idempotency_key: 'idem-checkin-001',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
    expect(data.already_checked_in).toBe(false);

    // Verify visit state in database
    const { data: v } = await admin
      .from('visits')
      .select('status, check_in_at, check_in_lat, check_in_lng')
      .eq('id', testVisitId)
      .single();

    expect(v!.status).toBe('in_progress');
    expect(v!.check_in_at).not.toBeNull();
    expect(Number(v!.check_in_lat)).toBeCloseTo(25.1972, 4);

    // Verify parent work order was updated to in_progress
    const { data: wo } = await admin
      .from('work_orders')
      .select('status')
      .eq('id', testWoId)
      .single();
    expect(wo!.status).toBe('in_progress');

    // Verify timesheet auto-started
    const { data: ts } = await admin
      .from('timesheets')
      .select('*')
      .eq('visit_id', testVisitId);
    expect(ts?.length).toBe(1);
    expect(ts![0].category).toBe('on_site');
  });

  it('repeated check-in call is idempotent (zero duplicate timesheets or error)', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    // Replay exact check-in
    const { data, error } = await client.rpc('check_in_visit', {
      p_visit_id: testVisitId,
      p_latitude: 25.1972,
      p_longitude: 55.2797,
      p_idempotency_key: 'idem-checkin-001',
    });

    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.already_checked_in).toBe(true);

    // Still exactly 1 timesheet
    const { data: ts } = await admin
      .from('timesheets')
      .select('*')
      .eq('visit_id', testVisitId);
    expect(ts?.length).toBe(1);
  });

  it('assigned technician can successfully check out with GPS', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { data, error } = await client.rpc('check_out_visit', {
      p_visit_id: testVisitId,
      p_latitude: 25.1973,
      p_longitude: 55.2798,
      p_idempotency_key: 'idem-checkout-001',
    });

    expect(error).toBeNull();
    expect(data.success).toBe(true);

    // Verify check_out_at recorded
    const { data: v } = await admin
      .from('visits')
      .select('check_out_at')
      .eq('id', testVisitId)
      .single();

    expect(v!.check_out_at).not.toBeNull();

    // Verify timesheet was closed
    const { data: ts } = await admin
      .from('timesheets')
      .select('end_time, duration_minutes')
      .eq('visit_id', testVisitId)
      .single();

    expect(ts!.end_time).not.toBeNull();
    expect(typeof ts!.duration_minutes).toBe('number');
  });
});

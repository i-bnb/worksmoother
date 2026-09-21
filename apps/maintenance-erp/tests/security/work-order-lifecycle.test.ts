/**
 * =============================================================================
 * Functional & Integrity Test: Work Order Status Machine
 * Maintenance Management ERP — Phase 1 Core Operations
 * =============================================================================
 * Verifies:
 *   - Valid lifecycle transitions succeed
 *   - Invalid transitions (e.g. new -> completed) are rejected by database triggers
 *   - Every status transition is automatically audited in work_order_status_history
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient, getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Integrity: Work Order Status Machine Lifecycle', () => {
  const admin = getAdminClient();
  let testWoId: string;

  it('creating a work order initializes it in status "new"', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    const { data, error } = await client
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: '33333333-3333-3333-3333-333333333331',
        site_id: '44444444-4444-4444-4444-444444444441',
        description: 'Test Status Machine Work Order',
        status: 'new',
      })
      .select('id, status, work_order_number')
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.status).toBe('new');
    expect(data!.work_order_number).toMatch(/^WO-\d{4}-\d{4}$/);
    testWoId = data!.id;
  });

  it('invalid transition directly from "new" to "completed" fails', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    // Attempt direct illegal jump
    const { error } = await client
      .from('work_orders')
      .update({ status: 'completed' })
      .eq('id', testWoId);

    // Database trigger trg_work_order_status_enforcer must raise exception
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Illegal work order status transition');
  });

  it('valid progression through state machine succeeds', async () => {
    const { client } = await getAuthenticatedClient('ops.manager@apexfacilities.com');

    // 1. new -> scheduled
    const { error: e1 } = await client
      .from('work_orders')
      .update({ status: 'scheduled' })
      .eq('id', testWoId);
    expect(e1).toBeNull();

    // 2. scheduled -> dispatched
    const { error: e2 } = await client
      .from('work_orders')
      .update({ status: 'dispatched' })
      .eq('id', testWoId);
    expect(e2).toBeNull();

    // 3. dispatched -> in_progress
    const { error: e3 } = await client
      .from('work_orders')
      .update({ status: 'in_progress' })
      .eq('id', testWoId);
    expect(e3).toBeNull();

    // 4. in_progress -> on_hold
    const { error: e4 } = await client
      .from('work_orders')
      .update({ status: 'on_hold' })
      .eq('id', testWoId);
    expect(e4).toBeNull();

    // 5. on_hold -> scheduled
    const { error: e5 } = await client
      .from('work_orders')
      .update({ status: 'scheduled' })
      .eq('id', testWoId);
    expect(e5).toBeNull();
  });

  it('state transitions automatically generate audit records in work_order_status_history', async () => {
    const { data: history } = await admin
      .from('work_order_status_history')
      .select('*')
      .eq('work_order_id', testWoId)
      .order('created_at', { ascending: true });

    expect(history).toBeDefined();
    expect(history!.length).toBeGreaterThanOrEqual(4);

    const states = history!.map((h) => `${h.from_status}->${h.to_status}`);
    expect(states).toContain('new->scheduled');
    expect(states).toContain('scheduled->dispatched');
    expect(states).toContain('dispatched->in_progress');
    expect(states).toContain('in_progress->on_hold');
  });
});

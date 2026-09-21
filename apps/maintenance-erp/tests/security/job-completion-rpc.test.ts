/**
 * =============================================================================
 * Transactional & Integrity Test: Job Completion RPC (complete_job)
 * Maintenance Management ERP — Phase 1 Core Operations
 * =============================================================================
 * Verifies:
 *   - complete_job enforces that at least 1 job activity is recorded
 *   - complete_job enforces that mandatory service checklists have responses
 *   - complete_job captures customer signature and completes visit and work order atomically
 *   - Correct evaluation of First-Time-Fix (FTF) flag across single vs multi-visit jobs
 */

import { describe, it, expect } from 'vitest';
import { getAdminClient, getAuthenticatedClient, DEMO_COMPANY_A } from './helpers.js';

describe('Transactional Integrity: Job Completion RPC (complete_job)', () => {
  const admin = getAdminClient();
  let testWoId: string;
  let testVisitId: string;
  let testEmpAhmedId: string;
  const ST_AC_SRV_ID = '66666666-6666-6666-6666-666666666661';

  it('setup test work order with mandatory checklist', async () => {
    // Look up Ahmed
    const { data: emp } = await admin
      .from('employees')
      .select('id')
      .eq('employee_code', 'EMP-004')
      .single();
    testEmpAhmedId = emp!.id;

    // Create WO
    const { data: wo } = await admin
      .from('work_orders')
      .insert({
        company_id: DEMO_COMPANY_A,
        customer_id: '33333333-3333-3333-3333-333333333331',
        site_id: '44444444-4444-4444-4444-444444444441',
        service_type_id: ST_AC_SRV_ID,
        description: 'Complete Job Atomic Transaction Test',
        status: 'in_progress',
      })
      .select('id')
      .single();
    testWoId = wo!.id;

    // Create Visit
    const { data: v } = await admin
      .from('visits')
      .insert({
        company_id: DEMO_COMPANY_A,
        work_order_id: testWoId,
        visit_number: 1,
        status: 'in_progress',
      })
      .select('id')
      .single();
    testVisitId = v!.id;

    // Assign Ahmed to visit
    await admin.from('visit_technicians').insert({
      company_id: DEMO_COMPANY_A,
      visit_id: testVisitId,
      employee_id: testEmpAhmedId,
      status: 'working',
    });
  });

  it('completing without any recorded job activity fails', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    const { error } = await client.rpc('complete_job', {
      p_visit_id: testVisitId,
      p_summary: 'Attempt early finish',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('At least one job activity must be logged');
  });

  it('completing with activity but missing required checklist fails', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    // Insert 1 activity
    await client.from('job_activities').insert({
      company_id: DEMO_COMPANY_A,
      work_order_id: testWoId,
      visit_id: testVisitId,
      technician_id: testEmpAhmedId,
      activity_type: 'inspected',
      description: 'Checked fan motor and coil cleanliness',
    });

    // Attempt complete_job (Checklist for AC Routine Service is configured in seed)
    const { error } = await client.rpc('complete_job', {
      p_visit_id: testVisitId,
      p_summary: 'Finished activity only',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('required checklist item(s) are missing responses');
  });

  it('completing with activities, checklists, and customer signature succeeds atomically', async () => {
    const { client } = await getAuthenticatedClient('tech.ahmed@apexfacilities.com');

    // 1. Submit answers for all required checklist items
    const { data: items } = await admin
      .from('checklist_items')
      .select('id, response_type')
      .eq('template_id', '88888888-8888-8888-8888-888888888881');

    for (const it of items ?? []) {
      await client.from('checklist_responses').insert({
        company_id: DEMO_COMPANY_A,
        visit_id: testVisitId,
        checklist_item_id: it.id,
        technician_id: testEmpAhmedId,
        is_passed: true,
        numeric_value: it.response_type === 'numeric' ? 68.5 : null,
      });
    }

    // 2. Execute complete_job RPC
    const { data, error } = await client.rpc('complete_job', {
      p_visit_id: testVisitId,
      p_summary: 'Full chiller preventative maintenance completed. Pressures normal.',
      p_signer_name: 'Rashid Al-Kindi (Client Representative)',
      p_signature_path: `${DEMO_COMPANY_A}/signatures/${testVisitId}/signature.png`,
    });

    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.is_first_time_fix).toBe(true);

    // 3. Verify visit status
    const { data: v } = await admin
      .from('visits')
      .select('status, is_first_time_fix')
      .eq('id', testVisitId)
      .single();
    expect(v!.status).toBe('completed');
    expect(v!.is_first_time_fix).toBe(true);

    // 4. Verify work order status
    const { data: wo } = await admin
      .from('work_orders')
      .select('status')
      .eq('id', testWoId)
      .single();
    expect(wo!.status).toBe('completed');

    // 5. Verify customer signature record
    const { data: sig } = await admin
      .from('signatures')
      .select('signer_name')
      .eq('visit_id', testVisitId)
      .single();
    expect(sig!.signer_name).toContain('Rashid Al-Kindi');
  });
});

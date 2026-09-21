/**
 * =============================================================================
 * Purchase Request & Multi-Level Approval Domain Service
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PurchaseRequestCreateDto,
  PurchaseRequestApprovalDto,
} from '../schemas/procurement-request.schema.js';

export class PurchaseRequestService {
  /**
   * Creates an internal purchase requisition linked to operational sources (WO, AMC, Rental).
   */
  static async createPurchaseRequest(
    client: SupabaseClient,
    dto: PurchaseRequestCreateDto,
    userId?: string
  ) {
    // 1. Calculate estimated total across lines
    const estimatedTotal = dto.items.reduce((sum, it) => {
      const lineTotal = it.quantity * (it.estimatedUnitPrice || 0);
      return sum + lineTotal;
    }, 0);

    // 2. Insert header
    const requestNumber = `PR-${Date.now().toString().slice(-6)}`;
    const { data: pr, error: prErr } = await client
      .from('purchase_requests')
      .insert({
        company_id: dto.companyId,
        request_number: requestNumber,
        requested_by: userId || null,
        work_order_id: dto.workOrderId || null,
        service_request_id: dto.serviceRequestId || null,
        amc_contract_id: dto.amcContractId || null,
        rental_contract_id: dto.rentalContractId || null,
        department_id: dto.departmentId || null,
        priority: dto.priority || 'medium',
        required_date: dto.requiredDate || null,
        notes: dto.notes || null,
        status: 'draft',
        estimated_total: Math.round(estimatedTotal * 1000) / 1000,
      })
      .select('*')
      .single();

    if (prErr) {
      throw new Error(`Failed to create purchase request: ${prErr.message}`);
    }

    // 3. Insert line items
    const linesPayload = dto.items.map((it) => ({
      request_id: pr.id,
      item_id: it.itemId || null,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit || 'pcs',
      estimated_unit_price: it.estimatedUnitPrice || 0,
      required_date: it.requiredDate || dto.requiredDate || null,
      notes: it.notes || null,
    }));

    const { error: lineErr } = await client
      .from('purchase_request_items')
      .insert(linesPayload);

    if (lineErr) {
      throw new Error(`Failed to create purchase request items: ${lineErr.message}`);
    }

    // 4. Publish domain event
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'PURCHASE_REQUEST_CREATED',
        entity_type: 'purchase_request',
        entity_id: pr.id,
        actor_id: userId || null,
        payload: {
          request_number: pr.request_number,
          priority: pr.priority,
          estimated_total: pr.estimated_total,
          work_order_id: pr.work_order_id,
        },
      });
    } catch {
      // ignore
    }

    return pr;
  }

  /**
   * Submits a draft purchase request for review and approval.
   */
  static async submitPurchaseRequest(
    client: SupabaseClient,
    companyId: string,
    requestId: string,
    userId?: string
  ) {
    const { data: pr, error: findErr } = await client
      .from('purchase_requests')
      .select('id, status')
      .eq('id', requestId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !pr) throw new Error('Purchase request not found');
    if (pr.status !== 'draft') {
      throw new Error(`Cannot submit purchase request in "${pr.status}" status (must be draft)`);
    }

    const { data: updated, error: updateErr } = await client
      .from('purchase_requests')
      .update({
        status: 'submitted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateErr) throw new Error(`Failed to submit purchase request: ${updateErr.message}`);
    return updated;
  }

  /**
   * Approves or rejects a purchase request.
   * Enforces organizational policy: Approver cannot approve their own requisition.
   */
  static async approvePurchaseRequest(
    client: SupabaseClient,
    companyId: string,
    requestId: string,
    dto: PurchaseRequestApprovalDto,
    approverId: string
  ) {
    const { data: pr, error: findErr } = await client
      .from('purchase_requests')
      .select('id, request_number, requested_by, status')
      .eq('id', requestId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !pr) throw new Error('Purchase request not found');

    if (pr.status !== 'submitted' && pr.status !== 'under_review') {
      throw new Error(`Cannot review purchase request in "${pr.status}" status`);
    }

    // Self-approval prevention
    if (pr.requested_by && pr.requested_by === approverId) {
      throw new Error('Policy violation: Users are not permitted to approve their own purchase requests');
    }

    const now = new Date().toISOString();
    const newStatus = dto.decision === 'approved' ? 'approved' : 'rejected';

    const { data: updated, error: updateErr } = await client
      .from('purchase_requests')
      .update({
        status: newStatus,
        approved_by: dto.decision === 'approved' ? approverId : null,
        approved_at: dto.decision === 'approved' ? now : null,
        rejection_reason: dto.decision === 'rejected' ? dto.comment || 'Rejected by management' : null,
        updated_at: now,
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateErr) throw new Error(`Failed to record approval decision: ${updateErr.message}`);

    // Record approval log
    await client.from('purchase_request_approvals').insert({
      request_id: requestId,
      approver_id: approverId,
      approval_level: dto.approvalLevel || 1,
      decision: dto.decision,
      comment: dto.comment || null,
      created_at: now,
    });

    // Publish domain event
    try {
      const eventType = dto.decision === 'approved' ? 'PURCHASE_REQUEST_APPROVED' : 'PURCHASE_REQUEST_REJECTED';
      await client.from('domain_events').insert({
        company_id: companyId,
        event_type: eventType,
        entity_type: 'purchase_request',
        entity_id: requestId,
        actor_id: approverId,
        payload: {
          request_number: pr.request_number,
          decision: dto.decision,
          comment: dto.comment,
        },
      });
    } catch {
      // ignore
    }

    return updated;
  }

  /**
   * Retrieves purchase request detail with item lines and approval history.
   */
  static async getPurchaseRequestDetail(
    client: SupabaseClient,
    companyId: string,
    requestId: string
  ) {
    const { data, error } = await client
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_items (*),
        purchase_request_approvals (*),
        work_orders (work_order_number)
      `)
      .eq('id', requestId)
      .eq('company_id', companyId)
      .single();

    if (error || !data) throw new Error('Purchase request not found');
    return data;
  }

  /**
   * Lists purchase requests.
   */
  static async listPurchaseRequests(
    client: SupabaseClient,
    companyId: string,
    filter?: { status?: string; workOrderId?: string }
  ) {
    let query = client
      .from('purchase_requests')
      .select('*, purchase_request_items (id, quantity, description)')
      .eq('company_id', companyId);

    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.workOrderId) query = query.eq('work_order_id', filter.workOrderId);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list purchase requests: ${error.message}`);
    return data || [];
  }
}

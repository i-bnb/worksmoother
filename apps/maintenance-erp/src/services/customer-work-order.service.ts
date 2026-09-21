/**
 * =============================================================================
 * Customer Work Orders & Service Reports Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  CustomerSafeWorkOrderDto,
  CustomerSafeServiceReportDto,
} from '../schemas/customer-feedback.schema.js';

export class CustomerWorkOrderService {
  /**
   * Lists work orders for the customer.
   * Strictly filters out internal cost estimations, labor calculations, and technician wages.
   */
  static async listWorkOrders(
    client: SupabaseClient,
    customerId: string,
    filter?: { status?: string; siteId?: string }
  ): Promise<CustomerSafeWorkOrderDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('work_orders')
      .select(`
        id,
        work_order_number,
        status,
        priority,
        description,
        scheduled_start,
        scheduled_end,
        created_at,
        updated_at,
        customer_sites (
          name,
          address
        ),
        customer_assets (
          name,
          asset_code
        ),
        service_appointments (
          assigned_technician_id,
          employees (
            first_name,
            last_name
          )
        ),
        service_feedback (
          id
        )
      `)
      .eq('customer_id', customerId);

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.siteId) {
      query = query.eq('site_id', filter.siteId);
    }

    const { data: workOrders, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list customer work orders: ${error.message}`);
    }

    return (workOrders || []).map((w: any) => {
      const site = w.customer_sites as any;
      const asset = w.customer_assets as any;
      const appts = (w.service_appointments as any[]) || [];
      const primaryAppt = appts[0];
      const tech = primaryAppt?.employees as any;
      const techName = tech ? `${tech.first_name} ${tech.last_name}`.trim() : null;
      const feedbacks = (w.service_feedback as any[]) || [];

      return {
        id: w.id,
        workOrderNumber: w.work_order_number,
        status: w.status,
        priority: w.priority,
        description: w.description,
        scheduledStart: w.scheduled_start,
        scheduledEnd: w.scheduled_end,
        siteName: site?.name,
        siteAddress: site?.address,
        assetName: asset?.name,
        assetCode: asset?.asset_code,
        assignedTechnicianName: techName,
        createdAt: w.created_at,
        completedAt: w.status === 'completed' || w.status === 'closed' ? w.updated_at : null,
        hasFeedbackSubmitted: feedbacks.length > 0,
      };
    });
  }

  /**
   * Retrieves single work order detail for the customer.
   */
  static async getWorkOrderDetail(
    client: SupabaseClient,
    customerId: string,
    workOrderId: string
  ): Promise<CustomerSafeWorkOrderDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!workOrderId) throw new Error('workOrderId is required');

    const { data: w, error } = await client
      .from('work_orders')
      .select(`
        id,
        work_order_number,
        status,
        priority,
        description,
        scheduled_start,
        scheduled_end,
        created_at,
        updated_at,
        customer_sites (
          name,
          address
        ),
        customer_assets (
          name,
          asset_code
        ),
        service_appointments (
          assigned_technician_id,
          employees (
            first_name,
            last_name
          )
        ),
        service_feedback (
          id
        )
      `)
      .eq('id', workOrderId)
      .eq('customer_id', customerId)
      .single();

    if (error || !w) {
      throw new Error('Work order not found or does not belong to your account');
    }

    const site = w.customer_sites as any;
    const asset = w.customer_assets as any;
    const appts = (w.service_appointments as any[]) || [];
    const primaryAppt = appts[0];
    const tech = primaryAppt?.employees as any;
    const techName = tech ? `${tech.first_name} ${tech.last_name}`.trim() : null;
    const feedbacks = (w.service_feedback as any[]) || [];

    return {
      id: w.id,
      workOrderNumber: w.work_order_number,
      status: w.status,
      priority: w.priority,
      description: w.description,
      scheduledStart: w.scheduled_start,
      scheduledEnd: w.scheduled_end,
      siteName: site?.name,
      siteAddress: site?.address,
      assetName: asset?.name,
      assetCode: asset?.asset_code,
      assignedTechnicianName: techName,
      createdAt: w.created_at,
      completedAt: w.status === 'completed' || w.status === 'closed' ? w.updated_at : null,
      hasFeedbackSubmitted: feedbacks.length > 0,
    };
  }

  /**
   * Retrieves the customer-safe completed service visit report for a work order.
   * Strips internal labor hours/rates, technician payroll, and parts purchase costs.
   */
  static async getServiceReport(
    client: SupabaseClient,
    customerId: string,
    workOrderId: string
  ): Promise<CustomerSafeServiceReportDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!workOrderId) throw new Error('workOrderId is required');

    // Verify work order belongs to customer
    const wo = await this.getWorkOrderDetail(client, customerId, workOrderId);

    const { data: report, error } = await client
      .from('service_visit_reports')
      .select(`
        id,
        report_number,
        problem_reported,
        diagnosis,
        work_performed,
        recommendations,
        completion_status,
        parts_used_summary,
        created_at,
        employees (
          first_name,
          last_name
        )
      `)
      .eq('work_order_id', workOrderId)
      .single();

    if (error || !report) {
      throw new Error('Service report is not yet available for this work order');
    }

    const tech = report.employees as any;
    const techName = tech ? `${tech.first_name} ${tech.last_name}`.trim() : null;

    // Parse parts safely — only return name and quantity
    let partsReplaced: Array<{ partName: string; quantity: number }> = [];
    if (report.parts_used_summary) {
      try {
        const rawParts = Array.isArray(report.parts_used_summary)
          ? report.parts_used_summary
          : JSON.parse(report.parts_used_summary);

        partsReplaced = rawParts.map((p: any) => ({
          partName: p.name || p.part_name || p.item_name || 'Component Part',
          quantity: Number(p.quantity || 1),
        }));
      } catch {
        partsReplaced = [];
      }
    }

    return {
      id: report.id,
      reportNumber: report.report_number,
      workOrderNumber: wo.workOrderNumber,
      assetName: wo.assetName,
      problemReported: report.problem_reported,
      diagnosis: report.diagnosis,
      workPerformed: report.work_performed,
      recommendations: report.recommendations,
      completionStatus: report.completion_status,
      technicianName: techName,
      partsReplaced,
      createdAt: report.created_at,
    };
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceVisitReportCreateDto } from '../schemas/service-visit.schema.js';
import { LaborCostService } from './labor-cost.service.js';

export class ServiceReportService {
  /**
   * Creates a structured service visit report.
   */
  static async createReport(client: SupabaseClient, dto: ServiceVisitReportCreateDto) {
    const { data, error } = await client
      .from('service_visit_reports')
      .insert({
        company_id: dto.companyId,
        visit_id: dto.visitId,
        work_order_id: dto.workOrderId,
        appointment_id: dto.appointmentId || null,
        technician_id: dto.technicianId,
        customer_id: dto.customerId,
        asset_id: dto.assetId || null,
        problem_reported: dto.problemReported,
        diagnosis: dto.diagnosis,
        work_performed: dto.workPerformed,
        parts_used_summary: dto.partsUsedSummary || [],
        labor_summary: dto.laborSummary || [],
        recommendations: dto.recommendations || null,
        follow_up_required: dto.followUpRequired || false,
        follow_up_notes: dto.followUpNotes || null,
        customer_remarks: dto.customerRemarks || null,
        technician_remarks: dto.technicianRemarks || null,
        completion_status: dto.completionStatus || 'resolved',
      })
      .select('*, customer:customers(id, name), asset:customer_assets(id, name), technician:employees(id, display_name)')
      .single();

    if (error) throw new Error(`Failed to create service report: ${error.message}`);

    // Synchronize work order completion status
    if (dto.completionStatus === 'resolved') {
      await client
        .from('work_orders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', dto.workOrderId);
    }

    return data;
  }

  /**
   * Retrieves report by visit ID.
   */
  static async getReportByVisit(client: SupabaseClient, visitId: string) {
    const { data, error } = await client
      .from('service_visit_reports')
      .select('*, customer:customers(id, name), asset:customer_assets(id, name), technician:employees(id, display_name)')
      .eq('visit_id', visitId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch service report: ${error.message}`);
    return data;
  }

  /**
   * Submits a checklist response for a visit item.
   */
  static async submitChecklistResponse(
    client: SupabaseClient,
    params: {
      companyId: string;
      visitId: string;
      checklistItemId: string;
      technicianId: string;
      responseValue?: string;
      isPassed?: boolean;
      numericValue?: number;
      notes?: string;
    }
  ) {
    const { data, error } = await client
      .from('checklist_responses')
      .upsert(
        {
          company_id: params.companyId,
          visit_id: params.visitId,
          checklist_item_id: params.checklistItemId,
          technician_id: params.technicianId,
          response_value: params.responseValue || null,
          is_passed: params.isPassed !== undefined ? params.isPassed : null,
          numeric_value: params.numericValue !== undefined ? params.numericValue : null,
          notes: params.notes || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'visit_id, checklist_item_id' }
      )
      .select('*, item:checklist_items(*)')
      .single();

    if (error) throw new Error(`Failed to record checklist response: ${error.message}`);
    return data;
  }

  /**
   * Pure checklist completion verification.
   */
  static verifyChecklistRequirements(
    requiredItemIds: string[],
    submittedItemIds: string[]
  ): { isComplete: boolean; missingItemIds: string[] } {
    const submittedSet = new Set(submittedItemIds);
    const missing = requiredItemIds.filter((id) => !submittedSet.has(id));
    return {
      isComplete: missing.length === 0,
      missingItemIds: missing,
    };
  }

  /**
   * Completes work order with labor costing calculation.
   */
  static async completeWorkOrderWithLaborCost(
    client: SupabaseClient,
    companyId: string,
    workOrderId: string
  ) {
    // 1. Calculate labor costing from timesheets
    const laborCost = await LaborCostService.computeWorkOrderLaborCost(client, companyId, workOrderId);

    // 2. Mark work order completed
    const { data: wo, error } = await client
      .from('work_orders')
      .update({
        status: 'completed',
        scheduling_status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', workOrderId)
      .select()
      .single();

    if (error) throw new Error(`Failed to complete work order: ${error.message}`);

    return {
      workOrder: wo,
      laborCost,
    };
  }
}

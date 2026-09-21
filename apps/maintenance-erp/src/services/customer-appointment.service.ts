/**
 * =============================================================================
 * Customer Appointments & Rescheduling Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AppointmentRescheduleRequestDto } from '../schemas/customer-feedback.schema.js';

export interface CustomerSafeAppointmentDto {
  id: string;
  appointmentNumber: string;
  workOrderId: string;
  workOrderNumber?: string;
  siteName?: string;
  siteAddress?: string;
  assetName?: string | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  priority: string;
  status: string;
  assignedTechnicianName?: string | null;
  hasPendingChangeRequest: boolean;
}

export class CustomerAppointmentService {
  /**
   * Lists scheduled service appointments for the customer.
   */
  static async listAppointments(
    client: SupabaseClient,
    customerId: string,
    filter?: { upcomingOnly?: boolean; status?: string }
  ): Promise<CustomerSafeAppointmentDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('service_appointments')
      .select(`
        id,
        appointment_number,
        work_order_id,
        appointment_date,
        start_time,
        end_time,
        priority,
        status,
        customer_sites (
          name,
          address
        ),
        customer_assets (
          name
        ),
        work_orders (
          work_order_number
        ),
        employees (
          first_name,
          last_name
        ),
        appointment_change_requests (
          id,
          status
        )
      `)
      .eq('customer_id', customerId);

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.upcomingOnly) {
      const today = new Date().toISOString().split('T')[0];
      query = query.gte('appointment_date', today);
    }

    const { data: appts, error } = await query.order('start_time', { ascending: true });

    if (error) {
      throw new Error(`Failed to list service appointments: ${error.message}`);
    }

    return (appts || []).map((a: any) => {
      const site = a.customer_sites as any;
      const asset = a.customer_assets as any;
      const wo = a.work_orders as any;
      const tech = a.employees as any;
      const techName = tech ? `${tech.first_name} ${tech.last_name}`.trim() : null;
      const changes = (a.appointment_change_requests as any[]) || [];
      const hasPendingChange = changes.some((c) => c.status === 'pending');

      return {
        id: a.id,
        appointmentNumber: a.appointment_number,
        workOrderId: a.work_order_id,
        workOrderNumber: wo?.work_order_number,
        siteName: site?.name,
        siteAddress: site?.address,
        assetName: asset?.name,
        appointmentDate: a.appointment_date,
        startTime: a.start_time,
        endTime: a.end_time,
        priority: a.priority,
        status: a.status,
        assignedTechnicianName: techName,
        hasPendingChangeRequest: hasPendingChange,
      };
    });
  }

  /**
   * Submits a customer request to reschedule an existing appointment.
   */
  static async requestReschedule(
    client: SupabaseClient,
    dto: AppointmentRescheduleRequestDto,
    userId?: string
  ): Promise<{ id: string; status: string }> {
    // 1. Verify appointment belongs to customer
    const { data: appt, error: apptErr } = await client
      .from('service_appointments')
      .select('id, company_id, customer_id, work_order_id, status, appointment_number')
      .eq('id', dto.appointmentId)
      .eq('customer_id', dto.customerId)
      .single();

    if (apptErr || !appt) {
      throw new Error('Service appointment not found or does not belong to your account');
    }

    if (appt.status === 'completed' || appt.status === 'cancelled') {
      throw new Error(
        `Cannot reschedule an appointment that is already ${appt.status}`
      );
    }

    // 2. Insert into appointment_change_requests
    const { data: changeReq, error: reqErr } = await client
      .from('appointment_change_requests')
      .insert({
        company_id: dto.companyId,
        customer_id: dto.customerId,
        appointment_id: dto.appointmentId,
        work_order_id: appt.work_order_id,
        requested_date: dto.requestedDate,
        preferred_time_slot: dto.preferredTimeSlot || 'anytime',
        reason: dto.reason,
        status: 'pending',
        requested_by: userId || null,
      })
      .select('id, status')
      .single();

    if (reqErr) {
      throw new Error(`Failed to submit reschedule request: ${reqErr.message}`);
    }

    // 3. Emit domain event
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'APPOINTMENT_CHANGE_REQUESTED',
        entity_type: 'appointment_change_request',
        entity_id: changeReq.id,
        actor_id: userId || null,
        payload: {
          appointment_id: dto.appointmentId,
          appointment_number: appt.appointment_number,
          customer_id: dto.customerId,
          requested_date: dto.requestedDate,
          preferred_time_slot: dto.preferredTimeSlot,
          reason: dto.reason,
        },
      });
    } catch {
      // ignore
    }

    return {
      id: changeReq.id,
      status: changeReq.status,
    };
  }

  /**
   * Lists appointment change requests for the customer.
   */
  static async listChangeRequests(
    client: SupabaseClient,
    customerId: string
  ): Promise<any[]> {
    if (!customerId) throw new Error('customerId is required');

    const { data: requests, error } = await client
      .from('appointment_change_requests')
      .select(`
        id,
        appointment_id,
        requested_date,
        preferred_time_slot,
        reason,
        status,
        resolution_notes,
        created_at,
        service_appointments (
          appointment_number,
          appointment_date,
          start_time
        )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list change requests: ${error.message}`);
    }

    return requests || [];
  }
}

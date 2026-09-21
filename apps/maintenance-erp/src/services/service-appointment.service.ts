import { SupabaseClient } from '@supabase/supabase-js';
import {
  AppointmentCreateDto,
  AppointmentUpdateDto,
  AppointmentAssignDto,
  AppointmentRescheduleDto,
  AppointmentStatus,
  AppointmentMultiAssignDto,
} from '../schemas/service-appointment.schema.js';

export class ServiceAppointmentService {
  /**
   * Permitted state machine transitions for service appointments.
   */
  static readonly VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
    unscheduled: ['scheduled', 'cancelled'],
    scheduled: ['confirmed', 'dispatched', 'rescheduled', 'cancelled', 'unscheduled'],
    confirmed: ['dispatched', 'rescheduled', 'cancelled', 'scheduled'],
    dispatched: ['en_route', 'arrived', 'rescheduled', 'cancelled', 'scheduled'],
    en_route: ['arrived', 'paused', 'rescheduled', 'cancelled'],
    arrived: ['in_progress', 'no_show', 'cancelled', 'paused'],
    in_progress: ['completed', 'paused', 'rescheduled'],
    paused: ['in_progress', 'rescheduled', 'cancelled'],
    completed: [], // Terminal
    cancelled: [], // Terminal
    rescheduled: ['scheduled', 'confirmed', 'dispatched', 'cancelled'],
    no_show: ['rescheduled', 'cancelled'],
  };

  /**
   * Validates whether a state transition is permitted.
   */
  static isValidTransition(current: AppointmentStatus, next: AppointmentStatus): boolean {
    if (current === next) return true;
    const allowed = this.VALID_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  /**
   * Creates a service appointment in unscheduled or scheduled status.
   */
  static async createAppointment(client: SupabaseClient, dto: AppointmentCreateDto) {
    const initialStatus: AppointmentStatus = dto.assignedTechnicianId ? 'scheduled' : 'unscheduled';

    const { data, error } = await client
      .from('service_appointments')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        work_order_id: dto.workOrderId,
        customer_id: dto.customerId,
        site_id: dto.siteId,
        asset_id: dto.assetId || null,
        assigned_technician_id: dto.assignedTechnicianId || null,
        team_id: dto.teamId || null,
        territory_id: dto.territoryId || null,
        appointment_date: dto.appointmentDate,
        start_time: dto.startTime,
        end_time: dto.endTime,
        estimated_duration_minutes: dto.estimatedDurationMinutes || 120,
        travel_buffer_minutes: dto.travelBufferMinutes || 30,
        priority: dto.priority || 'medium',
        sla_deadline: dto.slaDeadline || null,
        status: initialStatus,
        notes: dto.notes || null,
        metadata: dto.metadata || {},
        created_by: dto.userId || null,
      })
      .select('*, customer:customers(id, name), site:customer_sites(id, name, address), technician:employees(id, display_name)')
      .single();

    if (error) throw new Error(`Failed to create service appointment: ${error.message}`);

    // If technician assigned at creation, create assignment row & update work order
    if (dto.assignedTechnicianId) {
      await client.from('service_appointment_assignments').insert({
        company_id: dto.companyId,
        appointment_id: data.id,
        employee_id: dto.assignedTechnicianId,
        role: 'lead',
        is_primary: true,
      });

      await client
        .from('work_orders')
        .update({
          scheduling_status: 'scheduled',
          active_appointment_id: data.id,
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', dto.workOrderId);
    }

    return data;
  }

  /**
   * Retrieves single appointment details.
   */
  static async getAppointment(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('service_appointments')
      .select(`
        *,
        customer:customers(id, name),
        site:customer_sites(id, name, address),
        asset:customer_assets(id, name, asset_code),
        technician:employees(id, display_name, phone, work_email),
        team:service_teams(id, name, code),
        territory:service_territories(id, name, code),
        work_order:work_orders(id, work_order_number, description, status),
        assignments:service_appointment_assignments(*, employee:employees(id, display_name))
      `)
      .eq('id', id)
      .single();

    if (error) throw new Error(`Service appointment not found: ${error.message}`);
    return data;
  }

  /**
   * Assigns technician to appointment using transactional RPC.
   */
  static async assignTechnician(client: SupabaseClient, dto: AppointmentAssignDto) {
    const { data, error } = await client.rpc('assign_service_appointment', {
      p_company_id: dto.companyId,
      p_appointment_id: dto.appointmentId,
      p_technician_id: dto.technicianId,
      p_team_id: dto.teamId || null,
      p_user_id: dto.userId || null,
    });

    if (error) throw new Error(`Failed to assign technician: ${error.message}`);
    return data;
  }

  /**
   * Dispatches an appointment using transactional RPC.
   */
  static async dispatchAppointment(
    client: SupabaseClient,
    companyId: string,
    appointmentId: string,
    userId?: string
  ) {
    const { data, error } = await client.rpc('dispatch_service_appointment', {
      p_company_id: companyId,
      p_appointment_id: appointmentId,
      p_user_id: userId || null,
    });

    if (error) throw new Error(`Failed to dispatch appointment: ${error.message}`);
    return data;
  }

  /**
   * Reschedules an appointment with history tracking using transactional RPC.
   */
  static async rescheduleAppointment(client: SupabaseClient, dto: AppointmentRescheduleDto) {
    const { data, error } = await client.rpc('reschedule_service_appointment', {
      p_company_id: dto.companyId,
      p_appointment_id: dto.appointmentId,
      p_new_date: dto.newDate,
      p_new_start_time: dto.newStartTime,
      p_new_end_time: dto.newEndTime,
      p_reason: dto.reason,
      p_reason_details: dto.reasonDetails || null,
      p_user_id: dto.userId || null,
    });

    if (error) throw new Error(`Failed to reschedule appointment: ${error.message}`);
    return data;
  }

  /**
   * Transitions status with state machine enforcement.
   */
  static async transitionStatus(
    client: SupabaseClient,
    id: string,
    nextStatus: AppointmentStatus,
    userId?: string
  ) {
    const current = await this.getAppointment(client, id);
    if (!this.isValidTransition(current.status, nextStatus)) {
      throw new Error(`Invalid status transition from ${current.status} to ${nextStatus}`);
    }

    const { data, error } = await client
      .from('service_appointments')
      .update({
        status: nextStatus,
        updated_by: userId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update appointment status: ${error.message}`);
    return data;
  }

  /**
   * Cancels a service appointment.
   */
  static async cancelAppointment(
    client: SupabaseClient,
    companyId: string,
    appointmentId: string,
    reason?: string,
    userId?: string
  ) {
    return this.transitionStatus(client, appointmentId, 'cancelled', userId);
  }

  /**
   * Lists appointments with comprehensive filtering.
   */
  static async listAppointments(
    client: SupabaseClient,
    companyId: string,
    filters?: {
      technicianId?: string;
      territoryId?: string;
      status?: AppointmentStatus;
      startDate?: string;
      endDate?: string;
      workOrderId?: string;
    }
  ) {
    let query = client
      .from('service_appointments')
      .select(`
        *,
        customer:customers(id, name),
        site:customer_sites(id, name),
        technician:employees(id, display_name),
        work_order:work_orders(id, work_order_number)
      `)
      .eq('company_id', companyId);

    if (filters?.technicianId) query = query.eq('assigned_technician_id', filters.technicianId);
    if (filters?.territoryId) query = query.eq('territory_id', filters.territoryId);
    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.workOrderId) query = query.eq('work_order_id', filters.workOrderId);
    if (filters?.startDate) query = query.gte('appointment_date', filters.startDate);
    if (filters?.endDate) query = query.lte('appointment_date', filters.endDate);

    const { data, error } = await query.order('start_time', { ascending: true });
    if (error) throw new Error(`Failed to list service appointments: ${error.message}`);
    return data;
  }

  /**
   * Lists historical rescheduling events for an appointment.
   */
  static async listAppointmentHistory(client: SupabaseClient, appointmentId: string) {
    const { data, error } = await client
      .from('appointment_history')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list appointment history: ${error.message}`);
    return data;
  }
}

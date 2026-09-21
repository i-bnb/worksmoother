import { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingEngineService, TimeSlot } from './scheduling-engine.service.js';

export class DispatchBoardService {
  /**
   * Retrieves daily dispatch board matrix: technicians and their ordered scheduled jobs.
   */
  static async getDailySchedule(
    client: SupabaseClient,
    companyId: string,
    dateStr: string,
    territoryId?: string
  ) {
    let techQuery = client
      .from('employees')
      .select('id, display_name, phone, labor_rate, service_capacity')
      .eq('company_id', companyId)
      .eq('employment_status', 'ACTIVE')
      .eq('is_technician', true);

    const { data: technicians, error: techErr } = await techQuery;
    if (techErr) throw new Error(`Failed to fetch technicians: ${techErr.message}`);

    let apptQuery = client
      .from('service_appointments')
      .select(`
        *,
        customer:customers(id, name),
        site:customer_sites(id, name, address),
        work_order:work_orders(id, work_order_number, priority)
      `)
      .eq('company_id', companyId)
      .eq('appointment_date', dateStr)
      .not('status', 'in', '("cancelled","rescheduled")');

    if (territoryId) apptQuery = apptQuery.eq('territory_id', territoryId);

    const { data: appointments, error: apptErr } = await apptQuery.order('start_time', {
      ascending: true,
    });
    if (apptErr) throw new Error(`Failed to fetch appointments: ${apptErr.message}`);

    // Group by technician
    const scheduleByTech: Record<string, any> = {};
    for (const tech of technicians || []) {
      scheduleByTech[tech.id] = {
        technician: tech,
        appointments: [],
        totalScheduledMinutes: 0,
      };
    }

    const unassignedAppointments: any[] = [];

    for (const appt of appointments || []) {
      if (appt.assigned_technician_id && scheduleByTech[appt.assigned_technician_id]) {
        scheduleByTech[appt.assigned_technician_id].appointments.push(appt);
        scheduleByTech[appt.assigned_technician_id].totalScheduledMinutes +=
          appt.estimated_duration_minutes || 120;
      } else {
        unassignedAppointments.push(appt);
      }
    }

    return {
      date: dateStr,
      territoryId: territoryId || null,
      technicianCount: (technicians || []).length,
      technicians: Object.values(scheduleByTech),
      unassignedAppointments,
    };
  }

  /**
   * Retrieves all unassigned work orders needing scheduling.
   */
  static async getUnassignedWorkOrders(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('work_orders')
      .select(`
        id,
        work_order_number,
        description,
        priority,
        status,
        scheduling_status,
        due_at,
        created_at,
        customer:customers(id, name),
        site:customer_sites(id, name, address),
        asset:customer_assets(id, name, asset_code)
      `)
      .eq('company_id', companyId)
      .in('scheduling_status', ['unassigned', 'unscheduled'])
      .not('status', 'in', '("completed","closed","cancelled")')
      .order('priority', { ascending: false })
      .order('due_at', { ascending: true, nullsFirst: false });

    if (error) throw new Error(`Failed to list unassigned work orders: ${error.message}`);
    return data;
  }

  /**
   * Retrieves overdue work orders or appointments.
   */
  static async getOverdueWorkOrders(client: SupabaseClient, companyId: string) {
    const nowIso = new Date().toISOString();

    const { data, error } = await client
      .from('work_orders')
      .select(`
        id,
        work_order_number,
        description,
        priority,
        status,
        due_at,
        customer:customers(id, name)
      `)
      .eq('company_id', companyId)
      .lt('due_at', nowIso)
      .not('status', 'in', '("completed","closed","cancelled")')
      .order('due_at', { ascending: true });

    if (error) throw new Error(`Failed to list overdue work orders: ${error.message}`);
    return data;
  }

  /**
   * Diagnoses and reports any conflicting appointments across the fleet.
   */
  static async findConflictingAppointments(
    client: SupabaseClient,
    companyId: string,
    dateStr: string
  ) {
    const { data: appointments, error } = await client
      .from('service_appointments')
      .select('id, appointment_number, assigned_technician_id, start_time, end_time, travel_buffer_minutes, status')
      .eq('company_id', companyId)
      .eq('appointment_date', dateStr)
      .not('assigned_technician_id', 'is', null)
      .not('status', 'in', '("cancelled","completed","rescheduled")');

    if (error) throw new Error(`Failed to fetch appointments: ${error.message}`);

    // Group by technician
    const byTech = new Map<string, any[]>();
    for (const appt of appointments || []) {
      const list = byTech.get(appt.assigned_technician_id) || [];
      list.push(appt);
      byTech.set(appt.assigned_technician_id, list);
    }

    const conflicts: Array<{
      technicianId: string;
      appointmentA: string;
      appointmentB: string;
      type: string;
    }> = [];

    for (const [techId, appts] of byTech.entries()) {
      for (let i = 0; i < appts.length; i++) {
        for (let j = i + 1; j < appts.length; j++) {
          const a = appts[i];
          const b = appts[j];

          const slotA: TimeSlot = {
            id: a.id,
            startTime: a.start_time,
            endTime: a.end_time,
            travelBufferMinutes: a.travel_buffer_minutes,
          };
          const slotB: TimeSlot = {
            id: b.id,
            startTime: b.start_time,
            endTime: b.end_time,
            travelBufferMinutes: b.travel_buffer_minutes,
          };

          const check = SchedulingEngineService.checkAppointmentConflicts([slotA], slotB);
          if (check.hasConflict) {
            conflicts.push({
              technicianId: techId,
              appointmentA: a.appointment_number || a.id,
              appointmentB: b.appointment_number || b.id,
              type: check.conflictType || 'overlap',
            });
          }
        }
      }
    }

    return conflicts;
  }
}

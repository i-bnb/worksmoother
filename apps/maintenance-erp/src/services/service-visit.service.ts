import { SupabaseClient } from '@supabase/supabase-js';
import {
  VisitCheckInDto,
  VisitCheckOutDto,
  TravelRecordCreateDto,
} from '../schemas/service-visit.schema.js';

export class ServiceVisitService {
  /**
   * Pure duration calculator in minutes.
   */
  static calculateDurationMinutes(startIso: string, endIso: string): number {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return 0;
    return Math.round((e - s) / (60 * 1000));
  }

  /**
   * Records technician check-in at customer site.
   */
  static async checkIn(client: SupabaseClient, dto: VisitCheckInDto) {
    const { data, error } = await client.rpc('check_in_service_appointment', {
      p_company_id: dto.companyId,
      p_appointment_id: dto.appointmentId,
      p_technician_id: dto.technicianId,
      p_latitude: dto.latitude || null,
      p_longitude: dto.longitude || null,
    });

    if (error) throw new Error(`Check-in failed: ${error.message}`);
    return data;
  }

  /**
   * Records technician check-out from site and calculates duration.
   */
  static async checkOut(client: SupabaseClient, dto: VisitCheckOutDto) {
    const { data, error } = await client.rpc('check_out_service_appointment', {
      p_company_id: dto.companyId,
      p_appointment_id: dto.appointmentId,
      p_technician_id: dto.technicianId,
      p_latitude: dto.latitude || null,
      p_longitude: dto.longitude || null,
      p_work_performed: dto.workPerformed || null,
      p_completion_remarks: dto.completionRemarks || null,
    });

    if (error) throw new Error(`Check-out failed: ${error.message}`);
    return data;
  }

  /**
   * Records technician travel start.
   */
  static async startTravel(client: SupabaseClient, dto: TravelRecordCreateDto) {
    const { data, error } = await client
      .from('travel_records')
      .insert({
        company_id: dto.companyId,
        appointment_id: dto.appointmentId,
        visit_id: dto.visitId || null,
        technician_id: dto.technicianId,
        travel_start: dto.travelStart,
        origin_reference: dto.originReference || null,
        destination_reference: dto.destinationReference || null,
        travel_status: 'in_transit',
        travel_notes: dto.travelNotes || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to start travel record: ${error.message}`);

    // Update appointment status to en_route
    await client
      .from('service_appointments')
      .update({ status: 'en_route', updated_at: new Date().toISOString() })
      .eq('id', dto.appointmentId);

    return data;
  }

  /**
   * Records technician travel end (arrival).
   */
  static async endTravel(
    client: SupabaseClient,
    travelRecordId: string,
    travelEndIso?: string
  ) {
    const end = travelEndIso || new Date().toISOString();

    const { data: record, error: fetchErr } = await client
      .from('travel_records')
      .select('*')
      .eq('id', travelRecordId)
      .single();

    if (fetchErr || !record) throw new Error('Travel record not found');

    const duration = this.calculateDurationMinutes(record.travel_start, end);

    const { data, error } = await client
      .from('travel_records')
      .update({
        travel_end: end,
        travel_duration_minutes: duration,
        travel_status: 'arrived',
        updated_at: new Date().toISOString(),
      })
      .eq('id', travelRecordId)
      .select()
      .single();

    if (error) throw new Error(`Failed to end travel record: ${error.message}`);

    // Update appointment status to arrived
    await client
      .from('service_appointments')
      .update({ status: 'arrived', updated_at: new Date().toISOString() })
      .eq('id', record.appointment_id);

    return data;
  }

  /**
   * Lists visits for a work order.
   */
  static async listVisits(client: SupabaseClient, workOrderId: string) {
    const { data, error } = await client
      .from('visits')
      .select('*, technicians:visit_technicians(*, employee:employees(id, display_name))')
      .eq('work_order_id', workOrderId)
      .order('visit_number', { ascending: true });

    if (error) throw new Error(`Failed to list visits: ${error.message}`);
    return data;
  }
}

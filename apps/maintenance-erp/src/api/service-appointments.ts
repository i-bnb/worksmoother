import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceAppointmentService } from '../services/service-appointment.service.js';
import { SkillMatchingService } from '../services/skill-matching.service.js';
import {
  validateAppointmentCreate,
  validateAppointmentAssign,
  validateAppointmentReschedule,
  validateRequiredSkillCreate,
} from '../schemas/service-appointment.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ServiceAppointmentsApiController {
  static async createAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateAppointmentCreate(req.body);
      const data = await ServiceAppointmentService.createAppointment(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Appointment ID is required' };
      const data = await ServiceAppointmentService.getAppointment(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async assignTechnician(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateAppointmentAssign(req.body);
      const data = await ServiceAppointmentService.assignTechnician(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async dispatchAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { companyId, userId } = req.body || {};
      if (!id || !companyId) return { status: 400, error: 'Appointment ID and companyId are required' };
      const data = await ServiceAppointmentService.dispatchAppointment(client, companyId, id, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async rescheduleAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateAppointmentReschedule(req.body);
      const data = await ServiceAppointmentService.rescheduleAppointment(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async cancelAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { companyId, reason, userId } = req.body || {};
      if (!id || !companyId) return { status: 400, error: 'Appointment ID and companyId are required' };
      const data = await ServiceAppointmentService.cancelAppointment(client, companyId, id, reason, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listAppointments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await ServiceAppointmentService.listAppointments(client, companyId, {
        technicianId: req.query?.technicianId || req.query?.technician_id,
        territoryId: req.query?.territoryId || req.query?.territory_id,
        status: req.query?.status as any,
        startDate: req.query?.startDate || req.query?.start_date,
        endDate: req.query?.endDate || req.query?.end_date,
        workOrderId: req.query?.workOrderId || req.query?.work_order_id,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async listAppointmentHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Appointment ID is required' };
      const data = await ServiceAppointmentService.listAppointmentHistory(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async addRequiredSkill(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRequiredSkillCreate(req.body);
      const data = await SkillMatchingService.addRequiredSkill(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async findQualifiedTechnicians(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const workOrderId = req.params?.workOrderId || req.query?.workOrderId;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!workOrderId || !companyId) {
        return { status: 400, error: 'workOrderId and companyId are required' };
      }
      const data = await SkillMatchingService.findQualifiedTechnicians(
        client,
        companyId,
        workOrderId,
        req.query?.targetDate
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

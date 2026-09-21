import { SupabaseClient } from '@supabase/supabase-js';
import { DispatchBoardService } from '../services/dispatch-board.service.js';
import { TechnicianCapacityService } from '../services/technician-capacity.service.js';
import { PartsReadinessService } from '../services/parts-readiness.service.js';
import { SlaMonitoringService } from '../services/sla-monitoring.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class DispatchBoardApiController {
  static async getDailySchedule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const date = req.query?.date || new Date().toISOString().split('T')[0];
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await DispatchBoardService.getDailySchedule(
        client,
        companyId,
        date,
        req.query?.territoryId || req.query?.territory_id
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getUnassignedWorkOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DispatchBoardService.getUnassignedWorkOrders(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getOverdueWorkOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DispatchBoardService.getOverdueWorkOrders(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async findConflictingAppointments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const date = req.query?.date || new Date().toISOString().split('T')[0];
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DispatchBoardService.findConflictingAppointments(client, companyId, date);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getDailyCapacity(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const technicianId = req.params?.technicianId || req.query?.technicianId;
      const date = req.query?.date || new Date().toISOString().split('T')[0];
      if (!companyId || !technicianId) {
        return { status: 400, error: 'companyId and technicianId are required' };
      }
      const data = await TechnicianCapacityService.getDailyCapacity(client, companyId, technicianId, date);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getWeeklyCapacity(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const technicianId = req.params?.technicianId || req.query?.technicianId;
      const weekStart = req.query?.weekStart || req.query?.week_start || new Date().toISOString().split('T')[0];
      if (!companyId || !technicianId) {
        return { status: 400, error: 'companyId and technicianId are required' };
      }
      const data = await TechnicianCapacityService.getWeeklyCapacity(client, companyId, technicianId, weekStart);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async checkPartsReadiness(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const workOrderId = req.params?.workOrderId || req.query?.workOrderId;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!workOrderId || !companyId) {
        return { status: 400, error: 'workOrderId and companyId are required' };
      }
      const data = await PartsReadinessService.checkPartsReadiness(client, companyId, workOrderId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getSlaAtRiskWorkOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await SlaMonitoringService.getSlaAtRiskWorkOrders(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getSlaBreachedWorkOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await SlaMonitoringService.getSlaBreachedWorkOrders(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

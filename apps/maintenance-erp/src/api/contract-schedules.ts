import { SupabaseClient } from '@supabase/supabase-js';
import { MaintenanceScheduleService } from '../services/maintenance-schedule.service.js';
import { validateMaintenanceScheduleCreate } from '../schemas/maintenance-schedule.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ContractSchedulesApiController {
  static async createSchedule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateMaintenanceScheduleCreate(req.body);
      const data = await MaintenanceScheduleService.createSchedule(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listSchedules(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await MaintenanceScheduleService.listSchedules(client, companyId, {
        contractId: req.query?.contractId || req.query?.contract_id,
        assetId: req.query?.assetId || req.query?.asset_id,
        status: req.query?.status,
        fromDate: req.query?.fromDate || req.query?.from_date,
        toDate: req.query?.toDate || req.query?.to_date,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async generateContractSchedules(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await MaintenanceScheduleService.generateContractSchedules(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async dispatchWorkOrder(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const scheduleId = req.params?.id;
      if (!scheduleId) return { status: 400, error: 'Schedule ID is required' };

      const data = await MaintenanceScheduleService.generateWorkOrder(client, scheduleId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceVisitService } from '../services/service-visit.service.js';
import { ServiceReportService } from '../services/service-report.service.js';
import {
  validateVisitCheckIn,
  validateVisitCheckOut,
  validateTravelRecordCreate,
  validateServiceVisitReportCreate,
} from '../schemas/service-visit.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ServiceVisitsApiController {
  static async checkIn(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateVisitCheckIn(req.body);
      const data = await ServiceVisitService.checkIn(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async checkOut(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateVisitCheckOut(req.body);
      const data = await ServiceVisitService.checkOut(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async startTravel(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateTravelRecordCreate(req.body);
      const data = await ServiceVisitService.startTravel(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async endTravel(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Travel record ID is required' };
      const data = await ServiceVisitService.endTravel(client, id, req.body?.travelEnd);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createReport(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateServiceVisitReportCreate(req.body);
      const data = await ServiceReportService.createReport(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getReport(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const visitId = req.params?.visitId || req.query?.visitId;
      if (!visitId) return { status: 400, error: 'visitId is required' };
      const data = await ServiceReportService.getReportByVisit(client, visitId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async submitChecklistResponse(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, visitId, checklistItemId, technicianId, responseValue, isPassed, numericValue, notes } = req.body || {};
      if (!companyId || !visitId || !checklistItemId || !technicianId) {
        return { status: 400, error: 'companyId, visitId, checklistItemId, and technicianId are required' };
      }
      const data = await ServiceReportService.submitChecklistResponse(client, {
        companyId,
        visitId,
        checklistItemId,
        technicianId,
        responseValue,
        isPassed,
        numericValue,
        notes,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async completeWorkOrder(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const workOrderId = req.params?.workOrderId || req.body?.workOrderId;
      const companyId = req.body?.companyId || req.query?.companyId;
      if (!workOrderId || !companyId) {
        return { status: 400, error: 'workOrderId and companyId are required' };
      }
      const data = await ServiceReportService.completeWorkOrderWithLaborCost(client, companyId, workOrderId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

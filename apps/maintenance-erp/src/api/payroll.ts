import { SupabaseClient } from '@supabase/supabase-js';
import { SalaryStructureService } from '../services/salary-structure.service.js';
import { PayrollCalculationService } from '../services/payroll-calculation.service.js';
import { PayrollAccountingService } from '../services/payroll-accounting.service.js';
import { LaborCostService } from '../services/labor-cost.service.js';
import { HrReportingService } from '../services/hr-reporting.service.js';
import {
  validateSalaryComponentCreate,
  validateSalaryStructureCreate,
  validatePayrollPeriodCreate,
  validatePayrollCalculate,
  validatePostPayrollGl,
} from '../schemas/payroll.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class PayrollApiController {
  static async createSalaryComponent(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateSalaryComponentCreate(req.body);
      const data = await SalaryStructureService.createSalaryComponent(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listSalaryComponents(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await SalaryStructureService.listSalaryComponents(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async createSalaryStructure(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateSalaryStructureCreate(req.body);
      const data = await SalaryStructureService.createSalaryStructure(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getSalaryStructure(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Structure ID is required' };
      const data = await SalaryStructureService.getSalaryStructure(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async createPayrollPeriod(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePayrollPeriodCreate(req.body);
      const data = await PayrollCalculationService.createPayrollPeriod(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getPayrollPeriod(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Period ID is required' };
      const data = await PayrollCalculationService.getPayrollPeriod(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async calculatePayroll(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePayrollCalculate(req.body);
      const data = await PayrollCalculationService.processPayrollPeriod(
        client,
        validated.companyId,
        validated.periodId,
        validated.employeeIds
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async lockPayrollPeriod(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { companyId, userId } = req.body || {};
      if (!id || !companyId || !userId) {
        return { status: 400, error: 'Period ID, companyId, and userId are required' };
      }
      const data = await PayrollCalculationService.lockPayrollPeriod(client, companyId, id, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async postPayrollToGl(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePostPayrollGl(req.body);
      const data = await PayrollAccountingService.postPayrollToGl(
        client,
        validated.companyId,
        validated.periodId,
        validated.userId
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async disbursePayroll(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, periodId, userId, bankAccountId } = req.body || {};
      if (!companyId || !periodId || !userId) {
        return { status: 400, error: 'companyId, periodId, and userId are required' };
      }
      const data = await PayrollAccountingService.disbursePayroll(
        client,
        companyId,
        periodId,
        userId,
        bankAccountId
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getHeadcountSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await HrReportingService.getHeadcountSummary(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getAttendanceSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const startDate = req.query?.startDate || req.query?.start_date;
      const endDate = req.query?.endDate || req.query?.end_date;
      if (!companyId || !startDate || !endDate) {
        return { status: 400, error: 'companyId, startDate, and endDate are required' };
      }
      const data = await HrReportingService.getAttendanceSummary(client, companyId, startDate, endDate);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getPayrollSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const year = req.query?.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await HrReportingService.getPayrollSummary(client, companyId, year);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async calculateLaborCost(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const workOrderId = req.params?.workOrderId || req.body?.workOrderId;
      const companyId = req.body?.companyId || req.query?.companyId;
      if (!workOrderId || !companyId) {
        return { status: 400, error: 'workOrderId and companyId are required' };
      }
      const data = await LaborCostService.computeWorkOrderLaborCost(client, companyId, workOrderId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

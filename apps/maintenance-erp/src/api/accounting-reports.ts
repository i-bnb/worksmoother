import { SupabaseClient } from '@supabase/supabase-js';
import { FinancialReportingService } from '../services/financial-reporting.service.js';
import { ReceivableService } from '../services/receivable.service.js';
import { PayableService } from '../services/payable.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AccountingReportsApiController {
  static async getTrialBalance(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await FinancialReportingService.getTrialBalance(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getGeneralLedger(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const filters = {
        accountId: req.query?.account_id,
        fromDate: req.query?.from_date,
        toDate: req.query?.to_date,
      };

      const data = await FinancialReportingService.getGeneralLedger(client, companyId, filters);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getProfitAndLoss(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await FinancialReportingService.getProfitAndLoss(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getBalanceSheet(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await FinancialReportingService.getBalanceSheet(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getCashSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await FinancialReportingService.getCashSummary(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getOverdueReceivables(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await ReceivableService.getOverdueInvoices(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getOverduePayables(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.company_id || req.body?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await PayableService.getOverdueBills(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

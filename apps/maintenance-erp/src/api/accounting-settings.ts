import { SupabaseClient } from '@supabase/supabase-js';
import { AccountingSettingsService } from '../services/accounting-settings.service.js';
import { FinancialPeriodService } from '../services/financial-period.service.js';
import { validateAccountingSettingsUpdate } from '../schemas/accounting-settings.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AccountingSettingsApiController {
  static async getSettings(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await AccountingSettingsService.getSettings(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async updateSettings(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId =
        req.params?.companyId ||
        req.params?.company_id ||
        req.query?.companyId ||
        req.query?.company_id ||
        req.body?.companyId ||
        req.body?.company_id;

      if (!companyId) return { status: 400, error: 'company_id is required' };

      const validated = validateAccountingSettingsUpdate(req.body);
      const data = await AccountingSettingsService.updateSettings(client, companyId, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listPeriods(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const fiscalYear = req.query?.fiscalYear
        ? parseInt(req.query.fiscalYear, 10)
        : req.query?.fiscal_year
        ? parseInt(req.query.fiscal_year, 10)
        : undefined;

      const data = await FinancialPeriodService.listPeriods(client, companyId, fiscalYear);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async closePeriod(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Period ID is required' };

      const data = await FinancialPeriodService.closePeriod(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async lockPeriod(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Period ID is required' };

      const data = await FinancialPeriodService.lockPeriod(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

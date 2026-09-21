import { SupabaseClient } from '@supabase/supabase-js';
import { ArApReconciliationService } from '../services/ar-ap-reconciliation.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class FinanceReportsApiController {
  /**
   * GET /api/finance/cash-position
   */
  static async getCashPosition(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const result = await ArApReconciliationService.getCashPosition(client, companyId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/finance/reconcile-ar
   */
  static async reconcileAr(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const arControlAccountId = req.query?.arControlAccountId || req.query?.ar_control_account_id;
      const asOfDate = req.query?.asOfDate || req.query?.as_of_date;
      const result = await ArApReconciliationService.reconcileArSubledger(client, companyId, arControlAccountId, asOfDate);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/finance/reconcile-ap
   */
  static async reconcileAp(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const apControlAccountId = req.query?.apControlAccountId || req.query?.ap_control_account_id;
      const asOfDate = req.query?.asOfDate || req.query?.as_of_date;
      const result = await ArApReconciliationService.reconcileApSubledger(client, companyId, apControlAccountId, asOfDate);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

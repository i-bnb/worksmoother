import { SupabaseClient } from '@supabase/supabase-js';
import { FinancialRefundService } from '../services/financial-refund.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class RefundsApiController {
  /**
   * POST /api/refunds/customer
   */
  static async processCustomerRefund(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const payload = {
        ...req.body,
        refundType: 'customer_refund',
      };
      const glAccounts = req.body?.glAccounts || req.body?.gl_accounts;
      const result = await FinancialRefundService.processRefund(client, payload, userId, glAccounts);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/refunds/supplier
   */
  static async processSupplierRefund(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const payload = {
        ...req.body,
        refundType: 'supplier_refund',
      };
      const glAccounts = req.body?.glAccounts || req.body?.gl_accounts;
      const result = await FinancialRefundService.processRefund(client, payload, userId, glAccounts);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/refunds/:id
   */
  static async getRefund(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { data, error } = await client
        .from('financial_refunds')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) return { status: 404, error: 'Refund record not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/refunds
   */
  static async listRefunds(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const refundType = req.query?.refundType || req.query?.refund_type;

      let query = client
        .from('financial_refunds')
        .select('*')
        .eq('company_id', companyId)
        .order('refund_date', { ascending: false });

      if (refundType) query = query.eq('refund_type', refundType);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

/**
 * =============================================================================
 * Goods Receipts (GRN) REST API Controller
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { GoodsReceiptService } from '../services/goods-receipt.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class GoodsReceiptsApiController {
  /**
   * POST /api/goods-receipts
   */
  static async createGoodsReceipt(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await GoodsReceiptService.processGoodsReceipt(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/goods-receipts
   */
  static async listGoodsReceipts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const filters = {
        poId: req.query?.poId || req.query?.po_id,
      };

      const result = await GoodsReceiptService.listGoodsReceipts(client, companyId, filters);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/goods-receipts/:id
   */
  static async getGoodsReceiptById(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const receiptId = req.params?.id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!receiptId) return { status: 400, error: 'receiptId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await GoodsReceiptService.getGoodsReceiptDetail(client, companyId, receiptId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

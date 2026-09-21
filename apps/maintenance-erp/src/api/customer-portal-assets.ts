/**
 * =============================================================================
 * Customer Portal Dashboard & Asset Management REST API Controller
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CustomerDashboardService } from '../services/customer-dashboard.service.js';
import { CustomerAssetPortalService } from '../services/customer-asset-portal.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CustomerPortalAssetsApiController {
  /**
   * GET /api/portal/dashboard
   */
  static async getDashboard(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) {
        return { status: 400, error: 'customerId is required' };
      }

      const summary = await CustomerDashboardService.getDashboardSummary(client, customerId);
      return { status: 200, data: summary };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/assets
   */
  static async listAssets(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) {
        return { status: 400, error: 'customerId is required' };
      }

      const filter = {
        siteId: req.query?.siteId || req.query?.site_id,
        status: req.query?.status,
        search: req.query?.search,
      };

      const assets = await CustomerAssetPortalService.listAssets(client, customerId, filter);
      return { status: 200, data: assets };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/assets/:id
   */
  static async getAssetDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const assetId = req.params?.id;

      if (!customerId || !assetId) {
        return { status: 400, error: 'customerId and assetId are required' };
      }

      const detail = await CustomerAssetPortalService.getAssetDetail(client, customerId, assetId);
      return { status: 200, data: detail };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/assets/:id/history
   */
  static async getAssetServiceHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const assetId = req.params?.id;

      if (!customerId || !assetId) {
        return { status: 400, error: 'customerId and assetId are required' };
      }

      const history = await CustomerAssetPortalService.getAssetServiceHistory(client, customerId, assetId);
      return { status: 200, data: history };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

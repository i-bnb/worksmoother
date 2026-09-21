/**
 * =============================================================================
 * Purchase Orders & Revisions REST API Controller
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ProcurementOrderService } from '../services/procurement-order.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class PurchaseOrdersApiController {
  /**
   * POST /api/purchase-orders
   */
  static async createPurchaseOrder(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await ProcurementOrderService.createPurchaseOrder(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/purchase-orders
   */
  static async listPurchaseOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const filters = {
        supplierId: req.query?.supplierId || req.query?.supplier_id,
        status: req.query?.status,
        acknowledgementStatus: req.query?.acknowledgementStatus || req.query?.acknowledgement_status,
        limit: req.query?.limit ? Number(req.query.limit) : undefined,
      };

      const result = await ProcurementOrderService.listPurchaseOrders(client, companyId, filters);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/purchase-orders/:id
   */
  static async getPurchaseOrderById(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!poId) return { status: 400, error: 'poId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await ProcurementOrderService.getPurchaseOrderDetail(client, companyId, poId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-orders/:id/approve
   */
  static async approvePurchaseOrder(client: SupabaseClient, req: ApiRequest, userId: string): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id || req.query?.companyId;
      if (!poId) return { status: 400, error: 'poId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };
      if (!userId) return { status: 401, error: 'Approver user ID is required' };

      const result = await ProcurementOrderService.approvePurchaseOrder(client, companyId, poId, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-orders/:id/send
   */
  static async sendToSupplier(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      if (!poId) return { status: 400, error: 'poId is required' };

      const { data: updated, error } = await client
        .from('purchase_orders')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', poId)
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      return { status: 200, data: updated };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-orders/:id/acknowledge
   */
  static async acknowledgePurchaseOrder(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!poId) return { status: 400, error: 'poId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await ProcurementOrderService.acknowledgePurchaseOrder(client, companyId, poId, req.body);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-orders/:id/revisions
   */
  static async createRevision(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!poId) return { status: 400, error: 'poId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await ProcurementOrderService.updatePurchaseOrderWithRevision(client, companyId, poId, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/purchase-orders/:id/revisions
   */
  static async listRevisions(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const poId = req.params?.id;
      if (!poId) return { status: 400, error: 'poId is required' };

      const { data, error } = await client
        .from('purchase_order_revisions')
        .select('*')
        .eq('po_id', poId)
        .order('revision_number', { ascending: false });

      if (error) throw new Error(error.message);
      return { status: 200, data: data || [] };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

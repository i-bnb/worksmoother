/**
 * =============================================================================
 * Purchase Requests & Supplier Quotations REST API Controller
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { PurchaseRequestService } from '../services/purchase-request.service.js';
import { SupplierQuotationService } from '../services/supplier-quotation.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class PurchaseRequestsApiController {
  /**
   * POST /api/purchase-requests
   */
  static async createPurchaseRequest(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await PurchaseRequestService.createPurchaseRequest(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/purchase-requests
   */
  static async listPurchaseRequests(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const filters = {
        status: req.query?.status,
        departmentId: req.query?.departmentId || req.query?.department_id,
        workOrderId: req.query?.workOrderId || req.query?.work_order_id,
        requestedBy: req.query?.requestedBy || req.query?.requested_by,
        limit: req.query?.limit ? Number(req.query.limit) : undefined,
      };

      const result = await PurchaseRequestService.listPurchaseRequests(client, companyId, filters);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/purchase-requests/:id
   */
  static async getPurchaseRequestById(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const requestId = req.params?.id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!requestId) return { status: 400, error: 'requestId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await PurchaseRequestService.getPurchaseRequestDetail(client, companyId, requestId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-requests/:id/submit
   */
  static async submitForApproval(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const requestId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!requestId) return { status: 400, error: 'requestId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await PurchaseRequestService.submitPurchaseRequest(client, companyId, requestId, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-requests/:id/approve
   */
  static async approvePurchaseRequest(client: SupabaseClient, req: ApiRequest, userId: string): Promise<ApiResponse> {
    try {
      const requestId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      const { approvalLevel, comment } = req.body || {};
      if (!requestId) return { status: 400, error: 'requestId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };
      if (!userId) return { status: 401, error: 'Approver user ID is required' };

      const result = await PurchaseRequestService.approvePurchaseRequest(
        client,
        companyId,
        requestId,
        { decision: 'approved', approvalLevel, comment },
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/purchase-requests/:id/reject
   */
  static async rejectPurchaseRequest(client: SupabaseClient, req: ApiRequest, userId: string): Promise<ApiResponse> {
    try {
      const requestId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      const { reason } = req.body || {};
      if (!requestId) return { status: 400, error: 'requestId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };
      if (!reason) return { status: 400, error: 'Rejection reason is required' };

      const result = await PurchaseRequestService.approvePurchaseRequest(
        client,
        companyId,
        requestId,
        { decision: 'rejected', comment: reason },
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-quotations
   */
  static async recordSupplierQuotation(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await SupplierQuotationService.createSupplierQuotation(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/supplier-quotations
   */
  static async listSupplierQuotations(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      let query = client
        .from('supplier_quotations')
        .select('*, suppliers(name, code)')
        .eq('company_id', companyId);

      if (req.query?.supplierId) query = query.eq('supplier_id', req.query.supplierId);
      if (req.query?.purchaseRequestId) query = query.eq('purchase_request_id', req.query.purchaseRequestId);
      if (req.query?.status) query = query.eq('status', req.query.status);

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { status: 200, data: data || [] };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/supplier-quotations/compare
   */
  static async compareQuotations(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const prId = req.query?.purchaseRequestId || req.query?.purchase_request_id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!prId) return { status: 400, error: 'purchaseRequestId is required for quotation comparison' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await SupplierQuotationService.compareSupplierQuotations(client, companyId, prId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

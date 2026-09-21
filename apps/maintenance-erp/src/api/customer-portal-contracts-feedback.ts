/**
 * =============================================================================
 * Customer Portal Contracts, Rentals & Feedback REST API Controller
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CustomerContractsRentalService } from '../services/customer-contracts-rental.service.js';
import { CustomerFeedbackService } from '../services/customer-feedback.service.js';
import {
  validateAmcRenewalRequest,
  validateRentalReturnOrExtension,
  validateCustomerFeedbackCreate,
} from '../schemas/customer-feedback.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CustomerPortalContractsFeedbackApiController {
  /**
   * GET /api/portal/contracts
   */
  static async listContracts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const result = await CustomerContractsRentalService.listContracts(client, customerId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/contracts/:id
   */
  static async getContractDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const contractId = req.params?.id;
      if (!customerId || !contractId) {
        return { status: 400, error: 'customerId and contractId are required' };
      }

      const result = await CustomerContractsRentalService.getContractDetail(client, customerId, contractId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/contracts/:id/renew
   */
  static async requestContractRenewal(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      const payload = { ...req.body, contractId };
      const validated = validateAmcRenewalRequest(payload);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerContractsRentalService.requestRenewal(client, validated, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/rentals
   */
  static async listRentals(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const result = await CustomerContractsRentalService.listRentals(client, customerId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/rentals/:id/extend
   */
  static async requestRentalExtension(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const rentalContractId = req.params?.id;
      const payload = { ...req.body, rentalContractId, action: 'extend' };
      const validated = validateRentalReturnOrExtension(payload);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerContractsRentalService.requestRentalExtensionOrReturn(client, validated, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/rentals/:id/return
   */
  static async requestRentalReturn(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const rentalContractId = req.params?.id;
      const payload = { ...req.body, rentalContractId, action: 'return_pickup' };
      const validated = validateRentalReturnOrExtension(payload);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerContractsRentalService.requestRentalExtensionOrReturn(client, validated, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/feedback
   */
  static async submitFeedback(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateCustomerFeedbackCreate(req.body);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerFeedbackService.submitFeedback(client, validated, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/feedback/:workOrderId
   */
  static async getFeedbackForWorkOrder(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const workOrderId = req.params?.workOrderId;
      if (!customerId || !workOrderId) {
        return { status: 400, error: 'customerId and workOrderId are required' };
      }

      const result = await CustomerFeedbackService.getFeedbackForWorkOrder(client, customerId, workOrderId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/feedback-summary
   */
  static async getFeedbackSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const result = await CustomerFeedbackService.getFeedbackSummary(client, customerId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

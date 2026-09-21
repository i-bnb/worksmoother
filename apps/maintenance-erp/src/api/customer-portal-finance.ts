/**
 * =============================================================================
 * Customer Portal Finance REST API Controller (Quotations, Invoices, Payments)
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CustomerQuotationService } from '../services/customer-quotation.service.js';
import { CustomerPaymentService } from '../services/customer-payment.service.js';
import {
  validateCustomerQuotationApprove,
  validateCustomerQuotationReject,
  validatePaymentIntentCreate,
  validatePaymentIntentWebhook,
} from '../schemas/customer-payment.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CustomerPortalFinanceApiController {
  /**
   * GET /api/portal/quotations
   */
  static async listQuotations(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const filter = { status: req.query?.status as string };
      const result = await CustomerQuotationService.listQuotations(client, customerId, filter);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/quotations/:id
   */
  static async getQuotationDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const quotationId = req.params?.id;
      if (!customerId || !quotationId) {
        return { status: 400, error: 'customerId and quotationId are required' };
      }

      const result = await CustomerQuotationService.getQuotationDetail(client, customerId, quotationId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/quotations/:id/approve
   */
  static async approveQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const quotationId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      const customerId = req.body?.customerId || req.body?.customer_id || req.query?.customerId || req.query?.customer_id;

      if (!quotationId || !companyId || !customerId) {
        return { status: 400, error: 'quotationId, companyId, and customerId are required' };
      }

      const validated = validateCustomerQuotationApprove(req.body);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerQuotationService.approveQuotation(
        client,
        companyId,
        customerId,
        quotationId,
        validated,
        userId
      );

      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/quotations/:id/reject
   */
  static async rejectQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const quotationId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      const customerId = req.body?.customerId || req.body?.customer_id || req.query?.customerId || req.query?.customer_id;

      if (!quotationId || !companyId || !customerId) {
        return { status: 400, error: 'quotationId, companyId, and customerId are required' };
      }

      const validated = validateCustomerQuotationReject(req.body);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerQuotationService.rejectQuotation(
        client,
        companyId,
        customerId,
        quotationId,
        validated,
        userId
      );

      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/invoices
   */
  static async listInvoices(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const filter = {
        status: req.query?.status as string,
        unpaidOnly: String(req.query?.unpaidOnly) === 'true',
      };

      const result = await CustomerPaymentService.listInvoices(client, customerId, filter);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/invoices/:id
   */
  static async getInvoiceDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const invoiceId = req.params?.id;
      if (!customerId || !invoiceId) {
        return { status: 400, error: 'customerId and invoiceId are required' };
      }

      const result = await CustomerPaymentService.getInvoiceDetail(client, customerId, invoiceId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/invoices/:id/pay
   */
  static async createPaymentIntent(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const invoiceId = req.params?.id;
      const payload = { ...req.body, invoiceId };
      const validated = validatePaymentIntentCreate(payload);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerPaymentService.createPaymentIntent(client, validated, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/payments/webhook
   */
  static async processPaymentWebhook(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePaymentIntentWebhook(req.body);
      const result = await CustomerPaymentService.processPaymentWebhook(client, validated);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

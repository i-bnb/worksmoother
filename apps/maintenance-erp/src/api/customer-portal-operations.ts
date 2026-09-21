/**
 * =============================================================================
 * Customer Portal Operations REST API Controller (Requests, Work Orders, Visits)
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CustomerServiceRequestService } from '../services/customer-service-request.service.js';
import { CustomerWorkOrderService } from '../services/customer-work-order.service.js';
import { CustomerAppointmentService } from '../services/customer-appointment.service.js';
import {
  validateCustomerServiceRequestCreate,
  validateCustomerServiceRequestCancel,
} from '../schemas/customer-service-request.schema.js';
import { validateAppointmentRescheduleRequest } from '../schemas/customer-feedback.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CustomerPortalOperationsApiController {
  /**
   * GET /api/portal/service-requests
   */
  static async listServiceRequests(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const filter = {
        status: req.query?.status,
        siteId: req.query?.siteId || req.query?.site_id,
      };

      const result = await CustomerServiceRequestService.listServiceRequests(client, customerId, filter);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/service-requests
   */
  static async createServiceRequest(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateCustomerServiceRequestCreate(req.body);
      const userId = req.body?.userId || req.body?.user_id;
      const result = await CustomerServiceRequestService.createServiceRequest(client, validated, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/service-requests/:id
   */
  static async getServiceRequestDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const requestId = req.params?.id;
      if (!customerId || !requestId) {
        return { status: 400, error: 'customerId and requestId are required' };
      }

      const result = await CustomerServiceRequestService.getServiceRequestDetail(client, customerId, requestId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/service-requests/:id/cancel
   */
  static async cancelServiceRequest(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id || req.body?.customerId || req.body?.customer_id;
      const requestId = req.params?.id;
      if (!customerId || !requestId) {
        return { status: 400, error: 'customerId and requestId are required' };
      }

      const validated = validateCustomerServiceRequestCancel(req.body);
      const userId = req.body?.userId || req.body?.user_id;
      await CustomerServiceRequestService.cancelServiceRequest(client, customerId, requestId, validated.reason, userId);
      return { status: 200, data: { success: true, message: 'Service request cancelled successfully' } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/work-orders
   */
  static async listWorkOrders(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const filter = {
        status: req.query?.status,
        siteId: req.query?.siteId || req.query?.site_id,
      };

      const result = await CustomerWorkOrderService.listWorkOrders(client, customerId, filter);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/work-orders/:id
   */
  static async getWorkOrderDetail(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const workOrderId = req.params?.id;
      if (!customerId || !workOrderId) {
        return { status: 400, error: 'customerId and workOrderId are required' };
      }

      const result = await CustomerWorkOrderService.getWorkOrderDetail(client, customerId, workOrderId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/work-orders/:id/report
   */
  static async getServiceReport(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      const workOrderId = req.params?.id;
      if (!customerId || !workOrderId) {
        return { status: 400, error: 'customerId and workOrderId are required' };
      }

      const result = await CustomerWorkOrderService.getServiceReport(client, customerId, workOrderId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/appointments
   */
  static async listAppointments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const filter = {
        upcomingOnly: String(req.query?.upcomingOnly) === 'true',
        status: req.query?.status,
      };

      const result = await CustomerAppointmentService.listAppointments(client, customerId, filter);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/appointments/:id/reschedule
   */
  static async rescheduleAppointment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const appointmentId = req.params?.id;
      const payload = { ...req.body, appointmentId };
      const validated = validateAppointmentRescheduleRequest(payload);
      const userId = req.body?.userId || req.body?.user_id;

      const result = await CustomerAppointmentService.requestReschedule(client, validated, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/appointment-change-requests
   */
  static async listChangeRequests(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) return { status: 400, error: 'customerId is required' };

      const result = await CustomerAppointmentService.listChangeRequests(client, customerId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

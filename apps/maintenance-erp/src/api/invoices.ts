import { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceService } from '../services/invoice.service.js';
import { validateInvoiceCreate } from '../schemas/invoice.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class InvoicesApiController {
  static async createInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateInvoiceCreate(req.body);
      const result = await InvoiceService.createInvoice(client, validated);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createFromWorkOrder(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const workOrderId = req.body?.workOrderId;
      if (!workOrderId) return { status: 400, error: 'workOrderId is required' };

      const result = await InvoiceService.createFromWorkOrder(client, workOrderId, {
        dueDate: req.body?.dueDate,
        notes: req.body?.notes,
        idempotencyKey: req.body?.idempotencyKey,
      });

      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listInvoices(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      let query = client
        .from('invoices')
        .select('*, customer:customers(id, name, code)')
        .order('created_at', { ascending: false });

      if (req.query?.customerId) {
        query = query.eq('customer_id', req.query.customerId);
      }
      if (req.query?.status) {
        query = query.eq('status', req.query.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Invoice ID is required' };

      const data = await InvoiceService.getInvoice(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async issueInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Invoice ID is required' };

      const result = await InvoiceService.issueInvoice(client, id);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async voidInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Customer cancellation / Billing error';
      if (!id) return { status: 400, error: 'Invoice ID is required' };

      const result = await InvoiceService.voidInvoice(client, id, reason);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

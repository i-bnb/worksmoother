import { SupabaseClient } from '@supabase/supabase-js';
import { QuotationService } from '../services/quotation.service.js';
import { validateQuotationCreate } from '../schemas/quotation.schema.js';

export interface ApiRequest {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
}

export interface ApiResponse {
  status: number;
  data?: any;
  error?: string;
}

export class QuotationsApiController {
  static async createQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateQuotationCreate(req.body);
      const result = await QuotationService.createQuotation(client, validated);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listQuotations(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      let query = client
        .from('quotations')
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

  static async getQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const { data, error } = await client
        .from('quotations')
        .select('*, lines:quotation_lines(*), history:quotation_status_history(*)')
        .eq('id', id)
        .single();

      if (error) return { status: 404, error: 'Quotation not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async sendQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const { data, error } = await client
        .from('quotations')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const result = await QuotationService.approveQuotation(client, id);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async acceptQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const result = await QuotationService.acceptQuotation(client, id);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async rejectQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Customer declined';
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const result = await QuotationService.rejectQuotation(client, id, reason);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async reviseQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const result = await QuotationService.reviseQuotation(client, id, req.body?.modifications || {});
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async convertToInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Quotation ID is required' };

      const result = await QuotationService.convertToInvoice(client, id, {
        dueDate: req.body?.dueDate,
        notes: req.body?.notes,
        idempotencyKey: req.body?.idempotencyKey,
      });

      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

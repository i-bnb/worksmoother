import { SupabaseClient } from '@supabase/supabase-js';
import { PaymentService } from '../services/payment.service.js';
import { validatePaymentCreate } from '../schemas/payment.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class PaymentsApiController {
  static async recordPayment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePaymentCreate(req.body);
      const result = await PaymentService.recordPayment(client, validated);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listPayments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      let query = client
        .from('payments')
        .select('*, customer:customers(id, name, code), allocations:payment_allocations(*)')
        .order('payment_date', { ascending: false });

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

  static async getPayment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Payment ID is required' };

      const { data, error } = await client
        .from('payments')
        .select('*, customer:customers(*), allocations:payment_allocations(*, invoice:invoices(*))')
        .eq('id', id)
        .single();

      if (error) return { status: 404, error: 'Payment not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async allocatePayment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { invoiceId, amount } = req.body || {};
      if (!id || !invoiceId || !amount) {
        return { status: 400, error: 'paymentId, invoiceId and amount are required' };
      }

      const result = await PaymentService.allocatePayment(client, id, invoiceId, amount);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async reversePayment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Payment reversal requested';
      if (!id) return { status: 400, error: 'Payment ID is required' };

      const result = await PaymentService.reversePayment(client, id, reason);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

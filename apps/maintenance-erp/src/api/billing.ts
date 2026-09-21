import { SupabaseClient } from '@supabase/supabase-js';
import { PaymentService } from '../services/payment.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class BillingApiController {
  static async getCustomerBillingSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.params?.id;
      if (!customerId) return { status: 400, error: 'Customer ID is required' };

      const summary = await PaymentService.getCustomerBillingSummary(client, customerId);
      return { status: 200, data: summary };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

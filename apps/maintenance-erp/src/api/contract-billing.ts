import { SupabaseClient } from '@supabase/supabase-js';
import { ContractBillingService } from '../services/contract-billing.service.js';
import { validateContractBillingQuery } from '../schemas/contract-billing.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ContractBillingApiController {
  static async generateBillingSchedule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await ContractBillingService.generateBillingSchedule(client, contractId);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listBillingSchedules(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await ContractBillingService.listBillingSchedules(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async generateRecurringInvoices(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { asOfDate } = validateContractBillingQuery(req.query || req.body);
      const data = await ContractBillingService.generateDueInvoices(client, asOfDate);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

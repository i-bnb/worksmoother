import { SupabaseClient } from '@supabase/supabase-js';
import { RentalContractService } from '../services/rental-contract.service.js';
import { RentalReportingService } from '../services/rental-reporting.service.js';
import { validateRentalContractCreate } from '../schemas/rental-contract.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class RentalContractsApiController {
  static async createContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalContractCreate(req.body);
      const contractId = await RentalContractService.createContract(client, validated, req.body?.userId);
      return { status: 201, data: { contractId } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      await RentalContractService.approveContract(client, id, req.body?.approvedBy);
      return { status: 200, data: { message: 'Contract approved successfully' } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async cancelContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      await RentalContractService.cancelContract(client, id, req.body?.reason);
      return { status: 200, data: { message: 'Contract cancelled successfully' } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async convertQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const quotationId = req.params?.quotationId || req.body?.quotationId;
      if (!quotationId) return { status: 400, error: 'quotationId is required' };

      const contractId = await RentalContractService.convertQuotationToRentalContract(
        client,
        quotationId,
        req.body?.userId
      );
      return { status: 201, data: { contractId } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getOverdueRentals(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await RentalReportingService.getOverdueRentals(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

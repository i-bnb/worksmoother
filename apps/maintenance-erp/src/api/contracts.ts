import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceContractService } from '../services/service-contract.service.js';
import { ContractAssetService } from '../services/contract-asset.service.js';
import { ContractEntitlementService } from '../services/contract-entitlement.service.js';
import { ContractRenewalService } from '../services/contract-renewal.service.js';
import { ContractReportingService } from '../services/contract-reporting.service.js';
import {
  validateContractCreate,
  validateContractAssetAdd,
  validateContractEntitlementCreate,
} from '../schemas/contract.schema.js';
import { validateContractRenewal } from '../schemas/contract-billing.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ContractsApiController {
  static async createContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateContractCreate(req.body);
      const data = await ServiceContractService.createContract(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listContracts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await ServiceContractService.listContracts(client, companyId, {
        customerId: req.query?.customerId || req.query?.customer_id,
        status: req.query?.status,
        contractType: req.query?.contractType || req.query?.contract_type,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const data = await ServiceContractService.getContract(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async approveContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const approverId = req.body?.approverId || req.body?.approver_id;
      const data = await ServiceContractService.approveContract(client, id, approverId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async activateContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const data = await ServiceContractService.activateContract(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async suspendContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Contract temporarily suspended';
      const userId = req.body?.userId || req.body?.user_id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const data = await ServiceContractService.suspendContract(client, id, reason, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async resumeContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const data = await ServiceContractService.resumeContract(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async cancelContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Contract cancelled';
      const userId = req.body?.userId || req.body?.user_id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const data = await ServiceContractService.cancelContract(client, id, reason, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async renewContract(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Contract ID is required' };

      const validated = validateContractRenewal(req.body);
      const data = await ContractRenewalService.renewContract(client, id, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async convertQuotation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const quotationId = req.params?.id;
      if (!quotationId) return { status: 400, error: 'Quotation ID is required' };

      const data = await ServiceContractService.convertQuotationToContract(client, quotationId, req.body || {});
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async addAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const validated = validateContractAssetAdd({ ...req.body, contractId });
      const data = await ContractAssetService.addAssetToContract(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listAssets(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await ContractAssetService.listContractAssets(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async removeAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const assetId = req.params?.assetId;
      if (!assetId) return { status: 400, error: 'Asset ID is required' };

      const data = await ContractAssetService.removeAssetFromContract(client, assetId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createEntitlement(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const validated = validateContractEntitlementCreate({ ...req.body, contractId });
      const data = await ContractEntitlementService.createEntitlement(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getUsage(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await ContractEntitlementService.getContractUsage(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getProfitability(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.id;
      if (!contractId) return { status: 400, error: 'Contract ID is required' };

      const data = await ContractReportingService.getContractProfitability(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getSummary(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await ContractReportingService.getContractsSummary(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getAssetHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const assetId = req.params?.id;
      if (!assetId) return { status: 400, error: 'Asset ID is required' };

      const data = await ContractAssetService.getAssetMaintenanceHistory(client, assetId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

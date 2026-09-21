import { SupabaseClient } from '@supabase/supabase-js';
import { RentalHandoverService } from '../services/rental-handover.service.js';
import { RentalExtensionService } from '../services/rental-extension.service.js';
import { RentalDamageService } from '../services/rental-damage.service.js';
import { RentalDepositService } from '../services/rental-deposit.service.js';
import { RentalBillingService } from '../services/rental-billing.service.js';
import {
  validateRentalDispatch,
  validateRentalReturn,
  validateRentalExtensionRequest,
  validateRentalDamageAssessment,
  validateRentalDepositAction,
} from '../schemas/rental-operation.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class RentalOperationsApiController {
  static async dispatchAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalDispatch(req.body);
      const data = await RentalHandoverService.dispatchAsset(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async returnAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalReturn(req.body);
      const data = await RentalHandoverService.returnAsset(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async requestExtension(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalExtensionRequest(req.body);
      const data = await RentalExtensionService.requestExtension(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveExtension(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Extension ID is required' };

      const data = await RentalExtensionService.approveExtension(client, id, req.body?.approvedBy);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async assessDamage(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalDamageAssessment(req.body);
      const data = await RentalDamageService.assessDamage(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveDamage(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const approvedCharge = Number(req.body?.approvedCharge ?? 0);
      if (!id) return { status: 400, error: 'Damage assessment ID is required' };
      if (approvedCharge <= 0) return { status: 400, error: 'approvedCharge must be strictly positive' };

      await RentalDamageService.approveDamageCharge(client, id, approvedCharge, req.body?.approverId);
      return { status: 200, data: { message: 'Damage charge approved successfully' } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async recordDepositAction(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalDepositAction(req.body);
      const data = await RentalDepositService.recordDepositAction(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getDepositLedger(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.contractId || req.query?.contractId;
      if (!contractId) return { status: 400, error: 'contractId is required' };

      const data = await RentalDepositService.getDepositLedger(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async generateInvoice(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.contractId || req.body?.contractId;
      if (!contractId) return { status: 400, error: 'contractId is required' };

      const data = await RentalBillingService.generateRentalInvoice(client, contractId);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listCharges(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const contractId = req.params?.contractId || req.query?.contractId;
      if (!contractId) return { status: 400, error: 'contractId is required' };

      const data = await RentalBillingService.listContractCharges(client, contractId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

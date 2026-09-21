import { SupabaseClient } from '@supabase/supabase-js';
import { TaxProfileService } from '../services/tax-profile.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class TaxProfilesApiController {
  /**
   * POST /api/tax-profiles
   */
  static async createOrUpdateProfile(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const profile = await TaxProfileService.createOrUpdateTaxProfile(client, req.body);
      return { status: 200, data: profile };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/tax-profiles/:entityType/:entityId
   */
  static async getProfile(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const entityType = req.params?.entityType as any;
      const entityId = req.params?.entityId;
      if (!companyId || !entityType || !entityId) {
        return { status: 400, error: 'companyId, entityType, and entityId are required' };
      }
      const profile = await TaxProfileService.getTaxProfile(client, companyId, entityType, entityId);
      if (!profile) return { status: 404, error: 'Tax profile not found' };
      return { status: 200, data: profile };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/tax-profiles/hsn-sac
   */
  static async createHsnSac(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const result = await TaxProfileService.createHsnSacCode(client, req.body);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/tax-profiles/hsn-sac/:code
   */
  static async getHsnSac(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const code = req.params?.code;
      if (!companyId || !code) return { status: 400, error: 'companyId and code are required' };
      const result = await TaxProfileService.getHsnSacByCode(client, companyId, code);
      if (!result) return { status: 404, error: 'HSN/SAC code not found' };
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/tax-profiles/resolve-pos
   */
  static async resolvePlaceOfSupply(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const result = TaxProfileService.resolvePlaceOfSupply(req.body);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

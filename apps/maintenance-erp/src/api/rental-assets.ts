import { SupabaseClient } from '@supabase/supabase-js';
import { RentalAssetService } from '../services/rental-asset.service.js';
import { RentalAvailabilityService } from '../services/rental-availability.service.js';
import { RentalReportingService } from '../services/rental-reporting.service.js';
import { validateRentalAssetCreate, validateRentalAssetUpdate } from '../schemas/rental-asset.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class RentalAssetsApiController {
  static async createAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateRentalAssetCreate(req.body);
      const data = await RentalAssetService.createAsset(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Asset ID is required' };

      const data = await RentalAssetService.getAssetById(client, id);
      if (!data) return { status: 404, error: 'Rental asset not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async updateAsset(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Asset ID is required' };

      const patch = validateRentalAssetUpdate(req.body);
      const data = await RentalAssetService.updateAsset(client, id, patch);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async checkAvailability(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const startDate = req.query?.startDate || req.query?.start_date;
      const endDate = req.query?.endDate || req.query?.end_date;
      const buffer = req.query?.bufferDays ? Number(req.query.bufferDays) : undefined;

      if (!id) return { status: 400, error: 'Asset ID is required' };
      if (!startDate || !endDate) {
        return { status: 400, error: 'startDate and endDate are required query parameters' };
      }

      const data = await RentalAvailabilityService.checkAvailabilityLive(
        client,
        id,
        startDate,
        endDate,
        buffer
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async searchAvailableFleet(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const startDate = req.query?.startDate || req.query?.start_date;
      const endDate = req.query?.endDate || req.query?.end_date;
      const category = req.query?.category;
      const buffer = req.query?.bufferDays ? Number(req.query.bufferDays) : undefined;

      if (!companyId) return { status: 400, error: 'companyId is required' };
      if (!startDate || !endDate) {
        return { status: 400, error: 'startDate and endDate are required' };
      }

      const assetIds = await RentalAvailabilityService.searchAvailableFleet(client, {
        companyId,
        startDate,
        endDate,
        category,
        bufferDays: buffer,
      });

      return { status: 200, data: { availableAssetIds: assetIds, count: assetIds.length } };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async getUtilizationReport(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const startDate = req.query?.startDate || req.query?.start_date;
      const endDate = req.query?.endDate || req.query?.end_date;

      if (!companyId || !startDate || !endDate) {
        return { status: 400, error: 'companyId, startDate, and endDate are required' };
      }

      const data = await RentalReportingService.getUtilizationReport(client, companyId, startDate, endDate);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

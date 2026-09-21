import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationPreferenceService } from '../services/notification-preference.service.js';
import {
  validatePreferenceUpdate,
  validatePreferenceBatchUpdate,
  validateCommunicationSettingsUpdate,
} from '../schemas/communication-settings.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class NotificationPreferencesApiController {
  /**
   * GET /api/notification-preferences
   */
  static async getUserPreferences(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const userId = req.query?.userId || req.query?.user_id;

      if (!companyId || !userId) {
        return { status: 400, error: 'companyId and userId are required' };
      }

      const data = await NotificationPreferenceService.getUserPreferences(client, companyId, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/notification-preferences
   */
  static async updatePreference(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePreferenceUpdate(req.body);
      const data = await NotificationPreferenceService.updateUserPreference(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/notification-preferences/batch
   */
  static async batchUpdatePreferences(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePreferenceBatchUpdate(req.body);
      const data = await NotificationPreferenceService.batchUpdatePreferences(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/communication-settings
   */
  static async getTenantSettings(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await NotificationPreferenceService.getTenantSettings(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/communication-settings
   */
  static async updateTenantSettings(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateCommunicationSettingsUpdate(req.body);
      const data = await NotificationPreferenceService.updateTenantSettings(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

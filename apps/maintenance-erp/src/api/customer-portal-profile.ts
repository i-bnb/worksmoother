/**
 * =============================================================================
 * Customer Portal Profile & Identity REST API Controller
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CustomerProfileService } from '../services/customer-profile.service.js';
import { CustomerPortalAuthService } from '../services/customer-portal-auth.service.js';
import {
  validatePortalProfileUpdate,
  validatePortalSiteRequest,
  validatePortalUserInvite,
} from '../schemas/customer-portal-auth.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CustomerPortalProfileApiController {
  /**
   * GET /api/portal/profile
   */
  static async getProfile(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) {
        return { status: 400, error: 'customerId is required' };
      }

      const profile = await CustomerProfileService.getProfile(client, customerId);
      return { status: 200, data: profile };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/portal/profile
   */
  static async updateProfile(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id || req.body?.customerId || req.body?.customer_id;
      if (!customerId) {
        return { status: 400, error: 'customerId is required' };
      }

      const validated = validatePortalProfileUpdate(req.body);
      await CustomerProfileService.updateProfile(client, customerId, validated);
      return { status: 200, data: { success: true, message: 'Profile updated successfully' } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/portal/sites
   */
  static async getSites(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const customerId = req.query?.customerId || req.query?.customer_id;
      if (!customerId) {
        return { status: 400, error: 'customerId is required' };
      }

      const sites = await CustomerProfileService.getSites(client, customerId);
      return { status: 200, data: sites };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/sites/request
   */
  static async requestSite(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePortalSiteRequest(req.body);
      const userId = req.body?.userId || req.body?.user_id;
      const result = await CustomerProfileService.requestSite(client, validated, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/portal/users/invite
   */
  static async invitePortalUser(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePortalUserInvite(req.body);
      const inviterId = req.body?.inviterUserId || req.body?.inviter_id;
      const result = await CustomerPortalAuthService.invitePortalUser(client, validated, inviterId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationRuleService } from '../services/notification-rule.service.js';
import { ReminderEngineService } from '../services/reminder-engine.service.js';
import {
  validateNotificationRuleCreate,
  validateNotificationRuleUpdate,
  validateReminderRuleCreate,
} from '../schemas/notification-rule.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class NotificationRulesApiController {
  /**
   * GET /api/notification-rules
   */
  static async listRules(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const eventType = req.query?.eventType || req.query?.event_type;
      const data = await NotificationRuleService.listRules(client, companyId, eventType);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/notification-rules
   */
  static async createRule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateNotificationRuleCreate(req.body);
      const data = await NotificationRuleService.createRule(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/notification-rules/:id
   */
  static async updateRule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Rule ID is required' };

      const validated = validateNotificationRuleUpdate(req.body);
      const data = await NotificationRuleService.updateRule(client, id, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/reminder-rules
   */
  static async listReminderRules(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const entityType = req.query?.entityType || req.query?.entity_type;
      const data = await ReminderEngineService.listReminderRules(client, companyId, entityType);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/reminder-rules
   */
  static async createReminderRule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateReminderRuleCreate(req.body);
      const data = await ReminderEngineService.createReminderRule(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

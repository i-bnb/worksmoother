import { SupabaseClient } from '@supabase/supabase-js';
import { CommunicationHistoryService } from '../services/communication-history.service.js';
import { validateManualCommunication } from '../schemas/notification.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CommunicationsApiController {
  /**
   * GET /api/communication-deliveries
   */
  static async getDeliveryLogs(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await CommunicationHistoryService.getDeliveryLogs(client, companyId, {
        channel: req.query?.channel,
        status: req.query?.status,
        page: req.query?.page ? parseInt(req.query.page, 10) : 1,
        limit: req.query?.limit ? parseInt(req.query.limit, 10) : 20,
      });

      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/communication-history/:entityType/:entityId
   */
  static async getEntityCommunicationHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const entityType = req.params?.entityType;
      const entityId = req.params?.entityId;
      const companyId = req.query?.companyId || req.query?.company_id;

      if (!entityType || !entityId || !companyId) {
        return { status: 400, error: 'entityType, entityId, and companyId are required' };
      }

      const history = await CommunicationHistoryService.getEntityCommunicationHistory(
        client,
        companyId,
        entityType,
        entityId
      );

      return { status: 200, data: history };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/communications/manual
   */
  static async sendManualCommunication(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateManualCommunication(req.body);
      const data = await CommunicationHistoryService.sendManualCommunication(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/communications/test
   * Controlled test dispatch requiring management authorization
   */
  static async testCommunication(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, channel, recipientContact, testMessage, userId } = req.body || {};
      if (!companyId || !channel || !recipientContact) {
        return { status: 400, error: 'companyId, channel, and recipientContact are required' };
      }

      const validated = validateManualCommunication({
        companyId,
        recipientContact,
        recipientType: 'other',
        channel,
        subject: `[TEST] Communication System Verification (${channel})`,
        message: testMessage || `Test communication message dispatched successfully via ${channel}.`,
        userId,
      });

      const data = await CommunicationHistoryService.sendManualCommunication(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

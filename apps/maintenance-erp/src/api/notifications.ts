import { SupabaseClient } from '@supabase/supabase-js';
import { InAppNotificationService } from '../services/in-app-notification.service.js';
import { validateNotificationListQuery } from '../schemas/notification.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class NotificationsApiController {
  /**
   * GET /api/notifications
   */
  static async listNotifications(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateNotificationListQuery({ ...req.query, ...req.params });
      const result = await InAppNotificationService.getNotifications(client, validated);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/notifications/unread-count
   */
  static async getUnreadCount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const userId = req.query?.userId || req.query?.user_id;

      if (!companyId || !userId) {
        return { status: 400, error: 'companyId and userId are required' };
      }

      const count = await InAppNotificationService.getUnreadCount(client, companyId, userId);
      return { status: 200, data: { unreadCount: count } };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/notifications/:id/read
   */
  static async markAsRead(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const notificationId = req.params?.id;
      const { companyId, userId } = req.body || {};

      if (!notificationId || !companyId) {
        return { status: 400, error: 'Notification ID and companyId are required' };
      }

      const data = await InAppNotificationService.markAsRead(client, companyId, notificationId, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/notifications/read-all
   */
  static async markAllAsRead(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, userId } = req.body || {};

      if (!companyId || !userId) {
        return { status: 400, error: 'companyId and userId are required' };
      }

      const result = await InAppNotificationService.markAllAsRead(client, companyId, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

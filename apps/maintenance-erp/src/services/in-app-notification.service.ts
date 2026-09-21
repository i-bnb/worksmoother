import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationListQueryDto } from '../schemas/notification.schema.js';

export class InAppNotificationService {
  /**
   * Retrieves paginated notifications for a user/company.
   */
  static async getNotifications(client: SupabaseClient, query: NotificationListQueryDto) {
    let q = client
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('company_id', query.companyId);

    if (query.userId) {
      q = q.eq('user_id', query.userId);
    }

    if (query.channel) {
      q = q.eq('channel', query.channel);
    } else {
      q = q.eq('channel', 'in_app');
    }

    if (query.unreadOnly) {
      q = q.is('read_at', null).not('status', 'in', '("cancelled","failed")');
    }

    if (query.entityType) {
      q = q.eq('reference_table', query.entityType);
    }

    if (query.entityId) {
      q = q.eq('reference_id', query.entityId);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, count, error } = await q
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Failed to list notifications: ${error.message}`);

    return {
      data: data || [],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / query.limit),
      },
    };
  }

  /**
   * Retrieves the unread in-app notification count for a user.
   */
  static async getUnreadCount(
    client: SupabaseClient,
    companyId: string,
    userId: string
  ): Promise<number> {
    const { data, error } = await client.rpc('get_unread_notifications_count', {
      p_company_id: companyId,
      p_user_id: userId,
    });

    if (error) {
      // Fallback query if RPC unavailable
      const { count, error: qErr } = await client
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .eq('channel', 'in_app')
        .is('read_at', null)
        .not('status', 'in', '("cancelled","failed")');

      if (qErr) throw new Error(`Failed to count unread notifications: ${qErr.message}`);
      return count || 0;
    }

    return Number(data || 0);
  }

  /**
   * Marks a single notification as read.
   */
  static async markAsRead(
    client: SupabaseClient,
    companyId: string,
    notificationId: string,
    userId?: string
  ) {
    const nowIso = new Date().toISOString();
    let query = client
      .from('notifications')
      .update({
        read_at: nowIso,
        status: 'read',
        updated_at: nowIso,
      })
      .eq('id', notificationId)
      .eq('company_id', companyId);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.select().single();
    if (error) throw new Error(`Failed to mark notification as read: ${error.message}`);
    return data;
  }

  /**
   * Marks all unread in-app notifications as read for a user.
   */
  static async markAllAsRead(
    client: SupabaseClient,
    companyId: string,
    userId: string
  ): Promise<{ updatedCount: number }> {
    const { data, error } = await client.rpc('mark_all_notifications_read', {
      p_company_id: companyId,
      p_user_id: userId,
    });

    if (error) {
      // Fallback update query
      const nowIso = new Date().toISOString();
      const { data: updated, error: uErr } = await client
        .from('notifications')
        .update({
          read_at: nowIso,
          status: 'read',
          updated_at: nowIso,
        })
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .is('read_at', null)
        .select('id');

      if (uErr) throw new Error(`Failed to mark all as read: ${uErr.message}`);
      return { updatedCount: (updated || []).length };
    }

    return { updatedCount: Number(data || 0) };
  }
}

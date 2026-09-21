/**
 * =============================================================================
 * Test Suite 5: In-App Notifications Feed & Lifecycle State Management
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateNotificationListQuery } from '../../src/schemas/notification.schema.js';
import { InAppNotificationService } from '../../src/services/in-app-notification.service.js';

describe('Phase 8: In-App Notifications Feed & Lifecycle', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('notifications').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Query Validation & Pagination Logic', () => {
    it('validates default pagination and filtering parameters', () => {
      const valid = validateNotificationListQuery({
        companyId: DEMO_COMPANY_A,
        userId: 'usr-101',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.userId).toBe('usr-101');
      expect(valid.page).toBe(1);
      expect(valid.limit).toBe(20);
      expect(valid.unreadOnly).toBe(false);
    });

    it('parses custom page, limit, and unreadOnly flags accurately', () => {
      const valid = validateNotificationListQuery({
        company_id: DEMO_COMPANY_A,
        user_id: 'usr-101',
        page: '3',
        limit: '50',
        unread_only: 'true',
        channel: 'in_app',
        entity_type: 'work_order',
        entity_id: 'wo-999',
      });

      expect(valid.page).toBe(3);
      expect(valid.limit).toBe(50);
      expect(valid.unreadOnly).toBe(true);
      expect(valid.channel).toBe('in_app');
      expect(valid.entityType).toBe('work_order');
      expect(valid.entityId).toBe('wo-999');
    });

    it('enforces limit boundary constraints between 1 and 100', () => {
      const capped = validateNotificationListQuery({
        companyId: DEMO_COMPANY_A,
        limit: '500', // exceeds max 100
      });
      expect(capped.limit).toBe(100);

      const floor = validateNotificationListQuery({
        companyId: DEMO_COMPANY_A,
        limit: '-5', // below 1
      });
      expect(floor.limit).toBe(1);
    });

    it('rejects query missing required companyId', () => {
      expect(() => validateNotificationListQuery({})).toThrow(/companyId is required/i);
    });
  });

  describe('Database Integration', () => {
    it('executes in-app list and unread count queries if live DB is available', async () => {
      if (!isLiveDb) return;

      const feed = await InAppNotificationService.getNotifications(admin, {
        companyId: DEMO_COMPANY_A,
        page: 1,
        limit: 10,
      });

      expect(feed.data).toBeDefined();
      expect(feed.pagination).toBeDefined();
      expect(feed.pagination.page).toBe(1);

      const unread = await InAppNotificationService.getUnreadCount(
        admin,
        DEMO_COMPANY_A,
        '00000000-0000-0000-0000-000000000000'
      );
      expect(typeof unread).toBe('number');
    });
  });
});

/**
 * =============================================================================
 * Test Suite 3: Notification Rules Engine & Recipient Resolution
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  NotificationRuleService,
  NotificationRuleRecord,
} from '../../src/services/notification-rule.service.js';
import { RecipientResolverService } from '../../src/services/recipient-resolver.service.js';
import {
  validateNotificationRuleCreate,
  validateNotificationRuleUpdate,
} from '../../src/schemas/notification-rule.schema.js';

describe('Phase 8: Notification Rules & Recipient Resolution', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('notification_rules').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Condition Evaluation Engine', () => {
    it('evaluates equality and inequality operators correctly', () => {
      expect(NotificationRuleService.evaluateCondition('high', 'eq', 'high')).toBe(true);
      expect(NotificationRuleService.evaluateCondition('high', 'eq', 'low')).toBe(false);
      expect(NotificationRuleService.evaluateCondition('high', 'neq', 'low')).toBe(true);
      expect(NotificationRuleService.evaluateCondition('high', 'neq', 'high')).toBe(false);
    });

    it('evaluates numeric threshold comparison operators correctly', () => {
      expect(NotificationRuleService.evaluateCondition(7500, 'gt', 5000)).toBe(true);
      expect(NotificationRuleService.evaluateCondition(5000, 'gt', 5000)).toBe(false);
      expect(NotificationRuleService.evaluateCondition(5000, 'gte', 5000)).toBe(true);
      expect(NotificationRuleService.evaluateCondition(2500, 'lt', 5000)).toBe(true);
      expect(NotificationRuleService.evaluateCondition(5000, 'lte', 5000)).toBe(true);
    });

    it('evaluates substring containment operator correctly', () => {
      expect(NotificationRuleService.evaluateCondition('Urgent HVAC Compressor Trip', 'contains', 'urgent')).toBe(true);
      expect(NotificationRuleService.evaluateCondition('Routine Filter Replacement', 'contains', 'urgent')).toBe(false);
    });

    it('evaluates set inclusion (in) operator correctly', () => {
      expect(NotificationRuleService.evaluateCondition('critical', 'in', ['high', 'critical', 'emergency'])).toBe(true);
      expect(NotificationRuleService.evaluateCondition('low', 'in', ['high', 'critical', 'emergency'])).toBe(false);
    });

    it('matches complex multi-condition payloads', () => {
      const conditions: any[] = [
        { field: 'priority', operator: 'eq', value: 'critical' },
        { field: 'amount', operator: 'gte', value: 1000 },
      ];

      expect(NotificationRuleService.matchesConditions(conditions, { priority: 'critical', amount: 1500 })).toBe(true);
      expect(NotificationRuleService.matchesConditions(conditions, { priority: 'critical', amount: 500 })).toBe(false);
      expect(NotificationRuleService.matchesConditions(conditions, { priority: 'low', amount: 2000 })).toBe(false);
    });
  });

  describe('Pure Rule Matching & Priority Ordering', () => {
    it('filters active matching rules and sorts by priority descending', () => {
      const mockRules: NotificationRuleRecord[] = [
        {
          id: 'rule-low-prio',
          company_id: DEMO_COMPANY_A,
          name: 'Standard WO Assigned Notice',
          event_type: 'WORK_ORDER_ASSIGNED',
          recipient_type: 'technician',
          channel: 'in_app',
          conditions: [],
          is_active: true,
          priority: 5,
        },
        {
          id: 'rule-high-prio-critical',
          company_id: DEMO_COMPANY_A,
          name: 'Critical Emergency WO Assigned SMS',
          event_type: 'WORK_ORDER_ASSIGNED',
          recipient_type: 'technician',
          channel: 'sms',
          conditions: [{ field: 'priority', operator: 'eq', value: 'critical' }],
          is_active: true,
          priority: 20,
        },
        {
          id: 'rule-inactive',
          company_id: DEMO_COMPANY_A,
          name: 'Inactive Old Rule',
          event_type: 'WORK_ORDER_ASSIGNED',
          recipient_type: 'technician',
          channel: 'email',
          conditions: [],
          is_active: false, // Inactive
          priority: 50,
        },
        {
          id: 'rule-other-event',
          company_id: DEMO_COMPANY_A,
          name: 'Invoice Alert',
          event_type: 'INVOICE_CREATED',
          recipient_type: 'customer',
          channel: 'email',
          conditions: [],
          is_active: true,
          priority: 10,
        },
      ];

      // Critical payload should match rule-high-prio-critical and rule-low-prio, ordered by priority
      const matches = NotificationRuleService.filterMatchingRules(mockRules, 'WORK_ORDER_ASSIGNED', {
        priority: 'critical',
      });

      expect(matches).toHaveLength(2);
      expect(matches[0].id).toBe('rule-high-prio-critical'); // priority 20
      expect(matches[1].id).toBe('rule-low-prio');           // priority 5

      // Non-critical payload should only match rule-low-prio
      const nonCriticalMatches = NotificationRuleService.filterMatchingRules(mockRules, 'WORK_ORDER_ASSIGNED', {
        priority: 'medium',
      });
      expect(nonCriticalMatches).toHaveLength(1);
      expect(nonCriticalMatches[0].id).toBe('rule-low-prio');
    });
  });

  describe('Pure Dynamic Recipient Resolution', () => {
    it('resolves technician recipient from entity payload and technician profile list', () => {
      const technicians = [
        {
          id: 'emp-101',
          name: 'Zayd Al-Hashimi',
          email: 'zayd.tech@company.com',
          phone: '+971501112233',
          userId: 'usr-101',
        },
      ];

      const recipients = RecipientResolverService.resolvePure({
        recipientType: 'technician',
        entityPayload: { assigned_technician_id: 'emp-101' },
        technicians,
      });

      expect(recipients).toHaveLength(1);
      expect(recipients[0].recipientType).toBe('technician');
      expect(recipients[0].name).toBe('Zayd Al-Hashimi');
      expect(recipients[0].email).toBe('zayd.tech@company.com');
      expect(recipients[0].phone).toBe('+971501112233');
    });

    it('resolves customer recipient from entity payload', () => {
      const customers = [
        {
          id: 'cust-202',
          name: 'Emaar Hospitality Group',
          email: 'facilities@emaar.ae',
          phone: '+97148888888',
        },
      ];

      const recipients = RecipientResolverService.resolvePure({
        recipientType: 'customer',
        entityPayload: { customer_id: 'cust-202' },
        customers,
      });

      expect(recipients).toHaveLength(1);
      expect(recipients[0].recipientType).toBe('customer');
      expect(recipients[0].name).toBe('Emaar Hospitality Group');
      expect(recipients[0].email).toBe('facilities@emaar.ae');
    });

    it('resolves service managers holding operations_manager or supervisor roles', () => {
      const managers = [
        { id: 'mgr-1', name: 'Alice Supervisor', role: 'supervisor', userId: 'usr-mgr-1' },
        { id: 'mgr-2', name: 'Bob Operations', role: 'operations_manager', userId: 'usr-mgr-2' },
        { id: 'tech-3', name: 'Charlie Tech', role: 'technician', userId: 'usr-tech-3' },
      ];

      const recipients = RecipientResolverService.resolvePure({
        recipientType: 'service_manager',
        entityPayload: {},
        managers,
      });

      expect(recipients).toHaveLength(2);
      const names = recipients.map((r) => r.name);
      expect(names).toContain('Alice Supervisor');
      expect(names).toContain('Bob Operations');
      expect(names).not.toContain('Charlie Tech');
    });
  });

  describe('Notification Rule DTO Validation', () => {
    it('validates rule creation schema with conditions and priority', () => {
      const valid = validateNotificationRuleCreate({
        companyId: DEMO_COMPANY_A,
        name: 'Urgent Breakdown Alert to Dispatcher',
        eventType: 'WORK_ORDER_CREATED',
        recipientType: 'service_manager',
        channel: 'in_app',
        conditions: [{ field: 'priority', operator: 'eq', value: 'critical' }],
        priority: 50,
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.name).toBe('Urgent Breakdown Alert to Dispatcher');
      expect(valid.priority).toBe(50);
      expect(valid.conditions).toHaveLength(1);
    });

    it('rejects rule creation with invalid recipient type', () => {
      expect(() =>
        validateNotificationRuleCreate({
          companyId: DEMO_COMPANY_A,
          name: 'Invalid Rule',
          eventType: 'WORK_ORDER_CREATED',
          recipientType: 'random_stranger' as any,
          channel: 'in_app',
        })
      ).toThrow(/recipientType must be one of/i);
    });

    it('validates rule update schema', () => {
      const valid = validateNotificationRuleUpdate({
        name: 'Updated Rule Title',
        priority: 80,
      });

      expect(valid.name).toBe('Updated Rule Title');
      expect(valid.priority).toBe(80);
    });
  });
});

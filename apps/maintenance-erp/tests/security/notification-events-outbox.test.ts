/**
 * =============================================================================
 * Test Suite 1: Domain Events, Transactional Outbox & Idempotency
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  validateDomainEventCreate,
  validateOutboxProcessQuery,
  ALL_ERP_EVENT_TYPES,
} from '../../src/schemas/domain-event.schema.js';
import { EventDispatcherService } from '../../src/services/event-dispatcher.service.js';

describe('Phase 8: Domain Events & Transactional Outbox', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('domain_events').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Event Validation & Idempotency Key Generation', () => {
    it('generates deterministic SHA-256 idempotency key for identical parameters', () => {
      const companyId = DEMO_COMPANY_A;
      const eventId = 'ev-001';
      const recipient = 'technician@example.com';
      const channel = 'email';
      const eventType = 'WORK_ORDER_ASSIGNED';

      const key1 = EventDispatcherService.generateIdempotencyKey(
        companyId,
        eventId,
        recipient,
        channel,
        eventType
      );

      const key2 = EventDispatcherService.generateIdempotencyKey(
        companyId,
        eventId,
        recipient,
        channel,
        eventType
      );

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(32);
    });

    it('generates distinct idempotency keys for different channels or recipients', () => {
      const companyId = DEMO_COMPANY_A;
      const eventId = 'ev-001';

      const keyEmail = EventDispatcherService.generateIdempotencyKey(
        companyId,
        eventId,
        '+971500000000',
        'email',
        'WORK_ORDER_ASSIGNED'
      );

      const keySms = EventDispatcherService.generateIdempotencyKey(
        companyId,
        eventId,
        '+971500000000',
        'sms',
        'WORK_ORDER_ASSIGNED'
      );

      const keyDifferentRecipient = EventDispatcherService.generateIdempotencyKey(
        companyId,
        eventId,
        '+971555555555',
        'sms',
        'WORK_ORDER_ASSIGNED'
      );

      expect(keyEmail).not.toBe(keySms);
      expect(keySms).not.toBe(keyDifferentRecipient);
    });

    it('validates domain event creation schema with valid event type', () => {
      const valid = validateDomainEventCreate({
        companyId: DEMO_COMPANY_A,
        eventType: 'WORK_ORDER_ASSIGNED',
        entityType: 'work_order',
        entityId: 'wo-1025',
        actorId: 'usr-admin-01',
        payload: {
          work_order_number: 'WO-2026-001',
          priority: 'high',
          assigned_technician_id: 'emp-tech-01',
        },
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.eventType).toBe('WORK_ORDER_ASSIGNED');
      expect(valid.entityType).toBe('work_order');
      expect(valid.payload.work_order_number).toBe('WO-2026-001');
    });

    it('rejects domain event with unknown event type', () => {
      expect(() =>
        validateDomainEventCreate({
          companyId: DEMO_COMPANY_A,
          eventType: 'USER_LOGGED_IN_FACEBOOK' as any,
          entityType: 'user',
          entityId: 'usr-1',
        })
      ).toThrow(/Invalid eventType/i);
    });

    it('validates all recognized ERP event types in ALL_ERP_EVENT_TYPES array', () => {
      expect(ALL_ERP_EVENT_TYPES).toContain('WORK_ORDER_CREATED');
      expect(ALL_ERP_EVENT_TYPES).toContain('WORK_ORDER_ASSIGNED');
      expect(ALL_ERP_EVENT_TYPES).toContain('WORK_ORDER_SCHEDULED');
      expect(ALL_ERP_EVENT_TYPES).toContain('WORK_ORDER_DISPATCHED');
      expect(ALL_ERP_EVENT_TYPES).toContain('TECHNICIAN_CHECKED_IN');
      expect(ALL_ERP_EVENT_TYPES).toContain('TECHNICIAN_CHECKED_OUT');
      expect(ALL_ERP_EVENT_TYPES).toContain('WORK_ORDER_COMPLETED');
      expect(ALL_ERP_EVENT_TYPES).toContain('INVOICE_CREATED');
      expect(ALL_ERP_EVENT_TYPES).toContain('INVOICE_OVERDUE');
      expect(ALL_ERP_EVENT_TYPES).toContain('PAYMENT_RECEIVED');
      expect(ALL_ERP_EVENT_TYPES).toContain('AMC_EXPIRING');
      expect(ALL_ERP_EVENT_TYPES).toContain('RENTAL_OVERDUE');
      expect(ALL_ERP_EVENT_TYPES).toContain('SLA_BREACHED');
      expect(ALL_ERP_EVENT_TYPES).toContain('PARTS_READY');
    });

    it('validates outbox process query pagination and batch size bounds', () => {
      const valid = validateOutboxProcessQuery({
        companyId: DEMO_COMPANY_A,
        batchSize: 50,
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.batchSize).toBe(50);

      // Max capped at 100
      const capped = validateOutboxProcessQuery({
        companyId: DEMO_COMPANY_A,
        batchSize: 500,
      });
      expect(capped.batchSize).toBe(100);
    });
  });

  describe('Database Integration', () => {
    it('publishes domain event into outbox table if live DB is available', async () => {
      if (!isLiveDb) return;

      const result = await EventDispatcherService.publishEvent(admin, {
        companyId: DEMO_COMPANY_A,
        eventType: 'WORK_ORDER_CREATED',
        entityType: 'work_order',
        entityId: '11111111-1111-1111-1111-111111111111',
        payload: { work_order_number: 'WO-OUTBOX-TEST' },
      });

      expect(result.eventId).toBeDefined();
    });
  });
});

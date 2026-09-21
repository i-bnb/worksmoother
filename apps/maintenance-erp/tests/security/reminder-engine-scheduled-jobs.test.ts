/**
 * =============================================================================
 * Test Suite 8: Reminder Engine, Scheduled Job Triggers & Idempotency
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ReminderEngineService } from '../../src/services/reminder-engine.service.js';
import { validateReminderRuleCreate } from '../../src/schemas/notification-rule.schema.js';

describe('Phase 8: Reminder Engine & Scheduled Alerts', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('reminder_rules').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Reminder Time Offset Calculation', () => {
    it('calculates 24-hour advance appointment reminder timestamp accurately', () => {
      // Appointment: 2026-03-25T10:00:00.000Z
      const appointmentTime = '2026-03-25T10:00:00.000Z';
      const offsetMinutes = -1440; // 24 hours before

      const reminderTime = ReminderEngineService.calculateReminderTime(appointmentTime, offsetMinutes);

      expect(reminderTime).toBe('2026-03-24T10:00:00.000Z');
    });

    it('calculates 2-hour advance technician arrival reminder timestamp', () => {
      const appointmentTime = '2026-03-25T14:30:00.000Z';
      const offsetMinutes = -120; // 2 hours before

      const reminderTime = ReminderEngineService.calculateReminderTime(appointmentTime, offsetMinutes);

      expect(reminderTime).toBe('2026-03-25T12:30:00.000Z');
    });

    it('calculates 7-day advance AMC contract expiry alert timestamp', () => {
      const amcExpiryTime = '2026-04-30T00:00:00.000Z';
      const offsetMinutes = -7 * 24 * 60; // -10080 minutes (7 days)

      const reminderTime = ReminderEngineService.calculateReminderTime(amcExpiryTime, offsetMinutes);

      expect(reminderTime).toBe('2026-04-23T00:00:00.000Z');
    });

    it('calculates overdue reminder timestamp with positive offset', () => {
      const invoiceDueDate = '2026-03-15T00:00:00.000Z';
      const offsetMinutes = 1440; // 1 day after due date

      const reminderTime = ReminderEngineService.calculateReminderTime(invoiceDueDate, offsetMinutes);

      expect(reminderTime).toBe('2026-03-16T00:00:00.000Z');
    });

    it('returns original input if date format is invalid', () => {
      expect(ReminderEngineService.calculateReminderTime('invalid-date', -60)).toBe('invalid-date');
    });
  });

  describe('Reminder Rule DTO Validation', () => {
    it('validates reminder rule creation schema', () => {
      const valid = validateReminderRuleCreate({
        companyId: DEMO_COMPANY_A,
        name: 'Appointment 24h SMS Reminder to Customer',
        entityType: 'service_appointment',
        offsetMinutes: -1440,
        channel: 'sms',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.name).toBe('Appointment 24h SMS Reminder to Customer');
      expect(valid.entityType).toBe('service_appointment');
      expect(valid.offsetMinutes).toBe(-1440);
      expect(valid.channel).toBe('sms');
    });

    it('rejects reminder rule with unsupported entity type', () => {
      expect(() =>
        validateReminderRuleCreate({
          companyId: DEMO_COMPANY_A,
          name: 'Invalid Entity Reminder',
          entityType: 'employee_profile' as any,
          offsetMinutes: -60,
          channel: 'in_app',
        })
      ).toThrow(/entityType must be one of/i);
    });
  });

  describe('Database Integration', () => {
    it('creates reminder rule in database if live DB is available', async () => {
      if (!isLiveDb) return;

      const rule = await ReminderEngineService.createReminderRule(admin, {
        companyId: DEMO_COMPANY_A,
        name: `Automated Test 24h Reminder ${Date.now()}`,
        entityType: 'service_appointment',
        offsetMinutes: -1440,
        channel: 'in_app',
      });

      expect(rule.id).toBeDefined();
    });
  });
});

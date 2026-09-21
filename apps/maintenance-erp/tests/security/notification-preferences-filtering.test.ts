/**
 * =============================================================================
 * Test Suite 4: Notification Preferences, Channel Gates & Opt-In Filtering
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { NotificationPreferenceService } from '../../src/services/notification-preference.service.js';
import {
  validatePreferenceUpdate,
  validatePreferenceBatchUpdate,
  validateCommunicationSettingsUpdate,
  sanitizeProviderConfig,
} from '../../src/schemas/communication-settings.schema.js';

describe('Phase 8: Notification Preferences & Channel Filtering', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('notification_preferences').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Channel Enablement & Preference Filtering Engine', () => {
    it('allows notification when channel is enabled and user has no opt-outs', () => {
      const allowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'WORK_ORDER_ASSIGNED',
        channel: 'in_app',
        tenantSettings: { inAppEnabled: true, emailEnabled: true },
        userPreferences: [],
      });

      expect(allowed).toBe(true);
    });

    it('blocks notification when tenant globally disables that channel', () => {
      // Tenant disabled SMS
      const smsAllowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'WORK_ORDER_ASSIGNED',
        channel: 'sms',
        tenantSettings: { smsEnabled: false, inAppEnabled: true },
      });

      expect(smsAllowed).toBe(false);

      // Tenant disabled WhatsApp
      const waAllowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'WORK_ORDER_ASSIGNED',
        channel: 'whatsapp',
        tenantSettings: { whatsappEnabled: false, inAppEnabled: true },
      });

      expect(waAllowed).toBe(false);
    });

    it('blocks notification when user has explicitly opted out for that event and channel', () => {
      const userPreferences = [
        {
          eventType: 'WORK_ORDER_SCHEDULED',
          channel: 'email',
          isEnabled: false, // Opted out of email for schedule updates
        },
      ];

      const allowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'WORK_ORDER_SCHEDULED',
        channel: 'email',
        tenantSettings: { emailEnabled: true },
        userPreferences,
      });

      expect(allowed).toBe(false);
    });

    it('permits notification when user has opted out of a different event or different channel', () => {
      const userPreferences = [
        {
          eventType: 'INVOICE_CREATED',
          channel: 'sms',
          isEnabled: false,
        },
      ];

      // Checking email for WORK_ORDER_ASSIGNED -> allowed
      const allowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'WORK_ORDER_ASSIGNED',
        channel: 'email',
        tenantSettings: { emailEnabled: true },
        userPreferences,
      });

      expect(allowed).toBe(true);
    });

    it('bypasses user opt-outs for urgent or critical safety alerts', () => {
      const userPreferences = [
        {
          eventType: 'SLA_BREACHED',
          channel: 'in_app',
          isEnabled: false, // User tried to mute
        },
      ];

      const allowed = NotificationPreferenceService.isNotificationAllowed({
        eventType: 'SLA_BREACHED',
        channel: 'in_app',
        tenantSettings: { inAppEnabled: true },
        userPreferences,
        isUrgent: true, // Urgent flag set
      });

      expect(allowed).toBe(true);
    });
  });

  describe('Communication Settings & Secret Masking', () => {
    it('masks sensitive provider API keys and passwords in provider config', () => {
      const rawConfig = {
        apiKey: 'SG.real_secret_token_12345',
        smtpPassword: 'MySecretPassword!',
        twilioAuthToken: 'token_abc_xyz',
        host: 'smtp.sendgrid.net',
        port: 587,
      };

      const sanitized = sanitizeProviderConfig(rawConfig);

      expect(sanitized.apiKey).toBe('••••••••');
      expect(sanitized.smtpPassword).toBe('••••••••');
      expect(sanitized.twilioAuthToken).toBe('••••••••');
      expect(sanitized.host).toBe('smtp.sendgrid.net');
      expect(sanitized.port).toBe(587);
    });

    it('validates communication settings update schema', () => {
      const valid = validateCommunicationSettingsUpdate({
        companyId: DEMO_COMPANY_A,
        emailEnabled: true,
        smsEnabled: true,
        emailProvider: 'smtp',
        emailFromAddress: 'noreply@mycompany.com',
        emailFromName: 'Maintenance ERP Dispatcher',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.emailEnabled).toBe(true);
      expect(valid.emailProvider).toBe('smtp');
      expect(valid.emailFromAddress).toBe('noreply@mycompany.com');
    });

    it('validates single preference update schema', () => {
      const valid = validatePreferenceUpdate({
        companyId: DEMO_COMPANY_A,
        userId: 'usr-123',
        eventType: 'WORK_ORDER_ASSIGNED',
        channel: 'email',
        isEnabled: false,
      });

      expect(valid.userId).toBe('usr-123');
      expect(valid.eventType).toBe('WORK_ORDER_ASSIGNED');
      expect(valid.isEnabled).toBe(false);
    });

    it('validates batch preference update schema', () => {
      const valid = validatePreferenceBatchUpdate({
        companyId: DEMO_COMPANY_A,
        userId: 'usr-123',
        preferences: [
          { eventType: 'WORK_ORDER_ASSIGNED', channel: 'in_app', isEnabled: true },
          { eventType: 'WORK_ORDER_ASSIGNED', channel: 'email', isEnabled: false },
          { eventType: 'INVOICE_CREATED', channel: 'email', isEnabled: true },
        ],
      });

      expect(valid.preferences).toHaveLength(3);
      expect(valid.preferences[1].channel).toBe('email');
      expect(valid.preferences[1].isEnabled).toBe(false);
    });
  });
});

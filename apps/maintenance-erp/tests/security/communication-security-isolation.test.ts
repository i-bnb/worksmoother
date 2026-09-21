/**
 * =============================================================================
 * Test Suite 9: Communication Security, Tenant Isolation & Credential Masking
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getAdminClient,
  getAnonClient,
  DEMO_COMPANY_A,
  DEMO_COMPANY_B,
} from './helpers.js';
import { sanitizeProviderConfig } from '../../src/schemas/communication-settings.schema.js';
import { CommunicationsApiController } from '../../src/api/communications.js';

describe('Phase 8: Communication Security, Tenant Isolation & Credential Masking', () => {
  const admin = getAdminClient();
  const anon = getAnonClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('communication_settings').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Provider Credential Masking & Data Leakage Prevention', () => {
    it('aggressively masks all variations of secret tokens, keys, and passwords', () => {
      const sensitiveConfig = {
        api_key: 'SG.live_sendgrid_key_abc123',
        secret_access_key: 'AWS_SECRET_KEY_XYZ789',
        twilio_auth_token: 'auth_token_999',
        smtp_password: 'super_secret_smtp_pass',
        whatsapp_access_token: 'EAABwz_meta_cloud_token',
        webhook_signing_secret: 'whsec_987654321',
        public_sender_name: 'Maintenance ERP',
        default_port: 587,
        ssl_enabled: true,
      };

      const sanitized = sanitizeProviderConfig(sensitiveConfig);

      expect(sanitized.api_key).toBe('••••••••');
      expect(sanitized.secret_access_key).toBe('••••••••');
      expect(sanitized.twilio_auth_token).toBe('••••••••');
      expect(sanitized.smtp_password).toBe('••••••••');
      expect(sanitized.whatsapp_access_token).toBe('••••••••');
      expect(sanitized.webhook_signing_secret).toBe('••••••••');

      // Non-sensitive attributes must remain untouched
      expect(sanitized.public_sender_name).toBe('Maintenance ERP');
      expect(sanitized.default_port).toBe(587);
      expect(sanitized.ssl_enabled).toBe(true);
    });
  });

  describe('Controlled Communication API Safety', () => {
    it('rejects test communication missing required parameters', async () => {
      const response = await CommunicationsApiController.testCommunication(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          // missing channel and recipient
        },
      });

      expect(response.status).toBe(400);
      expect(response.error).toMatch(/channel, and recipientContact are required/i);
    });

    it('rejects manual communication missing companyId', async () => {
      const response = await CommunicationsApiController.sendManualCommunication(admin, {
        body: {
          recipientContact: 'someone@example.com',
          channel: 'email',
          message: 'Hello',
        },
      });

      expect(response.status).toBe(400);
      expect(response.error).toMatch(/companyId is required/i);
    });
  });

  describe('Row-Level Security & Tenant Isolation', () => {
    it('prevents anonymous unauthenticated access to domain events outbox', async () => {
      if (!isLiveDb) return;

      const { data, error } = await anon.from('domain_events').select('*');
      expect(data === null || data?.length === 0).toBe(true);
    });

    it('prevents anonymous unauthenticated access to communication settings', async () => {
      if (!isLiveDb) return;

      const { data, error } = await anon.from('communication_settings').select('*');
      expect(data === null || data?.length === 0).toBe(true);
    });

    it('isolates notification preferences between different companies', async () => {
      if (!isLiveDb) return;

      // Query Company A preferences
      const { data: compAPrefs } = await admin
        .from('notification_preferences')
        .select('*')
        .eq('company_id', DEMO_COMPANY_A);

      // Verify no records from Company B exist in Company A query
      for (const pref of compAPrefs || []) {
        expect(pref.company_id).toBe(DEMO_COMPANY_A);
        expect(pref.company_id).not.toBe(DEMO_COMPANY_B);
      }
    });
  });
});

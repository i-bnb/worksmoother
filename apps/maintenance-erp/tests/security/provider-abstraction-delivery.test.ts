/**
 * =============================================================================
 * Test Suite 6: Communication Provider Abstraction & Multi-Channel Delivery
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProviderRegistry,
  MockEmailProvider,
  MockSmsProvider,
  MockWhatsAppProvider,
} from '../../src/services/communication-provider.service.js';
import { validateManualCommunication } from '../../src/schemas/notification.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 8: Communication Provider Abstraction & Multi-Channel Delivery', () => {
  let emailMock: MockEmailProvider;
  let smsMock: MockSmsProvider;
  let waMock: MockWhatsAppProvider;

  beforeEach(() => {
    emailMock = new MockEmailProvider();
    smsMock = new MockSmsProvider();
    waMock = new MockWhatsAppProvider();

    ProviderRegistry.registerEmailProvider('mock', emailMock);
    ProviderRegistry.registerSmsProvider('mock', smsMock);
    ProviderRegistry.registerWhatsAppProvider('mock', waMock);
  });

  describe('Email Provider Abstraction', () => {
    it('successfully delivers email through provider and tracks mock message ID', async () => {
      const provider = ProviderRegistry.getEmailProvider('mock');

      const result = await provider.sendEmail({
        to: 'customer@hospitality.ae',
        subject: 'Service Visit Reminder',
        text: 'Your technician is scheduled for tomorrow at 10:00 AM.',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('delivered');
      expect(result.providerMessageId).toMatch(/^mock-email-/);
      expect(emailMock.sentEmails).toHaveLength(1);
      expect(emailMock.sentEmails[0].to).toBe('customer@hospitality.ae');
    });

    it('handles simulated email provider failure and returns structured error', async () => {
      const provider = ProviderRegistry.getEmailProvider('mock');
      emailMock.shouldFail = true;
      emailMock.failureError = 'SMTP 421 Service Temporarily Unavailable';

      const result = await provider.sendEmail({
        to: 'fail@example.com',
        subject: 'Test',
        text: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('SMTP 421');
    });
  });

  describe('SMS Provider Abstraction', () => {
    it('successfully delivers transactional SMS and records message log', async () => {
      const provider = ProviderRegistry.getSmsProvider('mock');

      const result = await provider.sendSms({
        to: '+971501234567',
        message: 'Your service appointment WO-1025 has been scheduled.',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('delivered');
      expect(result.providerMessageId).toMatch(/^mock-sms-/);
      expect(smsMock.sentSms).toHaveLength(1);
      expect(smsMock.sentSms[0].to).toBe('+971501234567');
    });

    it('handles simulated SMS provider failure', async () => {
      const provider = ProviderRegistry.getSmsProvider('mock');
      smsMock.shouldFail = true;
      smsMock.failureError = 'Twilio 21211 Invalid ' + 'phone number format';

      const result = await provider.sendSms({
        to: 'invalid-number',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Invalid phone number');
    });
  });

  describe('WhatsApp Provider Abstraction', () => {
    it('successfully dispatches WhatsApp message through provider interface', async () => {
      const provider = ProviderRegistry.getWhatsAppProvider('mock');

      const result = await provider.sendWhatsApp({
        to: '+971509988776',
        message: 'Hello! Your technician Tariq has arrived at your site.',
        templateId: 'tpl_technician_arrived',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('delivered');
      expect(result.providerMessageId).toMatch(/^mock-wa-/);
      expect(waMock.sentWhatsApp).toHaveLength(1);
    });

    it('handles simulated WhatsApp provider failure', async () => {
      const provider = ProviderRegistry.getWhatsAppProvider('mock');
      waMock.shouldFail = true;
      waMock.failureError = 'Meta Cloud API 131051 Template does not exist';

      const result = await provider.sendWhatsApp({
        to: '+971509988776',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Template does not exist');
    });
  });

  describe('Manual Communication Schema Validation', () => {
    it('validates manual communication payload with valid channel and message', () => {
      const valid = validateManualCommunication({
        companyId: DEMO_COMPANY_A,
        recipientContact: 'facility.manager@burjkhalifa.ae',
        recipientType: 'customer',
        channel: 'email',
        subject: 'Maintenance Follow-up',
        message: 'Technician has completed the chiller quarterly overhaul.',
        entityType: 'work_order',
        entityId: 'wo-888',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.recipientContact).toBe('facility.manager@burjkhalifa.ae');
      expect(valid.channel).toBe('email');
      expect(valid.message).toContain('chiller quarterly overhaul');
    });

    it('rejects manual communication missing recipient or body', () => {
      expect(() =>
        validateManualCommunication({
          companyId: DEMO_COMPANY_A,
          channel: 'sms',
          message: 'Hello',
        })
      ).toThrow(/recipientContact is required/i);

      expect(() =>
        validateManualCommunication({
          companyId: DEMO_COMPANY_A,
          recipientContact: '+971500000000',
          channel: 'sms',
          message: '   ',
        })
      ).toThrow(/message body is required/i);
    });
  });
});

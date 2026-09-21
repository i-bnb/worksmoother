/**
 * =============================================================================
 * Test Suite 2: Template Engine, Variable Extraction & Safe Interpolation
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { TemplateEngineService } from '../../src/services/template-engine.service.js';
import {
  validateMessageTemplateCreate,
  validateMessageTemplateUpdate,
} from '../../src/schemas/message-template.schema.js';

describe('Phase 8: Template Engine & Variable Interpolation', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('message_templates').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Variable Extraction & Rendering Engine', () => {
    it('extracts all unique variable names from template text', () => {
      const template =
        'Hello {{technician_name}}, Work Order {{work_order_number}} for customer {{customer_name}} is assigned. Please contact {{customer_name}}.';

      const vars = TemplateEngineService.extractVariables(template);

      expect(vars).toHaveLength(3);
      expect(vars).toContain('technician_name');
      expect(vars).toContain('work_order_number');
      expect(vars).toContain('customer_name');
    });

    it('returns empty array when template has no variables', () => {
      const vars = TemplateEngineService.extractVariables('Standard static alert message without variables.');
      expect(vars).toEqual([]);
    });

    it('safely interpolates provided context variables into rendered text', () => {
      const template =
        'Dear {{customer_name}},\nYour invoice {{invoice_number}} for {{invoice_amount}} is due on {{payment_due_date}}.';

      const context = {
        customer_name: 'Emaar Hospitality Group',
        invoice_number: 'INV-2026-0044',
        invoice_amount: 'AED 12,500.00',
        payment_due_date: '2026-04-15',
      };

      const result = TemplateEngineService.render(template, context);

      expect(result.isValid).toBe(true);
      expect(result.missingVariables).toHaveLength(0);
      expect(result.rendered).toContain('Dear Emaar Hospitality Group,');
      expect(result.rendered).toContain('invoice INV-2026-0044');
      expect(result.rendered).toContain('AED 12,500.00');
      expect(result.rendered).toContain('due on 2026-04-15.');
    });

    it('identifies unpopulated or missing required variables', () => {
      const template = 'Hello {{technician_name}}, please service asset {{asset_name}} at site {{site_name}}.';

      // asset_name is missing
      const context = {
        technician_name: 'Tariq Al-Mansoor',
        site_name: 'Dubai Marina Mall',
      };

      const result = TemplateEngineService.render(template, context, ['technician_name', 'asset_name']);

      expect(result.isValid).toBe(false);
      expect(result.missingVariables).toContain('asset_name');
      expect(result.rendered).toContain('Hello Tariq Al-Mansoor, please service asset  at site Dubai Marina Mall.');
    });

    it('treats script tags or malicious payload as literal text without code execution', () => {
      const template = 'Customer remarks: {{user_input}}';
      const maliciousPayload = '<script>alert("XSS")</script>';

      const result = TemplateEngineService.render(template, { user_input: maliciousPayload });

      expect(result.isValid).toBe(true);
      expect(result.rendered).toBe('Customer remarks: <script>alert("XSS")</script>');
    });

    it('handles null, undefined, or empty template string safely', () => {
      expect(TemplateEngineService.render('', {}).rendered).toBe('');
      expect(TemplateEngineService.render(null as any, {}).rendered).toBe('');
    });

    it('includes all standard default ERP templates in registry', () => {
      const templates = TemplateEngineService.DEFAULT_TEMPLATES;
      expect(templates.length).toBeGreaterThanOrEqual(6);

      const woAssigned = templates.find((t) => t.eventType === 'WORK_ORDER_ASSIGNED');
      expect(woAssigned).toBeDefined();
      expect(woAssigned?.variables).toContain('technician_name');

      const slaBreached = templates.find((t) => t.eventType === 'SLA_BREACHED');
      expect(slaBreached).toBeDefined();
      expect(slaBreached?.variables).toContain('work_order_number');
    });
  });

  describe('Message Template DTO Validation', () => {
    it('validates template creation schema', () => {
      const valid = validateMessageTemplateCreate({
        companyId: DEMO_COMPANY_A,
        name: 'Technician Emergency Dispatch Alert',
        channel: 'whatsapp',
        eventType: 'WORK_ORDER_DISPATCHED',
        body: 'Urgent: Dispatch confirmed for Work Order {{work_order_number}}.',
        language: 'en',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.name).toBe('Technician Emergency Dispatch Alert');
      expect(valid.channel).toBe('whatsapp');
      expect(valid.eventType).toBe('WORK_ORDER_DISPATCHED');
    });

    it('rejects template creation missing name or body', () => {
      expect(() =>
        validateMessageTemplateCreate({
          companyId: DEMO_COMPANY_A,
          channel: 'email',
          body: 'Hello',
        })
      ).toThrow(/name is required/i);

      expect(() =>
        validateMessageTemplateCreate({
          companyId: DEMO_COMPANY_A,
          name: 'Test',
          channel: 'email',
          body: '',
        })
      ).toThrow(/template body is required/i);
    });

    it('validates template update schema', () => {
      const valid = validateMessageTemplateUpdate({
        subject: 'Updated Notification Subject',
        body: 'Updated body with {{new_variable}}',
      });

      expect(valid.subject).toBe('Updated Notification Subject');
      expect(valid.body).toContain('{{new_variable}}');
    });
  });

  describe('Database Integration', () => {
    it('creates message template in database if live DB is available', async () => {
      if (!isLiveDb) return;

      const template = await TemplateEngineService.createTemplate(admin, {
        companyId: DEMO_COMPANY_A,
        name: `Test Template ${Date.now()}`,
        channel: 'email',
        eventType: 'INVOICE_CREATED',
        subject: 'Invoice Ready',
        body: 'Dear {{customer_name}}, invoice {{invoice_number}} is ready.',
      });

      expect(template.id).toBeDefined();
      expect(template.variables).toContain('customer_name');
    });
  });
});

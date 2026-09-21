import { SupabaseClient } from '@supabase/supabase-js';
import {
  MessageTemplateCreateDto,
  MessageTemplateUpdateDto,
} from '../schemas/message-template.schema.js';

export interface TemplateRenderResult {
  rendered: string;
  missingVariables: string[];
  isValid: boolean;
}

export class TemplateEngineService {
  private static readonly VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  /**
   * Pure variable extractor from template string.
   */
  static extractVariables(templateText: string): string[] {
    if (!templateText) return [];
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    const regex = new RegExp(this.VARIABLE_REGEX.source, 'g');
    while ((match = regex.exec(templateText)) !== null) {
      matches.add(match[1]);
    }
    return Array.from(matches);
  }

  /**
   * Pure safe variable interpolation engine.
   * Does NOT use eval or arbitrary code execution.
   */
  static render(
    templateText: string,
    context: Record<string, any> = {},
    requiredVars?: string[]
  ): TemplateRenderResult {
    if (!templateText) {
      return { rendered: '', missingVariables: [], isValid: true };
    }

    const missingVariables: string[] = [];
    const extracted = this.extractVariables(templateText);

    // Check required variables
    if (requiredVars && requiredVars.length > 0) {
      for (const req of requiredVars) {
        if (context[req] === undefined || context[req] === null || context[req] === '') {
          missingVariables.push(req);
        }
      }
    }

    // Replace variables safely
    const rendered = templateText.replace(this.VARIABLE_REGEX, (_match, varName) => {
      const val = context[varName];
      if (val === undefined || val === null) {
        // Track unpopulated variable
        if (!missingVariables.includes(varName)) {
          missingVariables.push(varName);
        }
        return '';
      }
      // Sanitize string representation
      return String(val);
    });

    return {
      rendered,
      missingVariables,
      isValid: missingVariables.length === 0,
    };
  }

  /**
   * Pre-seeded default ERP templates.
   */
  static readonly DEFAULT_TEMPLATES = [
    {
      name: 'Work Order Assigned (Technician)',
      eventType: 'WORK_ORDER_ASSIGNED',
      channel: 'in_app',
      subject: 'New Service Assignment: {{work_order_number}}',
      body: 'Hello {{technician_name}},\n\nWork Order {{work_order_number}} has been assigned to you.\n\nCustomer: {{customer_name}}\nService: {{service_type}}\nScheduled: {{appointment_time}}\n\nPlease review the work order.',
      variables: ['technician_name', 'work_order_number', 'customer_name', 'service_type', 'appointment_time'],
    },
    {
      name: 'Service Appointment Scheduled (Customer)',
      eventType: 'WORK_ORDER_SCHEDULED',
      channel: 'email',
      subject: 'Service Appointment Confirmed - {{work_order_number}}',
      body: 'Dear {{customer_name}},\n\nYour service appointment for {{service_type}} has been scheduled on {{appointment_date}} at {{appointment_time}}.\n\nTechnician: {{technician_name}}.\n\nThank you for choosing us.',
      variables: ['customer_name', 'service_type', 'appointment_date', 'appointment_time', 'technician_name'],
    },
    {
      name: 'Invoice Created (Customer)',
      eventType: 'INVOICE_CREATED',
      channel: 'email',
      subject: 'New Invoice Issued: {{invoice_number}}',
      body: 'Dear {{customer_name}},\n\nInvoice {{invoice_number}} for {{invoice_amount}} has been issued with payment due on {{payment_due_date}}.\n\nPlease find your invoice details attached.',
      variables: ['customer_name', 'invoice_number', 'invoice_amount', 'payment_due_date'],
    },
    {
      name: 'Payment Received (Customer)',
      eventType: 'PAYMENT_RECEIVED',
      channel: 'email',
      subject: 'Payment Confirmation: {{invoice_number}}',
      body: 'Dear {{customer_name}},\n\nWe have successfully received your payment of {{payment_amount}} for Invoice {{invoice_number}}.\n\nThank you for your business!',
      variables: ['customer_name', 'payment_amount', 'invoice_number'],
    },
    {
      name: 'AMC Contract Expiring Alert',
      eventType: 'AMC_EXPIRING',
      channel: 'in_app',
      subject: 'AMC Contract {{contract_number}} Expiring Soon',
      body: 'Contract {{contract_number}} for {{customer_name}} is expiring on {{expiry_date}}. Please initiate renewal follow-up.',
      variables: ['contract_number', 'customer_name', 'expiry_date'],
    },
    {
      name: 'SLA Resolution Breached Alert',
      eventType: 'SLA_BREACHED',
      channel: 'in_app',
      subject: 'URGENT SLA BREACH: {{work_order_number}}',
      body: 'ALERT: Work Order {{work_order_number}} has exceeded its SLA resolution deadline {{sla_deadline}}. Priority: {{priority}}.\nCustomer: {{customer_name}}.',
      variables: ['work_order_number', 'sla_deadline', 'priority', 'customer_name'],
    },
  ];

  /**
   * Creates a message template in the database.
   */
  static async createTemplate(client: SupabaseClient, dto: MessageTemplateCreateDto) {
    const extracted = this.extractVariables(dto.body);
    const combinedVars = Array.from(new Set([...extracted, ...(dto.variables || [])]));

    const { data, error } = await client
      .from('message_templates')
      .insert({
        company_id: dto.companyId,
        name: dto.name,
        channel: dto.channel,
        event_type: dto.eventType || null,
        subject: dto.subject || null,
        body: dto.body,
        variables: combinedVars,
        language: dto.language || 'en',
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        created_by: dto.userId || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create message template: ${error.message}`);
    return data;
  }

  /**
   * Retrieves a template by ID.
   */
  static async getTemplate(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('message_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch message template: ${error.message}`);
    return data;
  }

  /**
   * Updates a template.
   */
  static async updateTemplate(client: SupabaseClient, id: string, dto: MessageTemplateUpdateDto) {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.subject !== undefined) updates.subject = dto.subject;
    if (dto.body !== undefined) {
      updates.body = dto.body;
      updates.variables = Array.from(new Set([...this.extractVariables(dto.body), ...(dto.variables || [])]));
    }
    if (dto.language !== undefined) updates.language = dto.language;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.userId) updates.updated_by = dto.userId;

    const { data, error } = await client
      .from('message_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update message template: ${error.message}`);
    return data;
  }

  /**
   * Lists templates for a company.
   */
  static async listTemplates(client: SupabaseClient, companyId: string, channel?: string) {
    let query = client
      .from('message_templates')
      .select('*')
      .eq('company_id', companyId);

    if (channel) query = query.eq('channel', channel);

    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw new Error(`Failed to list message templates: ${error.message}`);
    return data;
  }
}

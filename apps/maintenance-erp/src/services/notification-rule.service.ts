import { SupabaseClient } from '@supabase/supabase-js';
import {
  NotificationRuleCreateDto,
  NotificationRuleUpdateDto,
  RecipientType,
} from '../schemas/notification-rule.schema.js';
import { NotificationChannel } from '../schemas/notification.schema.js';
import { ErpEventType } from '../schemas/domain-event.schema.js';

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: any;
}

export interface NotificationRuleRecord {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  event_type: ErpEventType;
  recipient_type: RecipientType;
  recipient_role?: string | null;
  channel: NotificationChannel;
  template_id?: string | null;
  conditions: RuleCondition[];
  is_active: boolean;
  priority: number;
}

export class NotificationRuleService {
  /**
   * Pure evaluation of a single condition against a payload.
   */
  static evaluateCondition(actual: any, operator: string, expected: any): boolean {
    if (actual === undefined || actual === null) {
      return operator === 'neq' ? actual !== expected : false;
    }

    switch (operator) {
      case 'eq':
        return actual === expected || String(actual) === String(expected);
      case 'neq':
        return actual !== expected && String(actual) !== String(expected);
      case 'gt':
        return Number(actual) > Number(expected);
      case 'gte':
        return Number(actual) >= Number(expected);
      case 'lt':
        return Number(actual) < Number(expected);
      case 'lte':
        return Number(actual) <= Number(expected);
      case 'contains':
        return String(actual).toLowerCase().includes(String(expected).toLowerCase());
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      default:
        return false;
    }
  }

  /**
   * Pure evaluation: returns true if all rule conditions match the payload.
   */
  static matchesConditions(conditions: RuleCondition[] = [], payload: Record<string, any> = {}): boolean {
    if (!conditions || conditions.length === 0) return true;

    for (const cond of conditions) {
      const actualVal = payload[cond.field];
      if (!this.evaluateCondition(actualVal, cond.operator, cond.value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Pure rule matcher: filters list of rules matching an event type and conditions.
   */
  static filterMatchingRules(
    rules: NotificationRuleRecord[],
    eventType: ErpEventType,
    payload: Record<string, any> = {}
  ): NotificationRuleRecord[] {
    return rules
      .filter((r) => r.is_active && r.event_type === eventType)
      .filter((r) => this.matchesConditions(r.conditions, payload))
      .sort((a, b) => (b.priority || 10) - (a.priority || 10));
  }

  /**
   * Creates a notification rule in the database.
   */
  static async createRule(client: SupabaseClient, dto: NotificationRuleCreateDto) {
    const { data, error } = await client
      .from('notification_rules')
      .insert({
        company_id: dto.companyId,
        name: dto.name,
        description: dto.description || null,
        event_type: dto.eventType,
        recipient_type: dto.recipientType,
        recipient_role: dto.recipientRole || null,
        channel: dto.channel,
        template_id: dto.templateId || null,
        conditions: dto.conditions || [],
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        priority: dto.priority || 10,
      })
      .select('*, template:message_templates(id, name, subject, body, variables)')
      .single();

    if (error) throw new Error(`Failed to create notification rule: ${error.message}`);
    return data;
  }

  /**
   * Updates an existing notification rule.
   */
  static async updateRule(client: SupabaseClient, id: string, dto: NotificationRuleUpdateDto) {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.recipientType !== undefined) updates.recipient_type = dto.recipientType;
    if (dto.recipientRole !== undefined) updates.recipient_role = dto.recipientRole;
    if (dto.channel !== undefined) updates.channel = dto.channel;
    if (dto.templateId !== undefined) updates.template_id = dto.templateId;
    if (dto.conditions !== undefined) updates.conditions = dto.conditions;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.priority !== undefined) updates.priority = dto.priority;

    const { data, error } = await client
      .from('notification_rules')
      .update(updates)
      .eq('id', id)
      .select('*, template:message_templates(id, name, subject, body, variables)')
      .single();

    if (error) throw new Error(`Failed to update notification rule: ${error.message}`);
    return data;
  }

  /**
   * Lists active notification rules for a company.
   */
  static async listRules(client: SupabaseClient, companyId: string, eventType?: string) {
    let query = client
      .from('notification_rules')
      .select('*, template:message_templates(id, name, subject, body, variables)')
      .eq('company_id', companyId);

    if (eventType) query = query.eq('event_type', eventType);

    const { data, error } = await query.order('priority', { ascending: false });
    if (error) throw new Error(`Failed to list notification rules: ${error.message}`);
    return data || [];
  }
}

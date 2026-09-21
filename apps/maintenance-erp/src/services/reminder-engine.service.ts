import { SupabaseClient } from '@supabase/supabase-js';
import { ReminderRuleCreateDto } from '../schemas/notification-rule.schema.js';
import { EventDispatcherService } from './event-dispatcher.service.js';

export class ReminderEngineService {
  /**
   * Pure reminder timestamp calculator.
   * targetTime + (offsetMinutes * 60 * 1000)
   */
  static calculateReminderTime(targetTimeIso: string, offsetMinutes: number): string {
    const targetMs = new Date(targetTimeIso).getTime();
    if (isNaN(targetMs)) return targetTimeIso;
    const reminderMs = targetMs + offsetMinutes * 60 * 1000;
    return new Date(reminderMs).toISOString();
  }

  /**
   * Creates a reminder rule.
   */
  static async createReminderRule(client: SupabaseClient, dto: ReminderRuleCreateDto) {
    const { data, error } = await client
      .from('reminder_rules')
      .insert({
        company_id: dto.companyId,
        name: dto.name,
        entity_type: dto.entityType,
        offset_minutes: dto.offsetMinutes,
        channel: dto.channel,
        template_id: dto.templateId || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create reminder rule: ${error.message}`);
    return data;
  }

  /**
   * Lists reminder rules for a company.
   */
  static async listReminderRules(client: SupabaseClient, companyId: string, entityType?: string) {
    let query = client
      .from('reminder_rules')
      .select('*')
      .eq('company_id', companyId);

    if (entityType) query = query.eq('entity_type', entityType);

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to list reminder rules: ${error.message}`);
    return data || [];
  }

  /**
   * Scans upcoming entities and idempotently schedules reminders in `reminder_schedules`.
   */
  static async scanAndScheduleReminders(client: SupabaseClient, companyId: string) {
    const rules = await this.listReminderRules(client, companyId);
    const activeRules = (rules || []).filter((r) => r.is_active);

    let scheduledCount = 0;

    for (const rule of activeRules) {
      if (rule.entity_type === 'service_appointment') {
        // Find appointments in the future
        const nowIso = new Date().toISOString();
        const { data: appointments } = await client
          .from('service_appointments')
          .select('id, start_time')
          .eq('company_id', companyId)
          .gt('start_time', nowIso)
          .not('status', 'in', '("cancelled","completed","rescheduled")')
          .limit(100);

        for (const appt of appointments || []) {
          const reminderTime = this.calculateReminderTime(appt.start_time, rule.offset_minutes);

          const { error: insErr } = await client
            .from('reminder_schedules')
            .upsert(
              {
                company_id: companyId,
                reminder_rule_id: rule.id,
                entity_type: 'service_appointment',
                entity_id: appt.id,
                scheduled_for: reminderTime,
                status: 'scheduled',
              },
              { onConflict: 'reminder_rule_id, entity_id, scheduled_for', ignoreDuplicates: true }
            );

          if (!insErr) scheduledCount++;
        }
      } else if (rule.entity_type === 'amc_contract') {
        const { data: amcs } = await client
          .from('contracts')
          .select('id, end_date')
          .eq('company_id', companyId)
          .eq('status', 'active')
          .limit(100);

        for (const amc of amcs || []) {
          if (!amc.end_date) continue;
          const endIso = `${amc.end_date}T09:00:00.000Z`;
          const reminderTime = this.calculateReminderTime(endIso, rule.offset_minutes);

          const { error: insErr } = await client
            .from('reminder_schedules')
            .upsert(
              {
                company_id: companyId,
                reminder_rule_id: rule.id,
                entity_type: 'amc_contract',
                entity_id: amc.id,
                scheduled_for: reminderTime,
                status: 'scheduled',
              },
              { onConflict: 'reminder_rule_id, entity_id, scheduled_for', ignoreDuplicates: true }
            );

          if (!insErr) scheduledCount++;
        }
      }
    }

    return { scheduledCount };
  }

  /**
   * Fires all reminder schedules that have reached or passed their scheduled_for timestamp.
   */
  static async fireDueReminders(client: SupabaseClient, companyId: string) {
    const nowIso = new Date().toISOString();

    const { data: dueSchedules, error } = await client
      .from('reminder_schedules')
      .select('*, rule:reminder_rules(name, entity_type, channel, template_id)')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .lte('scheduled_for', nowIso)
      .limit(50);

    if (error) throw new Error(`Failed to fetch due reminders: ${error.message}`);

    const firedCount = (dueSchedules || []).length;

    for (const item of dueSchedules || []) {
      // Map entity type to domain event
      let eventType: any = 'WORK_ORDER_SCHEDULED';
      if (item.entity_type === 'amc_contract') eventType = 'AMC_EXPIRING';
      else if (item.entity_type === 'invoice') eventType = 'INVOICE_OVERDUE';
      else if (item.entity_type === 'rental_contract') eventType = 'RENTAL_OVERDUE';

      // Publish domain event
      await EventDispatcherService.publishEvent(client, {
        companyId,
        eventType,
        entityType: item.entity_type,
        entityId: item.entity_id,
        payload: {
          reminder_id: item.id,
          reminder_name: item.rule?.name,
          scheduled_for: item.scheduled_for,
        },
      });

      // Mark reminder schedule sent
      await client
        .from('reminder_schedules')
        .update({
          status: 'sent',
          sent_at: nowIso,
        })
        .eq('id', item.id);
    }

    return { firedCount };
  }
}

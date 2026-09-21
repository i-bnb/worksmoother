import { SupabaseClient } from '@supabase/supabase-js';

export type SlaHealthStatus = 'on_track' | 'approaching' | 'at_risk' | 'breached';

export interface SlaEvaluationResult {
  status: SlaHealthStatus;
  isBreached: boolean;
  remainingMinutes: number;
  percentageElapsed: number;
}

export class SlaMonitoringService {
  /**
   * Pure SLA health evaluator based on timestamps.
   */
  static evaluateSlaStatus(
    createdAtIso: string,
    deadlineIso: string,
    nowIso?: string
  ): SlaEvaluationResult {
    const created = new Date(createdAtIso).getTime();
    const deadline = new Date(deadlineIso).getTime();
    const now = nowIso ? new Date(nowIso).getTime() : Date.now();

    if (isNaN(created) || isNaN(deadline)) {
      return { status: 'on_track', isBreached: false, remainingMinutes: 0, percentageElapsed: 0 };
    }

    const totalDuration = Math.max(1, deadline - created);
    const elapsed = Math.max(0, now - created);
    const remaining = deadline - now;
    const remainingMinutes = Math.round(remaining / (60 * 1000));
    const percentageElapsed = Math.min(100, Math.round((elapsed / totalDuration) * 100));

    if (remaining <= 0) {
      return {
        status: 'breached',
        isBreached: true,
        remainingMinutes,
        percentageElapsed: 100,
      };
    }

    // At risk: > 85% elapsed or < 2 hours remaining
    if (percentageElapsed >= 85 || remainingMinutes <= 120) {
      return {
        status: 'at_risk',
        isBreached: false,
        remainingMinutes,
        percentageElapsed,
      };
    }

    // Approaching: > 70% elapsed or < 4 hours remaining
    if (percentageElapsed >= 70 || remainingMinutes <= 240) {
      return {
        status: 'approaching',
        isBreached: false,
        remainingMinutes,
        percentageElapsed,
      };
    }

    return {
      status: 'on_track',
      isBreached: false,
      remainingMinutes,
      percentageElapsed,
    };
  }

  /**
   * Fetches work orders with SLA deadlines approaching or at risk.
   */
  static async getSlaAtRiskWorkOrders(client: SupabaseClient, companyId: string) {
    const nowIso = new Date().toISOString();

    const { data: orders, error } = await client
      .from('work_orders')
      .select('id, work_order_number, description, priority, status, created_at, due_at, customer:customers(name)')
      .eq('company_id', companyId)
      .not('status', 'in', '("completed","closed","cancelled")')
      .not('due_at', 'is', null)
      .gt('due_at', nowIso)
      .order('due_at', { ascending: true });

    if (error) throw new Error(`Failed to list work orders for SLA check: ${error.message}`);

    const atRiskList = (orders || [])
      .map((o: any) => {
        const evalRes = this.evaluateSlaStatus(o.created_at, o.due_at, nowIso);
        return {
          ...o,
          slaStatus: evalRes.status,
          remainingMinutes: evalRes.remainingMinutes,
          percentageElapsed: evalRes.percentageElapsed,
        };
      })
      .filter((o) => ['approaching', 'at_risk'].includes(o.slaStatus));

    return atRiskList;
  }

  /**
   * Fetches work orders whose SLA deadline is already breached.
   */
  static async getSlaBreachedWorkOrders(client: SupabaseClient, companyId: string) {
    const nowIso = new Date().toISOString();

    const { data: orders, error } = await client
      .from('work_orders')
      .select('id, work_order_number, description, priority, status, created_at, due_at, customer:customers(name)')
      .eq('company_id', companyId)
      .not('status', 'in', '("completed","closed","cancelled")')
      .not('due_at', 'is', null)
      .lt('due_at', nowIso)
      .order('due_at', { ascending: true });

    if (error) throw new Error(`Failed to list breached work orders: ${error.message}`);

    return (orders || []).map((o: any) => ({
      ...o,
      slaStatus: 'breached',
      remainingMinutes: Math.round((new Date(o.due_at).getTime() - new Date(nowIso).getTime()) / (60 * 1000)),
    }));
  }
}

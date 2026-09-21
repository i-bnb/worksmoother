/**
 * =============================================================================
 * Customer Portal Dashboard & Summary Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerDashboardSummary {
  activeAssetsCount: number;
  openRequestsCount: number;
  inProgressWorkOrdersCount: number;
  pendingQuotationsCount: number;
  unpaidInvoicesCount: number;
  totalOutstandingAmount: number;
  activeAmcContractsCount: number;
  activeRentalsCount: number;
  recentActivity: Array<{
    id: string;
    type: 'service_request' | 'work_order' | 'quotation' | 'invoice' | 'appointment';
    title: string;
    status: string;
    timestamp: string;
    referenceNumber?: string;
  }>;
}

export class CustomerDashboardService {
  /**
   * Aggregates key customer metrics and recent activity for the portal dashboard.
   */
  static async getDashboardSummary(
    client: SupabaseClient,
    customerId: string
  ): Promise<CustomerDashboardSummary> {
    if (!customerId) {
      throw new Error('customerId is required to fetch portal dashboard');
    }

    // 1. Assets count
    const { count: activeAssetsCount } = await client
      .from('customer_assets')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('status', 'active');

    // 2. Open service requests
    const { count: openRequestsCount } = await client
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['new', 'triaged']);

    // 3. In-progress work orders
    const { count: inProgressWorkOrdersCount } = await client
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['scheduled', 'dispatched', 'in_progress']);

    // 4. Pending quotations (sent to client awaiting acceptance)
    const { count: pendingQuotationsCount } = await client
      .from('quotations')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('status', 'sent');

    // 5. Invoices unpaid or overdue
    const { data: unpaidInvoices } = await client
      .from('invoices')
      .select('id, amount_due, status')
      .eq('customer_id', customerId)
      .in('status', ['issued', 'partially_paid', 'overdue']);

    const unpaidCount = unpaidInvoices?.length || 0;
    const totalOutstanding = (unpaidInvoices || []).reduce(
      (sum, inv) => sum + (Number(inv.amount_due) || 0),
      0
    );

    // 6. Active AMC contracts
    let activeAmcCount = 0;
    try {
      const { count } = await client
        .from('amc_contracts')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .eq('status', 'active');
      activeAmcCount = count || 0;
    } catch {
      activeAmcCount = 0;
    }

    // 7. Active rentals
    let activeRentalsCount = 0;
    try {
      const { count } = await client
        .from('rental_contracts')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .in('status', ['active', 'dispatched']);
      activeRentalsCount = count || 0;
    } catch {
      activeRentalsCount = 0;
    }

    // 8. Recent activity
    const recentActivity: CustomerDashboardSummary['recentActivity'] = [];

    // Recent service requests
    const { data: recentRequests } = await client
      .from('service_requests')
      .select('id, request_number, description, status, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentRequests) {
      for (const r of recentRequests) {
        recentActivity.push({
          id: r.id,
          type: 'service_request',
          title: r.description ? (r.description.length > 50 ? `${r.description.substring(0, 47)}...` : r.description) : 'Service Request',
          status: r.status,
          timestamp: r.created_at,
          referenceNumber: r.request_number,
        });
      }
    }

    // Recent work orders
    const { data: recentWo } = await client
      .from('work_orders')
      .select('id, work_order_number, description, status, updated_at')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (recentWo) {
      for (const w of recentWo) {
        recentActivity.push({
          id: w.id,
          type: 'work_order',
          title: w.description ? (w.description.length > 50 ? `${w.description.substring(0, 47)}...` : w.description) : 'Work Order',
          status: w.status,
          timestamp: w.updated_at,
          referenceNumber: w.work_order_number,
        });
      }
    }

    // Sort combined activity descending
    recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      activeAssetsCount: activeAssetsCount || 0,
      openRequestsCount: openRequestsCount || 0,
      inProgressWorkOrdersCount: inProgressWorkOrdersCount || 0,
      pendingQuotationsCount: pendingQuotationsCount || 0,
      unpaidInvoicesCount: unpaidCount,
      totalOutstandingAmount: Math.round(totalOutstanding * 100) / 100,
      activeAmcContractsCount: activeAmcCount,
      activeRentalsCount: activeRentalsCount,
      recentActivity: recentActivity.slice(0, 10),
    };
  }
}

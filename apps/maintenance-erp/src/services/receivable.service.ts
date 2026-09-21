import { SupabaseClient } from '@supabase/supabase-js';

export class ReceivableService {
  /**
   * Retrieves live customer balance (total invoiced, total collected, net balance due).
   */
  static async getCustomerBalance(client: SupabaseClient, customerId: string) {
    const { data, error } = await client.rpc('get_customer_billing_summary', {
      p_customer_id: customerId,
    });

    if (error) throw new Error(`Failed to fetch customer balance: ${error.message}`);
    return data;
  }

  /**
   * Generates a complete chronological customer statement with opening balance, invoices, payments, credits, and closing balance.
   */
  static async getCustomerStatement(
    client: SupabaseClient,
    customerId: string,
    fromDate: string,
    toDate: string
  ) {
    const { data, error } = await client.rpc('get_customer_statement', {
      p_customer_id: customerId,
      p_from_date: fromDate,
      p_to_date: toDate,
    });

    if (error) throw new Error(`Customer statement generation failed: ${error.message}`);
    return data;
  }

  /**
   * Lists overdue open customer invoices.
   */
  static async getOverdueInvoices(client: SupabaseClient, companyId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await client
      .from('invoices')
      .select('*, customer:customers(id, name, code)')
      .eq('company_id', companyId)
      .in('status', ['issued', 'partially_paid'])
      .lt('due_date', today)
      .order('due_date', { ascending: true });

    if (error) throw new Error(`Failed to list overdue invoices: ${error.message}`);
    return data;
  }
}

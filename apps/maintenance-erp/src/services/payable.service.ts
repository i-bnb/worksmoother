import { SupabaseClient } from '@supabase/supabase-js';

export class PayableService {
  /**
   * Retrieves live outstanding balance for a supplier.
   */
  static async getSupplierBalance(client: SupabaseClient, supplierId: string) {
    const { data: bills, error: bErr } = await client
      .from('supplier_bills')
      .select('grand_total, amount_paid')
      .eq('supplier_id', supplierId)
      .neq('status', 'cancelled');

    if (bErr) throw new Error(`Failed to fetch supplier bills: ${bErr.message}`);

    let totalBilled = 0;
    let totalPaid = 0;
    for (const b of bills || []) {
      totalBilled += Number(b.grand_total || 0);
      totalPaid += Number(b.amount_paid || 0);
    }

    return {
      supplierId,
      totalBilled: parseFloat(totalBilled.toFixed(3)),
      totalPaid: parseFloat(totalPaid.toFixed(3)),
      outstandingBalance: parseFloat((totalBilled - totalPaid).toFixed(3)),
    };
  }

  /**
   * Generates a complete chronological supplier statement with opening balance, bills, disbursements, and closing balance.
   */
  static async getSupplierStatement(
    client: SupabaseClient,
    supplierId: string,
    fromDate: string,
    toDate: string
  ) {
    const { data, error } = await client.rpc('get_supplier_statement', {
      p_supplier_id: supplierId,
      p_from_date: fromDate,
      p_to_date: toDate,
    });

    if (error) throw new Error(`Supplier statement generation failed: ${error.message}`);
    return data;
  }

  /**
   * Lists overdue vendor bills.
   */
  static async getOverdueBills(client: SupabaseClient, companyId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await client
      .from('supplier_bills')
      .select('*, supplier:suppliers(id, name, code)')
      .eq('company_id', companyId)
      .in('status', ['approved', 'posted', 'partially_paid'])
      .lt('due_date', today)
      .order('due_date', { ascending: true });

    if (error) throw new Error(`Failed to list overdue supplier bills: ${error.message}`);
    return data;
  }
}

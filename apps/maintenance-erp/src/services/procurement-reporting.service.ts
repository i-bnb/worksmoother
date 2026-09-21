import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  SupplierAgingQueryDto,
  validateSupplierAgingQuery,
} from '../schemas/accounts-payable.schema.js';

export interface SupplierAgingBucket {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  currency: string;
  currentAmount: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface StatementTransaction {
  date: string;
  type: 'BILL' | 'PAYMENT' | 'ADVANCE';
  referenceNumber: string;
  description: string;
  debit: number; // Reduces payable (payments)
  credit: number; // Increases payable (bills)
  runningBalance: number;
}

export class ProcurementReportingService {
  /**
   * Calculates Accounts Payable aging breakdown across standard buckets.
   */
  static async getAgingAnalysis(
    client: SupabaseClient,
    rawQuery: SupplierAgingQueryDto
  ): Promise<{
    asOfDate: string;
    totalPayable: number;
    buckets: SupplierAgingBucket[];
    summary: {
      current: number;
      days1To30: number;
      days31To60: number;
      days61To90: number;
      days90Plus: number;
    };
  }> {
    const query = validateSupplierAgingQuery(rawQuery);
    const asOfDateStr = query.asOfDate || new Date().toISOString().split('T')[0];
    const asOfDate = new Date(asOfDateStr);

    // Try RPC first
    const { data: rpcData, error: rpcErr } = await client.rpc('get_supplier_aging', {
      p_company_id: query.companyId,
      p_as_of_date: asOfDateStr,
    });

    if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
      let sumCurrent = new Decimal(0);
      let sum1To30 = new Decimal(0);
      let sum31To60 = new Decimal(0);
      let sum61To90 = new Decimal(0);
      let sum90Plus = new Decimal(0);
      let sumTotal = new Decimal(0);

      const mapped: SupplierAgingBucket[] = rpcData.map((row: any) => {
        const cur = new Decimal(row.current_amount || 0);
        const d30 = new Decimal(row.days_1_30 || 0);
        const d60 = new Decimal(row.days_31_60 || 0);
        const d90 = new Decimal(row.days_61_90 || 0);
        const d90p = new Decimal(row.days_90_plus || 0);
        const tot = new Decimal(row.total_outstanding || 0);

        sumCurrent = sumCurrent.plus(cur);
        sum1To30 = sum1To30.plus(d30);
        sum31To60 = sum31To60.plus(d60);
        sum61To90 = sum61To90.plus(d90);
        sum90Plus = sum90Plus.plus(d90p);
        sumTotal = sumTotal.plus(tot);

        return {
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          supplierCode: row.supplier_code,
          currency: row.currency || 'AED',
          currentAmount: cur.toNumber(),
          days1To30: d30.toNumber(),
          days31To60: d60.toNumber(),
          days61To90: d90.toNumber(),
          days90Plus: d90p.toNumber(),
          totalOutstanding: tot.toNumber(),
        };
      });

      return {
        asOfDate: asOfDateStr,
        totalPayable: sumTotal.toNumber(),
        buckets: mapped,
        summary: {
          current: sumCurrent.toNumber(),
          days1To30: sum1To30.toNumber(),
          days31To60: sum31To60.toNumber(),
          days61To90: sum61To90.toNumber(),
          days90Plus: sum90Plus.toNumber(),
        },
      };
    }

    // Application-level aging calculation fallback
    let billsQuery = client
      .from('supplier_bills')
      .select('id, supplier_id, due_date, bill_date, grand_total, amount_paid, amount_due, currency, supplier:suppliers(id, name, code)')
      .eq('company_id', query.companyId)
      .in('status', ['approved', 'posted', 'partially_paid']);

    if (query.supplierId) {
      billsQuery = billsQuery.eq('supplier_id', query.supplierId);
    }

    const { data: bills, error: bErr } = await billsQuery;
    if (bErr) {
      throw new Error(`Failed to calculate AP aging: ${bErr.message}`);
    }

    const supplierMap = new Map<string, {
      supplierId: string;
      supplierName: string;
      supplierCode: string;
      currency: string;
      current: Decimal;
      d1To30: Decimal;
      d31To60: Decimal;
      d61To90: Decimal;
      d90Plus: Decimal;
      total: Decimal;
    }>();

    for (const b of bills || []) {
      const amountDue = new Decimal(b.amount_due !== undefined ? b.amount_due : (Number(b.grand_total) - Number(b.amount_paid)));
      if (amountDue.lessThanOrEqualTo(0)) continue;

      const sId = b.supplier_id;
      const sName = (b.supplier as any)?.name || 'Unknown';
      const sCode = (b.supplier as any)?.code || '';
      const curr = b.currency || 'AED';

      if (!supplierMap.has(sId)) {
        supplierMap.set(sId, {
          supplierId: sId,
          supplierName: sName,
          supplierCode: sCode,
          currency: curr,
          current: new Decimal(0),
          d1To30: new Decimal(0),
          d31To60: new Decimal(0),
          d61To90: new Decimal(0),
          d90Plus: new Decimal(0),
          total: new Decimal(0),
        });
      }

      const rec = supplierMap.get(sId)!;
      rec.total = rec.total.plus(amountDue);

      const dueDate = b.due_date ? new Date(b.due_date) : asOfDate;
      const diffMs = asOfDate.getTime() - dueDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        rec.current = rec.current.plus(amountDue);
      } else if (diffDays <= 30) {
        rec.d1To30 = rec.d1To30.plus(amountDue);
      } else if (diffDays <= 60) {
        rec.d31To60 = rec.d31To60.plus(amountDue);
      } else if (diffDays <= 90) {
        rec.d61To90 = rec.d61To90.plus(amountDue);
      } else {
        rec.d90Plus = rec.d90Plus.plus(amountDue);
      }
    }

    const buckets: SupplierAgingBucket[] = [];
    let sumCurrent = new Decimal(0);
    let sum1To30 = new Decimal(0);
    let sum31To60 = new Decimal(0);
    let sum61To90 = new Decimal(0);
    let sum90Plus = new Decimal(0);
    let sumTotal = new Decimal(0);

    for (const item of supplierMap.values()) {
      sumCurrent = sumCurrent.plus(item.current);
      sum1To30 = sum1To30.plus(item.d1To30);
      sum31To60 = sum31To60.plus(item.d31To60);
      sum61To90 = sum61To90.plus(item.d61To90);
      sum90Plus = sum90Plus.plus(item.d90Plus);
      sumTotal = sumTotal.plus(item.total);

      buckets.push({
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        supplierCode: item.supplierCode,
        currency: item.currency,
        currentAmount: item.current.toNumber(),
        days1To30: item.d1To30.toNumber(),
        days31To60: item.d31To60.toNumber(),
        days61To90: item.d61To90.toNumber(),
        days90Plus: item.d90Plus.toNumber(),
        totalOutstanding: item.total.toNumber(),
      });
    }

    return {
      asOfDate: asOfDateStr,
      totalPayable: sumTotal.toNumber(),
      buckets,
      summary: {
        current: sumCurrent.toNumber(),
        days1To30: sum1To30.toNumber(),
        days31To60: sum31To60.toNumber(),
        days61To90: sum61To90.toNumber(),
        days90Plus: sum90Plus.toNumber(),
      },
    };
  }

  /**
   * Generates a comprehensive statement of accounts for a supplier over a date range.
   */
  static async getSupplierStatement(
    client: SupabaseClient,
    supplierId: string,
    fromDate: string,
    toDate: string
  ): Promise<{
    supplierId: string;
    supplierName: string;
    fromDate: string;
    toDate: string;
    openingBalance: number;
    totalBilled: number;
    totalPaid: number;
    closingBalance: number;
    transactions: StatementTransaction[];
  }> {
    // 1. Fetch supplier info
    const { data: supplier, error: sErr } = await client
      .from('suppliers')
      .select('id, name, code, currency')
      .eq('id', supplierId)
      .single();

    if (sErr || !supplier) {
      throw new Error(`Supplier not found: ${sErr?.message || supplierId}`);
    }

    // 2. Calculate Opening Balance prior to fromDate
    const { data: priorBills } = await client
      .from('supplier_bills')
      .select('grand_total')
      .eq('supplier_id', supplierId)
      .lt('bill_date', fromDate)
      .neq('status', 'cancelled');

    const { data: priorPayments } = await client
      .from('supplier_payments')
      .select('amount')
      .eq('supplier_id', supplierId)
      .lt('payment_date', fromDate)
      .is('reversed_at', null);

    const priorBilled = (priorBills || []).reduce(
      (acc: Decimal, b: any) => acc.plus(new Decimal(b.grand_total || 0)),
      new Decimal(0)
    );
    const priorPaid = (priorPayments || []).reduce(
      (acc: Decimal, p: any) => acc.plus(new Decimal(p.amount || 0)),
      new Decimal(0)
    );

    const openingBalanceDec = priorBilled.minus(priorPaid);

    // 3. Fetch period bills & payments
    const { data: periodBills } = await client
      .from('supplier_bills')
      .select('id, bill_number, bill_date, grand_total, notes')
      .eq('supplier_id', supplierId)
      .gte('bill_date', fromDate)
      .lte('bill_date', toDate)
      .neq('status', 'cancelled')
      .order('bill_date', { ascending: true });

    const { data: periodPayments } = await client
      .from('supplier_payments')
      .select('id, payment_number, payment_date, amount, payment_type, notes')
      .eq('supplier_id', supplierId)
      .gte('payment_date', fromDate)
      .lte('payment_date', toDate)
      .is('reversed_at', null)
      .order('payment_date', { ascending: true });

    // 4. Merge and sort chronologically
    const allItems: Array<{
      date: string;
      type: 'BILL' | 'PAYMENT' | 'ADVANCE';
      ref: string;
      desc: string;
      debit: Decimal;
      credit: Decimal;
    }> = [];

    for (const b of periodBills || []) {
      allItems.push({
        date: b.bill_date,
        type: 'BILL',
        ref: b.bill_number || b.id,
        desc: b.notes || 'Supplier Bill',
        debit: new Decimal(0),
        credit: new Decimal(b.grand_total || 0),
      });
    }

    for (const p of periodPayments || []) {
      allItems.push({
        date: p.payment_date,
        type: p.payment_type === 'advance' ? 'ADVANCE' : 'PAYMENT',
        ref: p.payment_number || p.id,
        desc: p.notes || (p.payment_type === 'advance' ? 'Advance Payment' : 'Supplier Payment'),
        debit: new Decimal(p.amount || 0),
        credit: new Decimal(0),
      });
    }

    allItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = openingBalanceDec;
    let periodBilled = new Decimal(0);
    let periodPaid = new Decimal(0);
    const transactions: StatementTransaction[] = [];

    for (const it of allItems) {
      periodBilled = periodBilled.plus(it.credit);
      periodPaid = periodPaid.plus(it.debit);
      runningBalance = runningBalance.plus(it.credit).minus(it.debit);

      transactions.push({
        date: it.date,
        type: it.type,
        referenceNumber: it.ref,
        description: it.desc,
        debit: it.debit.toNumber(),
        credit: it.credit.toNumber(),
        runningBalance: runningBalance.toNumber(),
      });
    }

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      fromDate,
      toDate,
      openingBalance: openingBalanceDec.toNumber(),
      totalBilled: periodBilled.toNumber(),
      totalPaid: periodPaid.toNumber(),
      closingBalance: runningBalance.toNumber(),
      transactions,
    };
  }

  /**
   * Computes procurement spend metrics grouped by category and top suppliers.
   */
  static async getProcurementSpendAnalytics(
    client: SupabaseClient,
    companyId: string,
    fromDate?: string,
    toDate?: string
  ) {
    let poQuery = client
      .from('purchase_orders')
      .select('id, po_number, order_date, grand_total, status, supplier_id, supplier:suppliers(id, name, category)')
      .eq('company_id', companyId)
      .neq('status', 'cancelled');

    if (fromDate) poQuery = poQuery.gte('order_date', fromDate);
    if (toDate) poQuery = poQuery.lte('order_date', toDate);

    const { data: pos, error } = await poQuery;
    if (error) throw new Error(`Failed to fetch spend analytics: ${error.message}`);

    let totalSpend = new Decimal(0);
    const categoryMap = new Map<string, Decimal>();
    const supplierSpendMap = new Map<string, { name: string; spend: Decimal; orderCount: number }>();

    for (const po of pos || []) {
      const amt = new Decimal(po.grand_total || 0);
      totalSpend = totalSpend.plus(amt);

      const cat = (po.supplier as any)?.category || 'GENERAL';
      categoryMap.set(cat, (categoryMap.get(cat) || new Decimal(0)).plus(amt));

      const sId = po.supplier_id;
      const sName = (po.supplier as any)?.name || 'Unknown';
      const existing = supplierSpendMap.get(sId) || { name: sName, spend: new Decimal(0), orderCount: 0 };
      existing.spend = existing.spend.plus(amt);
      existing.orderCount += 1;
      supplierSpendMap.set(sId, existing);
    }

    const byCategory = Array.from(categoryMap.entries()).map(([category, amount]) => ({
      category,
      amount: amount.toNumber(),
      percentage: totalSpend.greaterThan(0)
        ? amount.dividedBy(totalSpend).times(100).toDecimalPlaces(2).toNumber()
        : 0,
    }));

    const topSuppliers = Array.from(supplierSpendMap.entries())
      .map(([supplierId, info]) => ({
        supplierId,
        supplierName: info.name,
        spend: info.spend.toNumber(),
        orderCount: info.orderCount,
        percentage: totalSpend.greaterThan(0)
          ? info.spend.dividedBy(totalSpend).times(100).toDecimalPlaces(2).toNumber()
          : 0,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);

    return {
      totalSpend: totalSpend.toNumber(),
      totalOrders: (pos || []).length,
      byCategory,
      topSuppliers,
    };
  }

  /**
   * Computes supplier performance metrics: On-time delivery rate & Quality acceptance rate.
   */
  static async getSupplierPerformanceMetrics(client: SupabaseClient, supplierId: string) {
    // 1. Purchase orders count
    const { data: pos } = await client
      .from('purchase_orders')
      .select('id, expected_delivery_date, status')
      .eq('supplier_id', supplierId)
      .neq('status', 'cancelled');

    const totalOrders = (pos || []).length;

    // 2. Receipts & Quality Inspection
    const { data: receipts } = await client
      .from('goods_receipts')
      .select('id, receipt_date, po_id, lines:goods_receipt_lines(accepted_quantity, rejected_quantity, damaged_quantity, received_quantity)')
      .eq('supplier_id', supplierId);

    let totalReceivedUnits = new Decimal(0);
    let totalAcceptedUnits = new Decimal(0);
    let onTimeReceipts = 0;
    let evaluatedReceipts = 0;

    const poDateMap = new Map<string, string>();
    for (const po of pos || []) {
      if (po.expected_delivery_date) {
        poDateMap.set(po.id, po.expected_delivery_date);
      }
    }

    for (const r of receipts || []) {
      const expDateStr = r.po_id ? poDateMap.get(r.po_id) : null;
      if (expDateStr && r.receipt_date) {
        evaluatedReceipts++;
        if (new Date(r.receipt_date) <= new Date(expDateStr)) {
          onTimeReceipts++;
        }
      }

      for (const line of r.lines || []) {
        const acc = new Decimal(line.accepted_quantity || 0);
        const rej = new Decimal(line.rejected_quantity || 0);
        const dam = new Decimal(line.damaged_quantity || 0);
        const rec = new Decimal(line.received_quantity || acc.plus(rej).plus(dam));

        totalReceivedUnits = totalReceivedUnits.plus(rec);
        totalAcceptedUnits = totalAcceptedUnits.plus(acc);
      }
    }

    const onTimeRate = evaluatedReceipts > 0
      ? new Decimal(onTimeReceipts).dividedBy(evaluatedReceipts).times(100).toDecimalPlaces(2).toNumber()
      : 100.0;

    const qualityAcceptanceRate = totalReceivedUnits.greaterThan(0)
      ? totalAcceptedUnits.dividedBy(totalReceivedUnits).times(100).toDecimalPlaces(2).toNumber()
      : 100.0;

    return {
      supplierId,
      totalOrders,
      evaluatedReceipts,
      onTimeDeliveryRate: onTimeRate,
      qualityAcceptanceRate,
      totalReceivedUnits: totalReceivedUnits.toNumber(),
      totalAcceptedUnits: totalAcceptedUnits.toNumber(),
    };
  }
}

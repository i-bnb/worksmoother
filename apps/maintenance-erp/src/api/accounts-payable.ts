/**
 * =============================================================================
 * Accounts Payable, 3-Way Matching & Disbursements REST API Controller
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { validateSupplierBillCreate } from '../schemas/accounts-payable.schema.js';
import { ThreeWayMatchingService } from '../services/three-way-matching.service.js';
import { AccountsPayablePaymentService } from '../services/accounts-payable-payment.service.js';
import { ProcurementReportingService } from '../services/procurement-reporting.service.js';
import { JournalPostingService } from '../services/journal-posting.service.js';
import { DocumentNumberService } from '../services/document-number.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';
import { Decimal } from '../lib/decimal.js';

export class AccountsPayableApiController {
  /**
   * POST /api/supplier-bills
   */
  static async createSupplierBill(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const dto = validateSupplierBillCreate(req.body);
      const billNumber = await DocumentNumberService.generate(client, dto.companyId, 'BILL');

      // Calculate totals
      let subtotal = new Decimal(0);
      let taxTotal = new Decimal(0);

      const preparedLines = dto.lines.map((line) => {
        const qty = new Decimal(line.quantity);
        const price = new Decimal(line.unitPrice);
        const taxRate = new Decimal(line.taxRate !== undefined ? line.taxRate : 5.0);

        const lineSubtotal = qty.times(price);
        const lineTax = lineSubtotal.times(taxRate).dividedBy(100);
        const lineTotal = lineSubtotal.plus(lineTax);

        subtotal = subtotal.plus(lineSubtotal);
        taxTotal = taxTotal.plus(lineTax);

        return {
          item_id: line.itemId || null,
          description: line.description,
          quantity: qty.toNumber(),
          unit_price: price.toNumber(),
          tax_rate: taxRate.toNumber(),
          tax_amount: lineTax.toDecimalPlaces(3).toNumber(),
          line_total: lineTotal.toDecimalPlaces(3).toNumber(),
          expense_account_id: line.expenseAccountId || null,
          cost_center_id: line.costCenterId || null,
        };
      });

      const grandTotal = subtotal.plus(taxTotal).toDecimalPlaces(3);

      const { data: bill, error: bErr } = await client
        .from('supplier_bills')
        .insert({
          company_id: dto.companyId,
          branch_id: dto.branchId || null,
          supplier_id: dto.supplierId,
          po_id: dto.poId || null,
          goods_receipt_id: dto.goodsReceiptId || null,
          bill_number: billNumber,
          vendor_invoice_number: dto.vendorInvoiceNumber || null,
          bill_date: dto.billDate,
          due_date: dto.dueDate || dto.billDate,
          currency: dto.currency || 'AED',
          subtotal: subtotal.toDecimalPlaces(3).toNumber(),
          tax_total: taxTotal.toDecimalPlaces(3).toNumber(),
          grand_total: grandTotal.toNumber(),
          amount_paid: 0.0,
          amount_due: grandTotal.toNumber(),
          status: 'draft',
          matching_status: 'unmatched',
          notes: dto.notes || null,
          created_by: userId || null,
        })
        .select()
        .single();

      if (bErr) throw new Error(`Failed to create supplier bill: ${bErr.message}`);

      const linesToInsert = preparedLines.map((l) => ({
        bill_id: bill.id,
        ...l,
      }));

      const { error: lErr } = await client.from('supplier_bill_lines').insert(linesToInsert);
      if (lErr) throw new Error(`Failed to insert bill lines: ${lErr.message}`);

      return {
        status: 201,
        data: {
          ...bill,
          lines: linesToInsert,
        },
      };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/supplier-bills
   */
  static async listSupplierBills(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      let query = client
        .from('supplier_bills')
        .select('*, supplier:suppliers(id, name, code)')
        .eq('company_id', companyId)
        .order('bill_date', { ascending: false });

      if (req.query?.supplierId) query = query.eq('supplier_id', req.query.supplierId);
      if (req.query?.status) query = query.eq('status', req.query.status);
      if (req.query?.matchingStatus) query = query.eq('matching_status', req.query.matchingStatus);

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list supplier bills: ${error.message}`);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/supplier-bills/:id
   */
  static async getSupplierBillById(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const billId = req.params?.id;
      if (!billId) return { status: 400, error: 'billId is required' };

      const result = await ThreeWayMatchingService.getMatchingDetails(client, billId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-bills/:id/match
   */
  static async matchSupplierBill(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const billId = req.params?.id;
      if (!billId) return { status: 400, error: 'billId is required' };

      const payload = {
        billId,
        priceTolerancePercent: req.body?.priceTolerancePercent,
        quantityTolerancePercent: req.body?.quantityTolerancePercent,
      };

      const result = await ThreeWayMatchingService.matchSupplierBill(client, payload, userId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-bills/:id/override-match
   */
  static async overrideMatchingStatus(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const billId = req.params?.id;
      const { overrideStatus, reason } = req.body || {};
      if (!billId) return { status: 400, error: 'billId is required' };
      if (!overrideStatus) return { status: 400, error: 'overrideStatus is required' };

      const result = await ThreeWayMatchingService.overrideMatchingStatus(
        client,
        billId,
        overrideStatus,
        reason,
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-bills/:id/post-to-gl
   */
  static async postBillToGl(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const billId = req.params?.id;
      if (!billId) return { status: 400, error: 'billId is required' };

      const result = await JournalPostingService.postSupplierBillToGl(client, billId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-payments
   */
  static async recordSupplierPayment(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const autoPost = Boolean(req.body?.autoPostToGl);
      const result = await AccountsPayablePaymentService.recordPayment(client, req.body, userId, autoPost);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-payments/apply-advance
   */
  static async applyAdvance(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const { advancePaymentId, billId, amountToApply } = req.body || {};
      if (!advancePaymentId || !billId || !amountToApply) {
        return { status: 400, error: 'advancePaymentId, billId, and amountToApply are required' };
      }

      const result = await AccountsPayablePaymentService.applyAdvanceToBill(
        client,
        advancePaymentId,
        billId,
        Number(amountToApply),
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/supplier-payments/:id/reverse
   */
  static async reverseSupplierPayment(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const paymentId = req.params?.id;
      const { reversalReason } = req.body || {};
      if (!paymentId) return { status: 400, error: 'paymentId is required' };

      const result = await AccountsPayablePaymentService.reversePayment(
        client,
        { paymentId, reversalReason },
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/supplier-payments
   */
  static async listPayments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const filters = {
        supplierId: req.query?.supplierId || req.query?.supplier_id,
        billId: req.query?.billId || req.query?.bill_id,
        paymentType: req.query?.paymentType || req.query?.payment_type,
        limit: req.query?.limit ? Number(req.query.limit) : undefined,
      };

      const result = await AccountsPayablePaymentService.listPayments(client, companyId, filters);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/accounts-payable/aging
   */
  static async getAgingReport(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const query = {
        companyId,
        asOfDate: req.query?.asOfDate || req.query?.as_of_date,
        supplierId: req.query?.supplierId || req.query?.supplier_id,
      };

      const result = await ProcurementReportingService.getAgingAnalysis(client, query);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/accounts-payable/spend
   */
  static async getSpendAnalytics(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const fromDate = req.query?.fromDate || req.query?.from_date;
      const toDate = req.query?.toDate || req.query?.to_date;

      const result = await ProcurementReportingService.getProcurementSpendAnalytics(
        client,
        companyId,
        fromDate,
        toDate
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

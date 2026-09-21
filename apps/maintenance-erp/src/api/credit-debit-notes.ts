import { SupabaseClient } from '@supabase/supabase-js';
import { CreditDebitNoteService } from '../services/credit-debit-note.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class CreditDebitNotesApiController {
  // Customer Credit Notes
  static async createCustomerCreditNote(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await CreditDebitNoteService.createCustomerCreditNote(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getCustomerCreditNote(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { data, error } = await client
        .from('credit_notes')
        .select('*, credit_note_lines(*)')
        .eq('id', id)
        .single();
      if (error || !data) return { status: 404, error: 'Credit note not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async postCustomerCreditNoteToGl(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const creditNoteId = req.params?.id;
      const glAccounts = req.body?.glAccounts || req.body?.gl_accounts || {
        salesReturnAccountId: req.body?.salesReturnAccountId,
        arControlAccountId: req.body?.arControlAccountId,
        cgstOutputAccountId: req.body?.cgstOutputAccountId,
        sgstOutputAccountId: req.body?.sgstOutputAccountId,
        igstOutputAccountId: req.body?.igstOutputAccountId,
      };
      const result = await CreditDebitNoteService.postCustomerCreditNoteToGl(client, companyId, creditNoteId!, glAccounts);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async applyCustomerCreditNote(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const payload = {
        ...req.body,
        creditNoteId: req.params?.id || req.body?.creditNoteId,
      };
      const result = await CreditDebitNoteService.applyCustomerCreditNoteToInvoice(client, companyId, payload);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  // Supplier Credit Notes
  static async createSupplierCreditNote(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await CreditDebitNoteService.createSupplierCreditNote(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getSupplierCreditNote(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { data, error } = await client
        .from('supplier_credit_notes')
        .select('*, supplier_credit_note_lines(*)')
        .eq('id', id)
        .single();
      if (error || !data) return { status: 404, error: 'Supplier credit note not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async postSupplierCreditNoteToGl(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const id = req.params?.id;
      const glAccounts = req.body?.glAccounts || req.body?.gl_accounts || {
        apControlAccountId: req.body?.apControlAccountId,
        purchaseReturnAccountId: req.body?.purchaseReturnAccountId,
        itcAccountId: req.body?.itcAccountId,
      };
      const result = await CreditDebitNoteService.postSupplierCreditNoteToGl(client, companyId, id!, glAccounts);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async applySupplierCreditNote(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const payload = {
        ...req.body,
        supplierCreditNoteId: req.params?.id || req.body?.supplierCreditNoteId,
      };
      const result = await CreditDebitNoteService.applySupplierCreditNoteToBill(client, companyId, payload);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  // Debit Notes (Customer & Supplier)
  static async createDebitNote(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await CreditDebitNoteService.createDebitNote(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getDebitNote(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const { data, error } = await client
        .from('debit_notes')
        .select('*, debit_note_lines(*)')
        .eq('id', id)
        .single();
      if (error || !data) return { status: 404, error: 'Debit note not found' };
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async postDebitNoteToGl(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const id = req.params?.id;
      const glAccounts = req.body?.glAccounts || req.body?.gl_accounts || {
        receivableOrPayableAccountId: req.body?.receivableOrPayableAccountId,
        incomeOrExpenseAccountId: req.body?.incomeOrExpenseAccountId,
        taxAccountId: req.body?.taxAccountId,
      };
      const result = await CreditDebitNoteService.postDebitNoteToGl(client, companyId, id!, glAccounts);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

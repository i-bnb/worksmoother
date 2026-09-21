import { SupabaseClient } from '@supabase/supabase-js';
import { BankAccountService } from '../services/bank-account.service.js';
import { BankStatementImportService } from '../services/bank-statement-import.service.js';
import { BankReconciliationService } from '../services/bank-reconciliation.service.js';
import { BankTransferService } from '../services/bank-transfer.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class BankingApiController {
  /**
   * POST /api/banking/accounts
   */
  static async createAccount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const account = await BankAccountService.createBankAccount(client, req.body);
      return { status: 201, data: account };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/banking/accounts/:id
   */
  static async getAccount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      const accountId = req.params?.id;
      if (!companyId || !accountId) {
        return { status: 400, error: 'companyId and account id are required' };
      }
      const account = await BankAccountService.getBankAccount(client, companyId, accountId);
      return { status: 200, data: account };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  /**
   * GET /api/banking/accounts
   */
  static async listAccounts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId query param is required' };
      const includeInactive = req.query?.includeInactive === 'true';
      const accounts = await BankAccountService.listBankAccounts(client, companyId, includeInactive);
      return { status: 200, data: accounts };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/banking/accounts/:id
   */
  static async updateAccount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id || req.query?.companyId;
      const accountId = req.params?.id;
      if (!companyId || !accountId) return { status: 400, error: 'companyId and account id are required' };
      const updated = await BankAccountService.updateBankAccount(client, companyId, accountId, req.body);
      return { status: 200, data: updated };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/accounts/:id/statement-import
   */
  static async importStatement(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const payload = {
        ...req.body,
        bankAccountId: req.params?.id || req.body?.bankAccountId,
      };
      const result = await BankStatementImportService.importStatement(client, payload, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/banking/accounts/:id/transactions
   */
  static async listTransactions(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const accountId = req.params?.id;
      const status = req.query?.status;
      let query = client
        .from('bank_transactions')
        .select('*')
        .eq('bank_account_id', accountId)
        .order('transaction_date', { ascending: false });

      if (status) query = query.eq('reconciliation_status', status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/transfers
   */
  static async executeTransfer(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await BankTransferService.executeTransfer(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/reconciliation/sessions
   */
  static async startReconciliationSession(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const session = await BankReconciliationService.startSession(client, req.body, userId);
      return { status: 201, data: session };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/reconciliation/sessions/:id/match
   */
  static async manualMatch(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const payload = {
        ...req.body,
        sessionId: req.params?.id || req.body?.sessionId,
      };
      const result = await BankReconciliationService.manualMatch(client, payload);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/reconciliation/sessions/:id/auto-match
   */
  static async autoMatch(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const payload = {
        companyId: req.body?.companyId || req.body?.company_id,
        sessionId: req.params?.id || req.body?.sessionId,
        dateToleranceDays: req.body?.dateToleranceDays,
      };
      const result = await BankReconciliationService.autoMatch(client, payload);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/banking/reconciliation/sessions/:id/complete
   */
  static async completeSession(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const companyId = req.body?.companyId || req.body?.company_id;
      const sessionId = req.params?.id;
      if (!companyId || !sessionId) return { status: 400, error: 'companyId and sessionId are required' };
      const completed = await BankReconciliationService.completeSession(client, companyId, sessionId, userId);
      return { status: 200, data: completed };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

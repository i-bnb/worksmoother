import { SupabaseClient } from '@supabase/supabase-js';
import { ChartOfAccountsService } from '../services/chart-of-accounts.service.js';
import { CategoryMappingService } from '../services/category-mapping.service.js';
import { JournalPostingService } from '../services/journal-posting.service.js';
import { validateAccountCreate } from '../schemas/account.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AccountingJournalsApiController {
  static async listAccounts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await ChartOfAccountsService.listAccounts(client, companyId, {
        accountType: req.query?.accountType || req.query?.account_type,
        isActive: req.query?.isActive !== undefined ? req.query.isActive === 'true' : req.query?.is_active !== undefined ? req.query.is_active === 'true' : undefined,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async createAccount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateAccountCreate(req.body);
      const data = await ChartOfAccountsService.createAccount(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getAccount(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Account ID is required' };

      const data = await ChartOfAccountsService.getAccount(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async listCategories(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'company_id is required' };

      const data = await CategoryMappingService.listMappings(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }


  static async setCategoryMapping(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, categoryCode, accountId, description } = req.body || {};
      if (!companyId || !categoryCode || !accountId) {
        return { status: 400, error: 'companyId, categoryCode, and accountId are required' };
      }

      const data = await CategoryMappingService.setMapping(client, companyId, categoryCode, accountId, description);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createJournal(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const { companyId, journalDate, description, lines, autoPost } = req.body || {};
      if (!companyId || !journalDate || !description || !Array.isArray(lines)) {
        return { status: 400, error: 'companyId, journalDate, description, and lines are required' };
      }

      const result = await JournalPostingService.createJournalEntry(client, {
        companyId,
        journalDate,
        description,
        lines,
        autoPost: Boolean(autoPost),
      });

      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async postJournal(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Journal ID is required' };

      const data = await JournalPostingService.postJournal(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async reverseJournal(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Correction of prior accounting transaction';
      if (!id) return { status: 400, error: 'Journal ID is required' };

      const data = await JournalPostingService.reverseJournal(client, id, reason);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

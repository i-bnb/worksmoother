import { SupabaseClient } from '@supabase/supabase-js';
import { ExpenseService } from '../services/expense.service.js';
import { validateExpenseCreate, validateExpensePay } from '../schemas/expense.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AccountingExpensesApiController {
  static async listExpenses(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await ExpenseService.listExpenses(client, companyId, {
        status: req.query?.status,
        employeeId: req.query?.employeeId,
        workOrderId: req.query?.workOrderId,
        category: req.query?.category,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async createExpense(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateExpenseCreate(req.body);
      const data = await ExpenseService.createExpense(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async submitExpense(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Expense ID is required' };

      const data = await ExpenseService.submitExpense(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveExpense(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Expense ID is required' };

      const data = await ExpenseService.approveExpense(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async rejectExpense(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const reason = req.body?.reason || 'Expense rejected';
      if (!id) return { status: 400, error: 'Expense ID is required' };

      const data = await ExpenseService.rejectExpense(client, id, reason);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async payExpense(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Expense ID is required' };

      const { paymentMethod, bankAccountId } = validateExpensePay(req.body);
      const data = await ExpenseService.payExpense(client, id, paymentMethod, bankAccountId || undefined);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}


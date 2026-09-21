import { SupabaseClient } from '@supabase/supabase-js';

export interface CreateExpenseDto {
  companyId: string;
  branchId?: string | null;
  employeeId?: string | null;
  workOrderId?: string | null;
  costCenterId?: string | null;
  amount: number;
  currency?: string;
  category: string;
  expenseDate?: string;
  description: string;
  receiptUrl?: string | null;
  glExpenseAccountId?: string | null;
}

export class ExpenseService {
  /**
   * Records a draft expense.
   */
  static async createExpense(client: SupabaseClient, dto: CreateExpenseDto) {
    if (dto.amount <= 0) {
      throw new Error(`Expense amount must be strictly positive: ${dto.amount}`);
    }

    const { data, error } = await client
      .from('expenses')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        employee_id: dto.employeeId || null,
        work_order_id: dto.workOrderId || null,
        cost_center_id: dto.costCenterId || null,
        amount: dto.amount,
        currency: dto.currency || 'INR',
        category: dto.category.toLowerCase().trim(),
        expense_date: dto.expenseDate || new Date().toISOString().slice(0, 10),
        description: dto.description.trim(),
        receipt_url: dto.receiptUrl || null,
        gl_expense_account_id: dto.glExpenseAccountId || null,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw new Error(`Expense creation failed: ${error.message}`);
    return data;
  }

  /**
   * Submits a draft expense for approval.
   */
  static async submitExpense(client: SupabaseClient, expenseId: string) {
    const { data, error } = await client
      .from('expenses')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', expenseId)
      .select()
      .single();

    if (error) throw new Error(`Expense submission failed: ${error.message}`);
    return data;
  }

  /**
   * Approves a submitted expense with self-approval policy enforcement.
   */
  static async approveExpense(client: SupabaseClient, expenseId: string) {
    const { data, error } = await client.rpc('approve_expense', {
      p_expense_id: expenseId,
    });

    if (error) throw new Error(`Expense approval failed: ${error.message}`);
    return data;
  }

  /**
   * Rejects an expense with reason.
   */
  static async rejectExpense(client: SupabaseClient, expenseId: string, reason: string) {
    const { data, error } = await client
      .from('expenses')
      .update({
        status: 'rejected',
        description: reason ? `[REJECTED: ${reason}]` : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', expenseId)
      .select()
      .single();

    if (error) throw new Error(`Expense rejection failed: ${error.message}`);
    return data;
  }

  /**
   * Records payment against an approved expense and posts it to GL.
   */
  static async payExpense(
    client: SupabaseClient,
    expenseId: string,
    paymentMethod: string = 'bank_transfer',
    bankAccountId?: string
  ) {
    const { data, error } = await client.rpc('pay_expense', {
      p_expense_id: expenseId,
      p_payment_method: paymentMethod,
      p_bank_account_id: bankAccountId || null,
    });

    if (error) throw new Error(`Expense payment failed: ${error.message}`);
    return data;
  }

  /**
   * Lists expenses with filters.
   */
  static async listExpenses(
    client: SupabaseClient,
    companyId: string,
    filters: { status?: string; employeeId?: string; workOrderId?: string; category?: string } = {}
  ) {
    let query = client
      .from('expenses')
      .select('*, employee:employees(*), work_order:work_orders(id, work_order_number)')
      .eq('company_id', companyId)
      .order('expense_date', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
    if (filters.workOrderId) query = query.eq('work_order_id', filters.workOrderId);
    if (filters.category) query = query.eq('category', filters.category);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list expenses: ${error.message}`);
    return data;
  }
}

export interface ExpenseCreateDto {
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

export function validateExpenseCreate(body: any): ExpenseCreateDto {
  if (!body) throw new Error('Expense request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    throw new Error('amount must be a strictly positive number');
  }
  if (!body.category || typeof body.category !== 'string') {
    throw new Error('category is required');
  }
  if (!body.description || typeof body.description !== 'string') {
    throw new Error('description is required');
  }

  return body as ExpenseCreateDto;
}

export interface ExpensePayDto {
  paymentMethod: string;
  bankAccountId?: string | null;
  amountPaid?: number;
}

export function validateExpensePay(body: any): ExpensePayDto {
  if (!body) throw new Error('Payment body is required');
  if (!body.paymentMethod || typeof body.paymentMethod !== 'string' || body.paymentMethod.trim() === '') {
    throw new Error('paymentMethod is required');
  }
  return body as ExpensePayDto;
}

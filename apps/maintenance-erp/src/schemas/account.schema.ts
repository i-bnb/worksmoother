export interface AccountCreateDto {
  companyId: string;
  branchId?: string | null;
  accountCode: string;
  accountName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  accountGroupId?: string | null;
  parentAccountId?: string | null;
  currency?: string;
  isControlAccount?: boolean;
  openingBalanceDebit?: number;
  openingBalanceCredit?: number;
  notes?: string | null;
}

export function validateAccountCreate(body: any): AccountCreateDto {
  if (!body) throw new Error('Account request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.accountCode || typeof body.accountCode !== 'string') {
    throw new Error('accountCode is required');
  }
  if (!body.accountName || typeof body.accountName !== 'string') {
    throw new Error('accountName is required');
  }
  const validTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'];
  if (!validTypes.includes(body.accountType)) {
    throw new Error(`accountType must be one of: ${validTypes.join(', ')}`);
  }

  return body as AccountCreateDto;
}

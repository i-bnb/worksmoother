import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  BankAccountCreateDto,
  BankAccountUpdateDto,
  validateBankAccountCreate,
  validateBankAccountUpdate,
} from '../schemas/banking.schema.js';

export interface BankAccountRecord {
  id: string;
  company_id: string;
  branch_id?: string | null;
  account_name: string;
  bank_name: string;
  account_number_last4: string;
  account_number_full?: string | null;
  account_number_masked?: string;
  ifsc_code?: string | null;
  swift_code?: string | null;
  routing_number?: string | null;
  branch_name?: string | null;
  account_type: string;
  currency: string;
  gl_account_id?: string | null;
  opening_balance: number;
  current_balance: number;
  statement_balance: number;
  cleared_balance: number;
  last_reconciled_date?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class BankAccountService {
  /**
   * Masks a full account number preserving only the last 4 characters.
   */
  static maskAccountNumber(accountNumber: string): string {
    const clean = (accountNumber || '').trim();
    if (clean.length <= 4) return clean;
    const last4 = clean.slice(-4);
    return `****${last4}`;
  }

  /**
   * Creates a new bank account with sensitive number masking and initial balance tracking.
   */
  static async createBankAccount(
    client: SupabaseClient,
    rawDto: BankAccountCreateDto
  ): Promise<BankAccountRecord> {
    const dto = validateBankAccountCreate(rawDto);
    const last4 = dto.accountNumberFull.slice(-4);
    const openingBalDec = new Decimal(dto.openingBalance || 0);

    const payload = {
      company_id: dto.companyId,
      branch_id: dto.branchId,
      account_name: dto.accountName,
      bank_name: dto.bankName,
      account_number_last4: last4,
      account_number_full: dto.accountNumberFull,
      ifsc_code: dto.ifscCode,
      swift_code: dto.swiftCode,
      routing_number: dto.routingNumber,
      branch_name: dto.branchName,
      account_type: dto.accountType,
      currency: dto.currency || 'INR',
      gl_account_id: dto.glAccountId,
      opening_balance: openingBalDec.toNumber(),
      current_balance: openingBalDec.toNumber(),
      statement_balance: openingBalDec.toNumber(),
      cleared_balance: openingBalDec.toNumber(),
      is_active: true,
    };

    const { data, error } = await client
      .from('bank_accounts')
      .insert(payload)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create bank account: ${error?.message || 'Database error'}`);
    }

    return {
      ...data,
      account_number_masked: this.maskAccountNumber(data.account_number_full || data.account_number_last4),
    };
  }

  /**
   * Updates an existing bank account.
   */
  static async updateBankAccount(
    client: SupabaseClient,
    companyId: string,
    accountId: string,
    rawDto: BankAccountUpdateDto
  ): Promise<BankAccountRecord> {
    const dto = validateBankAccountUpdate(rawDto);

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.accountName !== undefined) updatePayload.account_name = dto.accountName;
    if (dto.bankName !== undefined) updatePayload.bank_name = dto.bankName;
    if (dto.ifscCode !== undefined) updatePayload.ifsc_code = dto.ifscCode;
    if (dto.swiftCode !== undefined) updatePayload.swift_code = dto.swiftCode;
    if (dto.routingNumber !== undefined) updatePayload.routing_number = dto.routingNumber;
    if (dto.branchName !== undefined) updatePayload.branch_name = dto.branchName;
    if (dto.accountType !== undefined) updatePayload.account_type = dto.accountType;
    if (dto.glAccountId !== undefined) updatePayload.gl_account_id = dto.glAccountId;
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;

    const { data, error } = await client
      .from('bank_accounts')
      .update(updatePayload)
      .eq('company_id', companyId)
      .eq('id', accountId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update bank account: ${error?.message || 'Account not found'}`);
    }

    return {
      ...data,
      account_number_masked: this.maskAccountNumber(data.account_number_full || data.account_number_last4),
    };
  }

  /**
   * Retrieves a single bank account with masked account number.
   */
  static async getBankAccount(
    client: SupabaseClient,
    companyId: string,
    accountId: string
  ): Promise<BankAccountRecord> {
    const { data, error } = await client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', accountId)
      .single();

    if (error || !data) {
      throw new Error(`Bank account not found: ${error?.message || accountId}`);
    }

    return {
      ...data,
      account_number_masked: this.maskAccountNumber(data.account_number_full || data.account_number_last4),
    };
  }

  /**
   * Lists bank accounts for a company.
   */
  static async listBankAccounts(
    client: SupabaseClient,
    companyId: string,
    includeInactive = false
  ): Promise<BankAccountRecord[]> {
    let query = client
      .from('bank_accounts')
      .select('*')
      .eq('company_id', companyId)
      .order('account_name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list bank accounts: ${error.message}`);
    }

    return (data || []).map((acc: any) => ({
      ...acc,
      account_number_masked: this.maskAccountNumber(acc.account_number_full || acc.account_number_last4),
    }));
  }

  /**
   * Updates balance tracking columns safely.
   */
  static async updateBalances(
    client: SupabaseClient,
    companyId: string,
    accountId: string,
    balances: {
      currentBalance?: number;
      statementBalance?: number;
      clearedBalance?: number;
      lastReconciledDate?: string;
    }
  ) {
    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (balances.currentBalance !== undefined) payload.current_balance = balances.currentBalance;
    if (balances.statementBalance !== undefined) payload.statement_balance = balances.statementBalance;
    if (balances.clearedBalance !== undefined) payload.cleared_balance = balances.clearedBalance;
    if (balances.lastReconciledDate !== undefined) payload.last_reconciled_date = balances.lastReconciledDate;

    const { error } = await client
      .from('bank_accounts')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', accountId);

    if (error) {
      throw new Error(`Failed to update bank account balances: ${error.message}`);
    }
  }
}

/**
 * =============================================================================
 * Banking, Statement Import & Reconciliation Validation Schemas
 * Maintenance Management ERP — Phase 11 Advanced Finance
 * =============================================================================
 */

export interface BankAccountCreateDto {
  companyId: string;
  branchId?: string | null;
  accountName: string;
  bankName: string;
  accountNumberFull: string;
  ifscCode?: string | null;
  swiftCode?: string | null;
  routingNumber?: string | null;
  branchName?: string | null;
  accountType?: 'current' | 'savings' | 'overdraft' | 'cash';
  currency?: string;
  glAccountId?: string | null;
  openingBalance?: number;
}

export interface BankAccountUpdateDto {
  accountName?: string;
  bankName?: string;
  ifscCode?: string | null;
  swiftCode?: string | null;
  routingNumber?: string | null;
  branchName?: string | null;
  accountType?: 'current' | 'savings' | 'overdraft' | 'cash';
  glAccountId?: string | null;
  isActive?: boolean;
}

export interface ParsedBankStatementLineDto {
  transactionDate: string;
  valueDate?: string | null;
  transactionType: 'debit' | 'credit';
  amount: number;
  balanceAfter?: number | null;
  description: string;
  referenceNumber?: string | null;
  payeePayer?: string | null;
}

export interface BankStatementImportDto {
  companyId: string;
  bankAccountId: string;
  providerType?: 'csv' | 'manual' | 'camt053' | 'ofx';
  fileName?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  lines?: ParsedBankStatementLineDto[];
  rawCsvContent?: string | null;
}

export interface BankTransactionQueryDto {
  companyId: string;
  bankAccountId: string;
  reconciliationStatus?: 'UNMATCHED' | 'MATCHED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'IGNORED';
  startDate?: string;
  endDate?: string;
}

export interface ReconciliationSessionStartDto {
  companyId: string;
  bankAccountId: string;
  statementDate: string;
  statementOpeningBalance: number;
  statementClosingBalance: number;
  notes?: string | null;
}

export interface ReconciliationManualMatchDto {
  companyId: string;
  sessionId: string;
  bankTransactionId: string;
  matchedEntityType: 'customer_payment' | 'supplier_payment' | 'expense' | 'journal_entry' | 'bank_transfer';
  matchedEntityId: string;
  matchedAmount: number;
  notes?: string | null;
}

export interface ReconciliationAutoMatchDto {
  companyId: string;
  sessionId: string;
  dateToleranceDays?: number; // e.g. default 2 days
}

export interface ReconciliationCompleteDto {
  companyId: string;
  sessionId: string;
}

export interface BankTransferCreateDto {
  companyId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  transferDate?: string;
  transferFee?: number;
  feeAccountId?: string | null;
  exchangeRate?: number;
  referenceNumber?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Validator Functions
// ---------------------------------------------------------------------------

export function validateBankAccountCreate(body: any): BankAccountCreateDto {
  if (!body) throw new Error('Bank account body is required');
  const companyId = body.companyId || body.company_id;
  const accountName = (body.accountName || body.account_name || '').trim();
  const bankName = (body.bankName || body.bank_name || '').trim();
  const accountNumberFull = (body.accountNumberFull || body.account_number_full || body.accountNumber || body.account_number || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!accountName) throw new Error('accountName is required');
  if (!bankName) throw new Error('bankName is required');
  if (!accountNumberFull) throw new Error('accountNumber is required');

  const accountType = (body.accountType || body.account_type || 'current').toLowerCase();
  const validTypes = ['current', 'savings', 'overdraft', 'cash'];
  if (!validTypes.includes(accountType)) {
    throw new Error(`Invalid accountType: ${accountType}`);
  }

  const openingBalance = Number(body.openingBalance ?? body.opening_balance ?? 0);
  if (isNaN(openingBalance) || openingBalance < 0) {
    throw new Error('openingBalance must be non-negative');
  }

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    accountName,
    bankName,
    accountNumberFull,
    ifscCode: body.ifscCode || body.ifsc_code || null,
    swiftCode: body.swiftCode || body.swift_code || null,
    routingNumber: body.routingNumber || body.routing_number || null,
    branchName: body.branchName || body.branch_name || null,
    accountType: accountType as any,
    currency: body.currency || 'INR',
    glAccountId: body.glAccountId || body.gl_account_id || null,
    openingBalance,
  };
}

export function validateBankAccountUpdate(body: any): BankAccountUpdateDto {
  if (!body) throw new Error('Update payload is required');
  const dto: BankAccountUpdateDto = {};

  if (body.accountName !== undefined) dto.accountName = String(body.accountName).trim();
  if (body.bankName !== undefined) dto.bankName = String(body.bankName).trim();
  if (body.ifscCode !== undefined) dto.ifscCode = body.ifscCode ? String(body.ifscCode).trim() : null;
  if (body.swiftCode !== undefined) dto.swiftCode = body.swiftCode ? String(body.swiftCode).trim() : null;
  if (body.routingNumber !== undefined) dto.routingNumber = body.routingNumber ? String(body.routingNumber).trim() : null;
  if (body.branchName !== undefined) dto.branchName = body.branchName ? String(body.branchName).trim() : null;
  if (body.glAccountId !== undefined) dto.glAccountId = body.glAccountId || null;
  if (body.isActive !== undefined) dto.isActive = Boolean(body.isActive);

  if (body.accountType !== undefined) {
    const accountType = String(body.accountType).toLowerCase();
    const validTypes = ['current', 'savings', 'overdraft', 'cash'];
    if (!validTypes.includes(accountType)) throw new Error(`Invalid accountType: ${accountType}`);
    dto.accountType = accountType as any;
  }

  return dto;
}

export function validateBankStatementImport(body: any): BankStatementImportDto {
  if (!body) throw new Error('Statement import payload is required');
  const companyId = body.companyId || body.company_id;
  const bankAccountId = body.bankAccountId || body.bank_account_id;

  if (!companyId) throw new Error('companyId is required');
  if (!bankAccountId) throw new Error('bankAccountId is required');

  const rawLines = body.lines || [];
  if (!Array.isArray(rawLines) && !body.rawCsvContent && !body.raw_csv_content) {
    throw new Error('Either lines array or rawCsvContent is required for statement import');
  }

  const lines: ParsedBankStatementLineDto[] = Array.isArray(rawLines)
    ? rawLines.map((line: any, idx: number) => {
        const date = line.transactionDate || line.transaction_date || line.date;
        const type = (line.transactionType || line.transaction_type || line.type || '').toLowerCase();
        const amount = Number(line.amount);
        const description = (line.description || line.narration || '').trim();

        if (!date) throw new Error(`Line ${idx + 1}: transactionDate is required`);
        if (!['debit', 'credit'].includes(type)) {
          throw new Error(`Line ${idx + 1}: transactionType must be debit or credit`);
        }
        if (isNaN(amount) || amount <= 0) {
          throw new Error(`Line ${idx + 1}: amount must be a positive number`);
        }
        if (!description) throw new Error(`Line ${idx + 1}: description is required`);

        return {
          transactionDate: date,
          valueDate: line.valueDate || line.value_date || null,
          transactionType: type as 'debit' | 'credit',
          amount,
          balanceAfter: line.balanceAfter !== undefined ? Number(line.balanceAfter) : (line.balance_after !== undefined ? Number(line.balance_after) : null),
          description,
          referenceNumber: line.referenceNumber || line.reference_number || line.ref || null,
          payeePayer: line.payeePayer || line.payee_payer || null,
        };
      })
    : [];

  return {
    companyId,
    bankAccountId,
    providerType: (body.providerType || body.provider_type || (body.rawCsvContent ? 'csv' : 'manual')).toLowerCase(),
    fileName: body.fileName || body.file_name || null,
    openingBalance: body.openingBalance !== undefined ? Number(body.openingBalance) : (body.opening_balance !== undefined ? Number(body.opening_balance) : null),
    closingBalance: body.closingBalance !== undefined ? Number(body.closingBalance) : (body.closing_balance !== undefined ? Number(body.closing_balance) : null),
    lines,
    rawCsvContent: body.rawCsvContent || body.raw_csv_content || null,
  };
}

export function validateReconciliationSessionStart(body: any): ReconciliationSessionStartDto {
  if (!body) throw new Error('Reconciliation session payload is required');
  const companyId = body.companyId || body.company_id;
  const bankAccountId = body.bankAccountId || body.bank_account_id;
  const statementDate = body.statementDate || body.statement_date;
  const statementOpeningBalance = Number(body.statementOpeningBalance ?? body.statement_opening_balance);
  const statementClosingBalance = Number(body.statementClosingBalance ?? body.statement_closing_balance);

  if (!companyId) throw new Error('companyId is required');
  if (!bankAccountId) throw new Error('bankAccountId is required');
  if (!statementDate) throw new Error('statementDate is required');
  if (isNaN(statementOpeningBalance)) throw new Error('statementOpeningBalance must be a valid number');
  if (isNaN(statementClosingBalance)) throw new Error('statementClosingBalance must be a valid number');

  return {
    companyId,
    bankAccountId,
    statementDate,
    statementOpeningBalance,
    statementClosingBalance,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function validateReconciliationManualMatch(body: any): ReconciliationManualMatchDto {
  if (!body) throw new Error('Reconciliation match payload is required');
  const companyId = body.companyId || body.company_id;
  const sessionId = body.sessionId || body.session_id;
  const bankTransactionId = body.bankTransactionId || body.bank_transaction_id;
  const matchedEntityType = body.matchedEntityType || body.matched_entity_type;
  const matchedEntityId = body.matchedEntityId || body.matched_entity_id;
  const matchedAmount = Number(body.matchedAmount ?? body.matched_amount);

  if (!companyId) throw new Error('companyId is required');
  if (!sessionId) throw new Error('sessionId is required');
  if (!bankTransactionId) throw new Error('bankTransactionId is required');
  if (!matchedEntityType) throw new Error('matchedEntityType is required');
  if (!matchedEntityId) throw new Error('matchedEntityId is required');
  if (isNaN(matchedAmount) || matchedAmount <= 0) throw new Error('matchedAmount must be greater than 0');

  const validTypes = ['customer_payment', 'supplier_payment', 'expense', 'journal_entry', 'bank_transfer'];
  if (!validTypes.includes(matchedEntityType)) {
    throw new Error(`Invalid matchedEntityType: ${matchedEntityType}`);
  }

  return {
    companyId,
    sessionId,
    bankTransactionId,
    matchedEntityType,
    matchedEntityId,
    matchedAmount,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function validateBankTransferCreate(body: any): BankTransferCreateDto {
  if (!body) throw new Error('Bank transfer payload is required');
  const companyId = body.companyId || body.company_id;
  const sourceAccountId = body.sourceAccountId || body.source_account_id;
  const destinationAccountId = body.destinationAccountId || body.destination_account_id;
  const amount = Number(body.amount);

  if (!companyId) throw new Error('companyId is required');
  if (!sourceAccountId) throw new Error('sourceAccountId is required');
  if (!destinationAccountId) throw new Error('destinationAccountId is required');
  if (sourceAccountId === destinationAccountId) {
    throw new Error('sourceAccountId and destinationAccountId must be different accounts');
  }
  if (isNaN(amount) || amount <= 0) {
    throw new Error('Transfer amount must be greater than 0');
  }

  const transferFee = Number(body.transferFee ?? body.transfer_fee ?? 0);
  if (isNaN(transferFee) || transferFee < 0) {
    throw new Error('transferFee must be non-negative');
  }

  return {
    companyId,
    sourceAccountId,
    destinationAccountId,
    amount,
    transferDate: body.transferDate || body.transfer_date || new Date().toISOString().split('T')[0],
    transferFee,
    feeAccountId: body.feeAccountId || body.fee_account_id || null,
    exchangeRate: body.exchangeRate !== undefined ? Number(body.exchangeRate) : 1.0,
    referenceNumber: body.referenceNumber || body.reference_number || null,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export interface AccountingSettingsDto {
  fiscalYearStartMonth?: number;
  accountingBaseCurrency?: string;
  decimalPrecision?: number;
  defaultPaymentTerms?: string;
  defaultDueDays?: number;
  allowFutureDatedTransactions?: boolean;
  allowSelfExpenseApproval?: boolean;
}

export function validateAccountingSettingsUpdate(body: any): AccountingSettingsDto {
  if (!body) throw new Error('Settings body is required');

  const startMonth = body.fiscalYearStartMonth ?? body.fiscal_year_start_month;
  if (startMonth !== undefined) {
    if (typeof startMonth !== 'number' || startMonth < 1 || startMonth > 12) {
      throw new Error('fiscalYearStartMonth must be an integer between 1 and 12');
    }
  }

  const precision = body.decimalPrecision ?? body.decimal_precision;
  if (precision !== undefined) {
    if (typeof precision !== 'number' || precision < 2 || precision > 4) {
      throw new Error('decimalPrecision must be between 2 and 4');
    }
  }

  const dueDays = body.defaultDueDays ?? body.default_due_days;
  if (dueDays !== undefined) {
    if (typeof dueDays !== 'number' || dueDays < 0) {
      throw new Error('defaultDueDays must be a non-negative integer');
    }
  }

  return {
    fiscalYearStartMonth: startMonth,
    accountingBaseCurrency: body.accountingBaseCurrency ?? body.accounting_base_currency,
    decimalPrecision: precision,
    defaultPaymentTerms: body.defaultPaymentTerms ?? body.default_payment_terms,
    defaultDueDays: dueDays,
    allowFutureDatedTransactions: body.allowFutureDatedTransactions ?? body.allow_future_dated_transactions,
    allowSelfExpenseApproval: body.allowSelfExpenseApproval ?? body.allow_self_expense_approval,
  };
}

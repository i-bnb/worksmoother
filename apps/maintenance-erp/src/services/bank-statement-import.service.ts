import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  BankStatementImportDto,
  ParsedBankStatementLineDto,
  validateBankStatementImport,
} from '../schemas/banking.schema.js';
import { DocumentNumberService } from './document-number.service.js';

export interface BankStatementParser {
  parse(input: string | any[]): ParsedBankStatementLineDto[];
}

export class CsvBankStatementParser implements BankStatementParser {
  parse(csvContent: string): ParsedBankStatementLineDto[] {
    if (!csvContent || typeof csvContent !== 'string') {
      throw new Error('CSV content must be a non-empty string');
    }

    const rawLines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (rawLines.length < 2) {
      throw new Error('CSV must contain a header line and at least one data row');
    }

    const header = rawLines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));

    const dateIdx = header.findIndex((h) => h.includes('date') && !h.includes('value'));
    const valDateIdx = header.findIndex((h) => h.includes('value') || h.includes('val_date'));
    const descIdx = header.findIndex((h) => h.includes('desc') || h.includes('narr') || h.includes('detail') || h.includes('particular'));
    const refIdx = header.findIndex((h) => h.includes('ref') || h.includes('chq') || h.includes('cheque') || h.includes('txn'));
    const debitIdx = header.findIndex((h) => h.includes('debit') || h.includes('withdrawal') || /\bdr\b/i.test(h));
    const creditIdx = header.findIndex((h) => h.includes('credit') || h.includes('deposit') || /\bcr\b/i.test(h));
    const amountIdx = header.findIndex((h) => h === 'amount');
    const typeIdx = header.findIndex((h) => h.includes('type'));
    const balIdx = header.findIndex((h) => h.includes('bal'));

    if (dateIdx === -1) throw new Error('CSV header missing "Date" column');
    if (descIdx === -1) throw new Error('CSV header missing "Description" / "Narration" column');
    if (debitIdx === -1 && creditIdx === -1 && amountIdx === -1) {
      throw new Error('CSV header missing Debit/Credit or Amount columns');
    }

    const parsedLines: ParsedBankStatementLineDto[] = [];

    for (let i = 1; i < rawLines.length; i++) {
      const row = this.parseCsvRow(rawLines[i]);
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const dateStr = row[dateIdx]?.trim();
      const descStr = row[descIdx]?.trim();
      const refStr = refIdx !== -1 ? row[refIdx]?.trim() : null;
      const valDateStr = valDateIdx !== -1 ? row[valDateIdx]?.trim() : null;
      const balStr = balIdx !== -1 ? row[balIdx]?.trim() : null;

      if (!dateStr || !descStr) continue;

      let transactionType: 'debit' | 'credit' = 'credit';
      let amountVal = 0;

      if (debitIdx !== -1 && creditIdx !== -1) {
        const debitRaw = row[debitIdx] ? parseFloat(row[debitIdx].replace(/[^0-9.-]/g, '')) : 0;
        const creditRaw = row[creditIdx] ? parseFloat(row[creditIdx].replace(/[^0-9.-]/g, '')) : 0;

        if (debitRaw > 0) {
          transactionType = 'debit';
          amountVal = debitRaw;
        } else if (creditRaw > 0) {
          transactionType = 'credit';
          amountVal = creditRaw;
        }
      } else if (amountIdx !== -1) {
        const amtRaw = parseFloat(row[amountIdx].replace(/[^0-9.-]/g, ''));
        if (typeIdx !== -1) {
          const typeStr = row[typeIdx]?.toLowerCase() || '';
          transactionType = typeStr.includes('dr') || typeStr.includes('debit') ? 'debit' : 'credit';
          amountVal = Math.abs(amtRaw);
        } else {
          transactionType = amtRaw < 0 ? 'debit' : 'credit';
          amountVal = Math.abs(amtRaw);
        }
      }

      if (amountVal > 0) {
        parsedLines.push({
          transactionDate: dateStr,
          valueDate: valDateStr || null,
          transactionType,
          amount: amountVal,
          balanceAfter: balStr ? parseFloat(balStr.replace(/[^0-9.-]/g, '')) : null,
          description: descStr,
          referenceNumber: refStr || null,
        });
      }
    }

    return parsedLines;
  }

  private parseCsvRow(rowStr: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < rowStr.length; i++) {
      const char = rowStr[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim().replace(/^["']|["']$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^["']|["']$/g, ''));
    return result;
  }
}

export class ManualBankStatementParser implements BankStatementParser {
  parse(lines: any[]): ParsedBankStatementLineDto[] {
    if (!Array.isArray(lines)) {
      throw new Error('Manual statement lines must be an array');
    }
    return lines;
  }
}

export class BankStatementImportService {
  /**
   * Ingests bank statements from CSV or structured manual entry.
   */
  static async importStatement(
    client: SupabaseClient,
    rawDto: BankStatementImportDto,
    userId?: string
  ) {
    const dto = validateBankStatementImport(rawDto);

    // 1. Resolve parser
    let parser: BankStatementParser;
    let parsedLines: ParsedBankStatementLineDto[] = [];

    if (dto.rawCsvContent) {
      parser = new CsvBankStatementParser();
      parsedLines = parser.parse(dto.rawCsvContent);
    } else {
      parser = new ManualBankStatementParser();
      parsedLines = parser.parse(dto.lines || []);
    }

    if (parsedLines.length === 0) {
      throw new Error('No valid transactions found in statement payload');
    }

    // 2. Validate Bank Account
    const { data: bankAccount, error: bErr } = await client
      .from('bank_accounts')
      .select('id, company_id, current_balance, statement_balance')
      .eq('company_id', dto.companyId)
      .eq('id', dto.bankAccountId)
      .single();

    if (bErr || !bankAccount) {
      throw new Error(`Bank account not found: ${bErr?.message || dto.bankAccountId}`);
    }

    // 3. Generate batch number
    const batchNumber = await DocumentNumberService.generate(client, dto.companyId, 'STMT');

    // 4. Calculate batch totals with Decimal precision
    let totalDebit = Decimal.zero();
    let totalCredit = Decimal.zero();

    for (const line of parsedLines) {
      const amt = new Decimal(line.amount);
      if (line.transactionType === 'debit') {
        totalDebit = totalDebit.plus(amt);
      } else {
        totalCredit = totalCredit.plus(amt);
      }
    }

    // 5. Create bank_statement_imports record
    const importPayload = {
      company_id: dto.companyId,
      bank_account_id: dto.bankAccountId,
      batch_number: batchNumber,
      provider_type: dto.providerType || 'csv',
      file_name: dto.fileName || null,
      status: 'imported',
      total_lines: parsedLines.length,
      total_debit: totalDebit.toNumber(),
      total_credit: totalCredit.toNumber(),
      opening_balance: dto.openingBalance !== null && dto.openingBalance !== undefined ? dto.openingBalance : bankAccount.statement_balance,
      closing_balance: dto.closingBalance !== null && dto.closingBalance !== undefined ? dto.closingBalance : null,
      created_by: userId || null,
    };

    const { data: importRecord, error: impErr } = await client
      .from('bank_statement_imports')
      .insert(importPayload)
      .select('*')
      .single();

    if (impErr || !importRecord) {
      throw new Error(`Failed to create statement import batch: ${impErr?.message}`);
    }

    // 6. Bulk insert bank_transactions lines
    const txPayloads = parsedLines.map((line) => ({
      company_id: dto.companyId,
      bank_account_id: dto.bankAccountId,
      statement_import_id: importRecord.id,
      transaction_date: line.transactionDate,
      value_date: line.valueDate || line.transactionDate,
      transaction_type: line.transactionType,
      amount: new Decimal(line.amount).toNumber(),
      balance_after: line.balanceAfter !== null && line.balanceAfter !== undefined ? Number(line.balanceAfter) : null,
      description: line.description,
      reference_number: line.referenceNumber || null,
      payee_payer: line.payeePayer || null,
      reconciliation_status: 'UNMATCHED',
    }));

    const { data: insertedTxs, error: txErr } = await client
      .from('bank_transactions')
      .insert(txPayloads)
      .select('*');

    if (txErr) {
      throw new Error(`Failed to insert bank transactions: ${txErr.message}`);
    }

    // 7. Update bank account statement balance if closing balance was provided
    if (dto.closingBalance !== null && dto.closingBalance !== undefined) {
      await client
        .from('bank_accounts')
        .update({
          statement_balance: dto.closingBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dto.bankAccountId);
    }

    return {
      batch: importRecord,
      transactionsCount: insertedTxs?.length || 0,
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
    };
  }
}

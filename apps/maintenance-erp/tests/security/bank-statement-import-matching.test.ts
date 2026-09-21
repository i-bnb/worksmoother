/**
 * =============================================================================
 * Phase 11 - Test Suite 2: Bank Statement Ingestion, Parsing & Batch Totals
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BankStatementImportService,
  CsvBankStatementParser,
} from '../../src/services/bank-statement-import.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Bank Statement Import & Ingestion', () => {
  const BANK_ACC_ID = 'bank-acc-import-101';

  it('correctly parses CSV statement lines with debit and credit columns', () => {
    const parser = new CsvBankStatementParser();
    const csvData = `Date,Description,Reference,Debit,Credit,Balance
2026-09-01,Client Wire Transfer,TXN-901,,15000.00,65000.00
2026-09-02,Vendor Material Payment,CHK-102,4200.50,,60799.50
2026-09-03,Office Internet Bill,UTL-334,150.00,,60649.50`;

    const parsed = parser.parse(csvData);
    expect(parsed.length).toBe(3);

    expect(parsed[0].transactionType).toBe('credit');
    expect(parsed[0].amount).toBe(15000.0);
    expect(parsed[0].referenceNumber).toBe('TXN-901');

    expect(parsed[1].transactionType).toBe('debit');
    expect(parsed[1].amount).toBe(4200.5);

    expect(parsed[2].transactionType).toBe('debit');
    expect(parsed[2].amount).toBe(150.0);
  });

  it('rejects CSV with missing required columns', () => {
    const parser = new CsvBankStatementParser();
    const invalidCsv = `InvalidHeader1,InvalidHeader2\nValue1,Value2`;
    expect(() => parser.parse(invalidCsv)).toThrow();
  });

  it('ingests CSV statement into import batch and unmatched transactions', async () => {
    const csvContent = `Date,Description,Reference,Debit,Credit,Balance
2026-09-10,Service AMC Payment,REC-7711,,25000.00,125000.00
2026-09-11,Parts Purchase,PO-8822,12000.00,,113000.00`;

    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'STMT-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: BANK_ACC_ID,
                      current_balance: 100000.0,
                      statement_balance: 100000.0,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'bank_statement_imports') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.batch_number).toBe('STMT-2026-0001');
              expect(payload.total_lines).toBe(2);
              expect(payload.total_credit).toBe(25000.0);
              expect(payload.total_debit).toBe(12000.0);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'import-batch-001', ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'bank_transactions') {
          return {
            insert: vi.fn().mockImplementation((txs: any[]) => {
              expect(txs.length).toBe(2);
              expect(txs[0].reconciliation_status).toBe('UNMATCHED');
              expect(txs[1].reconciliation_status).toBe('UNMATCHED');
              return {
                select: vi.fn().mockResolvedValue({
                  data: txs.map((t, idx) => ({ id: `tx-${idx + 1}`, ...t })),
                  error: null,
                }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await BankStatementImportService.importStatement(mockClient, {
      companyId: DEMO_COMPANY_A,
      bankAccountId: BANK_ACC_ID,
      rawCsvContent: csvContent,
      closingBalance: 113000.0,
    });

    expect(result.transactionsCount).toBe(2);
    expect(result.totalCredit).toBe(25000.0);
    expect(result.totalDebit).toBe(12000.0);
    expect(result.batch.batch_number).toBe('STMT-2026-0001');
  });
});

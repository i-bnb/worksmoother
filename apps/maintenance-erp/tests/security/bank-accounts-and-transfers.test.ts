/**
 * =============================================================================
 * Phase 11 - Test Suite 1: Bank Accounts, Masking & Atomic Inter-Bank Transfers
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { BankAccountService } from '../../src/services/bank-account.service.js';
import { BankTransferService } from '../../src/services/bank-transfer.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Bank Accounts & Atomic Transfers', () => {
  const SOURCE_ACC_ID = 'bank-acc-src-001';
  const DEST_ACC_ID = 'bank-acc-dst-002';
  const GL_SRC_ID = 'gl-acc-src-1010';
  const GL_DST_ID = 'gl-acc-dst-1020';
  const GL_FEE_ID = 'gl-acc-fee-5050';

  it('creates bank account and securely masks account number', async () => {
    const masked = BankAccountService.maskAccountNumber('123456789012');
    expect(masked).toBe('****9012');

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: SOURCE_ACC_ID,
                    company_id: DEMO_COMPANY_A,
                    account_name: 'Main Operating Account',
                    bank_name: 'HDFC Bank',
                    account_number_last4: '9012',
                    account_number_full: '123456789012',
                    opening_balance: 50000.0,
                    current_balance: 50000.0,
                    currency: 'INR',
                    is_active: true,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await BankAccountService.createBankAccount(mockClient, {
      companyId: DEMO_COMPANY_A,
      accountName: 'Main Operating Account',
      bankName: 'HDFC Bank',
      accountNumberFull: '123456789012',
      openingBalance: 50000.0,
      currency: 'INR',
    });

    expect(result.account_number_masked).toBe('****9012');
    expect(result.current_balance).toBe(50000.0);
  });

  it('rejects bank transfer if source and destination accounts are identical', async () => {
    const mockClient = {} as any;
    await expect(
      BankTransferService.executeTransfer(mockClient, {
        companyId: DEMO_COMPANY_A,
        sourceAccountId: SOURCE_ACC_ID,
        destinationAccountId: SOURCE_ACC_ID,
        amount: 1000.0,
      })
    ).rejects.toThrow('must be different accounts');
  });

  it('rejects bank transfer if source account has insufficient funds', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: SOURCE_ACC_ID,
                      account_name: 'HDFC Current',
                      current_balance: 500.0,
                      is_active: true,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    await expect(
      BankTransferService.executeTransfer(mockClient, {
        companyId: DEMO_COMPANY_A,
        sourceAccountId: SOURCE_ACC_ID,
        destinationAccountId: DEST_ACC_ID,
        amount: 2000.0,
      })
    ).rejects.toThrow('Insufficient funds');
  });

  it('executes atomic transfer with fee deduction and balancing GL journal entries', async () => {
    const updatedBalances: Record<string, number> = {};

    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'TRF-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'bank_accounts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                return {
                  eq: vi.fn().mockImplementation((col2: string, accId: string) => {
                    return {
                      single: vi.fn().mockImplementation(() => {
                        if (accId === SOURCE_ACC_ID) {
                          return Promise.resolve({
                            data: {
                              id: SOURCE_ACC_ID,
                              account_name: 'HDFC Current',
                              current_balance: 10000.0,
                              gl_account_id: GL_SRC_ID,
                              is_active: true,
                            },
                            error: null,
                          });
                        } else {
                          return Promise.resolve({
                            data: {
                              id: DEST_ACC_ID,
                              account_name: 'ICICI Savings',
                              current_balance: 2000.0,
                              gl_account_id: GL_DST_ID,
                              is_active: true,
                            },
                            error: null,
                          });
                        }
                      }),
                    };
                  }),
                };
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              return {
                eq: vi.fn().mockImplementation((col: string, accId: string) => {
                  updatedBalances[accId] = payload.current_balance;
                  return Promise.resolve({ data: null, error: null });
                }),
              };
            }),
          };
        }
        if (table === 'bank_transfers') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'trf-rec-001',
                    transfer_number: 'TRF-2026-0001',
                    amount: 5000.0,
                    transfer_fee: 25.0,
                    status: 'completed',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-trf-001', journal_number: 'JRN-2026-0001', status: 'posted' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify balancing journal lines: Total Debit = Total Credit
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(credit);
              expect(debit).toBe(5025.0); // 5000 dest + 25 fee
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await BankTransferService.executeTransfer(mockClient, {
      companyId: DEMO_COMPANY_A,
      sourceAccountId: SOURCE_ACC_ID,
      destinationAccountId: DEST_ACC_ID,
      amount: 5000.0,
      transferFee: 25.0,
      feeAccountId: GL_FEE_ID,
    });

    expect(result.sourceAccount.newBalance).toBe(4975.0); // 10000 - 5000 - 25
    expect(result.destinationAccount.newBalance).toBe(7000.0); // 2000 + 5000
    expect(updatedBalances[SOURCE_ACC_ID]).toBe(4975.0);
    expect(updatedBalances[DEST_ACC_ID]).toBe(7000.0);
    expect(result.journalEntryId).toBe('jrn-trf-001');
  });
});

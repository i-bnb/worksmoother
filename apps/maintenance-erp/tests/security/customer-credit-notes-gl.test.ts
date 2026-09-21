/**
 * =============================================================================
 * Phase 11 - Test Suite 4: Customer Credit Notes, Over-Credit Guard & GL Posting
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CreditDebitNoteService } from '../../src/services/credit-debit-note.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Customer Credit Notes & GL Integration', () => {
  const CUSTOMER_ID = 'cust-cn-301';
  const INVOICE_ID = 'inv-cn-301';
  const CN_ID = 'cn-301';
  const AR_ACCOUNT_ID = 'gl-ar-1200';
  const SALES_RETURN_ACC_ID = 'gl-rev-return-4100';
  const CGST_OUT_ID = 'gl-cgst-out-2210';
  const SGST_OUT_ID = 'gl-sgst-out-2220';

  it('rejects credit note that exceeds invoice grand total', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: CUSTOMER_ID, name: 'Apollo Diagnostics' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: INVOICE_ID, grand_total: 1000.0, status: 'issued' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ grand_total: 800.0 }], // 800 already credited
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    // Trying to credit 500 more (800 + 500 = 1300 > 1000)
    await expect(
      CreditDebitNoteService.createCustomerCreditNote(mockClient, {
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        invoiceId: INVOICE_ID,
        reason: 'Service dispute',
        lines: [
          {
            description: 'Disputed service charges',
            quantity: 1,
            unitPrice: 500.0,
          },
        ],
      })
    ).rejects.toThrow('cannot exceed invoice grand total');
  });

  it('creates credit note with GST calculations and posts balanced GL entries', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'CN-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: CUSTOMER_ID, name: 'Apollo Diagnostics' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'credit_notes') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.subtotal).toBe(10000.0);
              expect(payload.tax_amount).toBe(1800.0);
              expect(payload.grand_total).toBe(11800.0);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: CN_ID, ...payload },
                    error: null,
                  }),
                }),
              };
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: CN_ID,
                      credit_note_number: 'CN-2026-0001',
                      customer_id: CUSTOMER_ID,
                      subtotal: 10000.0,
                      grand_total: 11800.0,
                      credit_note_date: '2026-09-15',
                      is_posted_to_gl: false,
                      credit_note_lines: [
                        {
                          description: 'Returned Machine Spare Part',
                          line_total: 11800.0,
                          cgst_amount: 900.0,
                          sgst_amount: 900.0,
                          igst_amount: 0.0,
                        },
                      ],
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
        if (table === 'credit_note_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-cn-001', journal_number: 'JRN-2026-0002' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify double entry: Debit Sales Return (10000) + CGST (900) + SGST (900) = Credit AR (11800)
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(11800.0);
              expect(credit).toBe(11800.0);
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const createRes = await CreditDebitNoteService.createCustomerCreditNote(mockClient, {
      companyId: DEMO_COMPANY_A,
      customerId: CUSTOMER_ID,
      reason: 'Part Return',
      lines: [
        {
          description: 'Returned Machine Spare Part',
          quantity: 2,
          unitPrice: 5000.0,
          cgstRate: 9.0,
          sgstRate: 9.0,
        },
      ],
    });

    expect(createRes.creditNote.grand_total).toBe(11800.0);

    const postRes = await CreditDebitNoteService.postCustomerCreditNoteToGl(
      mockClient,
      DEMO_COMPANY_A,
      CN_ID,
      {
        salesReturnAccountId: SALES_RETURN_ACC_ID,
        arControlAccountId: AR_ACCOUNT_ID,
        cgstOutputAccountId: CGST_OUT_ID,
        sgstOutputAccountId: SGST_OUT_ID,
      }
    );

    expect(postRes.journalEntryId).toBe('jrn-cn-001');
  });

  it('applies credit note against an open customer invoice', async () => {
    let invoicePaid = 0;
    let invoiceStatus = 'issued';

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: CN_ID,
                      grand_total: 5000.0,
                      amount_applied: 0.0,
                      refunded_amount: 0.0,
                      amount_remaining: 5000.0,
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
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: INVOICE_ID,
                      grand_total: 10000.0,
                      amount_paid: invoicePaid,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              invoicePaid = payload.amount_paid;
              invoiceStatus = payload.status;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await CreditDebitNoteService.applyCustomerCreditNoteToInvoice(
      mockClient,
      DEMO_COMPANY_A,
      {
        creditNoteId: CN_ID,
        invoiceId: INVOICE_ID,
        amountToApply: 5000.0,
      }
    );

    expect(result.appliedAmount).toBe(5000.0);
    expect(result.invoiceRemainingDue).toBe(5000.0);
    expect(result.creditNoteRemainingBalance).toBe(0.0);
    expect(invoiceStatus).toBe('partially_paid');
  });
});

/**
 * =============================================================================
 * Phase 11 - Test Suite 5: Supplier Credit Notes & AP Settlement
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CreditDebitNoteService } from '../../src/services/credit-debit-note.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Supplier Credit Notes & Accounts Payable', () => {
  const SUPPLIER_ID = 'sup-scn-401';
  const BILL_ID = 'bill-scn-401';
  const SCN_ID = 'scn-401';
  const AP_ACCOUNT_ID = 'gl-ap-2010';
  const PURCHASE_RETURN_ACC_ID = 'gl-pur-return-5100';
  const ITC_ACC_ID = 'gl-itc-input-1310';

  it('creates supplier credit note and posts balancing GL entries', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'SCN-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_credit_notes') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.subtotal).toBe(8000.0);
              expect(payload.tax_amount).toBe(1440.0); // 18% IGST
              expect(payload.grand_total).toBe(9440.0);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: SCN_ID, ...payload },
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
                      id: SCN_ID,
                      credit_note_number: 'SCN-2026-0001',
                      supplier_id: SUPPLIER_ID,
                      subtotal: 8000.0,
                      tax_amount: 1440.0,
                      grand_total: 9440.0,
                      credit_note_date: '2026-09-20',
                      is_posted_to_gl: false,
                      supplier_credit_note_lines: [
                        {
                          description: 'Damaged compressor credit',
                          line_total: 9440.0,
                          igst_amount: 1440.0,
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
        if (table === 'supplier_credit_note_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-scn-001', journal_number: 'JRN-2026-0003' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify double entry: Debit AP (9440) = Credit Purchase Return (8000) + Credit ITC Reversal (1440)
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(9440.0);
              expect(credit).toBe(9440.0);
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const createRes = await CreditDebitNoteService.createSupplierCreditNote(mockClient, {
      companyId: DEMO_COMPANY_A,
      supplierId: SUPPLIER_ID,
      reason: 'Damaged compressor received',
      lines: [
        {
          description: 'Damaged compressor credit',
          quantity: 1,
          unitPrice: 8000.0,
          igstRate: 18.0,
        },
      ],
    });

    expect(createRes.supplierCreditNote.grand_total).toBe(9440.0);

    const postRes = await CreditDebitNoteService.postSupplierCreditNoteToGl(
      mockClient,
      DEMO_COMPANY_A,
      SCN_ID,
      {
        apControlAccountId: AP_ACCOUNT_ID,
        purchaseReturnAccountId: PURCHASE_RETURN_ACC_ID,
        itcAccountId: ITC_ACC_ID,
      }
    );

    expect(postRes.journalEntryId).toBe('jrn-scn-001');
  });

  it('applies supplier credit note against an open vendor bill', async () => {
    let billPaid = 0;
    let billStatus = 'posted';

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_credit_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: SCN_ID,
                      grand_total: 9440.0,
                      amount_applied: 0.0,
                      refunded_amount: 0.0,
                      amount_remaining: 9440.0,
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
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: BILL_ID,
                      grand_total: 15000.0,
                      amount_paid: billPaid,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => {
              billPaid = payload.amount_paid;
              billStatus = payload.status;
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await CreditDebitNoteService.applySupplierCreditNoteToBill(
      mockClient,
      DEMO_COMPANY_A,
      {
        supplierCreditNoteId: SCN_ID,
        billId: BILL_ID,
        amountToApply: 9440.0,
      }
    );

    expect(result.appliedAmount).toBe(9440.0);
    expect(result.billRemainingDue).toBe(5560.0); // 15000 - 9440
    expect(result.supplierCreditNoteRemainingBalance).toBe(0.0);
    expect(billStatus).toBe('partially_paid');
  });
});

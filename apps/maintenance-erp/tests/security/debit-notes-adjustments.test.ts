/**
 * =============================================================================
 * Phase 11 - Test Suite 6: Customer & Supplier Debit Notes & Adjustments
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CreditDebitNoteService } from '../../src/services/credit-debit-note.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: Debit Notes & Adjustments', () => {
  const CUSTOMER_ID = 'cust-dn-501';
  const SUPPLIER_ID = 'sup-dn-501';
  const CUST_DN_ID = 'cdn-501';
  const SUPP_DN_ID = 'sdn-501';

  it('creates customer debit note for supplementary charges and posts GL', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'DBN-2026-0001', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'debit_notes') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.party_type).toBe('customer');
              expect(payload.customer_id).toBe(CUSTOMER_ID);
              expect(payload.subtotal).toBe(3000.0);
              expect(payload.tax_amount).toBe(540.0); // 18% GST
              expect(payload.grand_total).toBe(3540.0);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: CUST_DN_ID, ...payload },
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
                      id: CUST_DN_ID,
                      debit_note_number: 'DBN-2026-0001',
                      party_type: 'customer',
                      customer_id: CUSTOMER_ID,
                      subtotal: 3000.0,
                      tax_amount: 540.0,
                      grand_total: 3540.0,
                      debit_note_date: '2026-09-21',
                      is_posted_to_gl: false,
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
        if (table === 'debit_note_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-cdn-001', journal_number: 'JRN-2026-0004' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify: Debit AR (3540) = Credit Revenue (3000) + Credit Output Tax (540)
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(3540.0);
              expect(credit).toBe(3540.0);
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const createRes = await CreditDebitNoteService.createDebitNote(mockClient, {
      companyId: DEMO_COMPANY_A,
      partyType: 'customer',
      customerId: CUSTOMER_ID,
      reason: 'Additional labor rate differential',
      lines: [
        {
          description: 'Emergency OT Labor Charges',
          quantity: 3,
          unitPrice: 1000.0,
          igstRate: 18.0,
        },
      ],
    });

    expect(createRes.debitNote.grand_total).toBe(3540.0);

    const postRes = await CreditDebitNoteService.postDebitNoteToGl(
      mockClient,
      DEMO_COMPANY_A,
      CUST_DN_ID,
      {
        receivableOrPayableAccountId: 'gl-ar-1200',
        incomeOrExpenseAccountId: 'gl-rev-service-4010',
        taxAccountId: 'gl-gst-out-2200',
      }
    );

    expect(postRes.journalEntryId).toBe('jrn-cdn-001');
  });

  it('creates supplier debit note for shortage deduction and posts GL', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'DBN-2026-0002', error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'debit_notes') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.party_type).toBe('supplier');
              expect(payload.supplier_id).toBe(SUPPLIER_ID);
              expect(payload.grand_total).toBe(2360.0); // 2000 + 360
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: SUPP_DN_ID, ...payload },
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
                      id: SUPP_DN_ID,
                      debit_note_number: 'DBN-2026-0002',
                      party_type: 'supplier',
                      supplier_id: SUPPLIER_ID,
                      subtotal: 2000.0,
                      tax_amount: 360.0,
                      grand_total: 2360.0,
                      debit_note_date: '2026-09-21',
                      is_posted_to_gl: false,
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
        if (table === 'debit_note_lines') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'journal_entries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'jrn-sdn-001', journal_number: 'JRN-2026-0005' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'journal_lines') {
          return {
            insert: vi.fn().mockImplementation((lines: any[]) => {
              // Verify: Debit AP (2360) = Credit Expense (2000) + Credit ITC Reversal (360)
              let debit = 0;
              let credit = 0;
              for (const l of lines) {
                debit += Number(l.debit || 0);
                credit += Number(l.credit || 0);
              }
              expect(debit).toBe(2360.0);
              expect(credit).toBe(2360.0);
              return Promise.resolve({ data: lines, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const createRes = await CreditDebitNoteService.createDebitNote(mockClient, {
      companyId: DEMO_COMPANY_A,
      partyType: 'supplier',
      supplierId: SUPPLIER_ID,
      reason: 'Material shortage deduction',
      lines: [
        {
          description: 'Shortage of electrical cables',
          quantity: 2,
          unitPrice: 1000.0,
          igstRate: 18.0,
        },
      ],
    });

    expect(createRes.debitNote.grand_total).toBe(2360.0);

    const postRes = await CreditDebitNoteService.postDebitNoteToGl(
      mockClient,
      DEMO_COMPANY_A,
      SUPP_DN_ID,
      {
        receivableOrPayableAccountId: 'gl-ap-2010',
        incomeOrExpenseAccountId: 'gl-exp-mat-5020',
        taxAccountId: 'gl-itc-input-1310',
      }
    );

    expect(postRes.journalEntryId).toBe('jrn-sdn-001');
  });
});

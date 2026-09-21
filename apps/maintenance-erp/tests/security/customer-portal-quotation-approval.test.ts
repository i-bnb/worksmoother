/**
 * =============================================================================
 * Test Suite 5: Customer Quotation Review & Approval Lifecycle
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerQuotationService } from '../../src/services/customer-quotation.service.js';
import {
  validateCustomerQuotationApprove,
  validateCustomerQuotationReject,
} from '../../src/schemas/customer-payment.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 9: Customer Quotation Review & Approval Lifecycle', () => {
  const CUSTOMER_ID = 'cust-quote-111';
  const QUOTE_ID = 'quote-999-888';

  describe('Validation Schemas', () => {
    it('validates quotation approval requires a valid signatory name', () => {
      const dto = validateCustomerQuotationApprove({
        signatoryName: 'Robert Johnson',
        notes: 'Approved for Q2 budget execution',
      });
      expect(dto.signatoryName).toBe('Robert Johnson');
      expect(dto.notes).toBe('Approved for Q2 budget execution');
    });

    it('rejects approval without signatory name', () => {
      expect(() => {
        validateCustomerQuotationApprove({
          signatoryName: '   ',
        });
      }).toThrow(/Signatory name is required/);
    });

    it('validates quotation rejection requires a rejection reason', () => {
      const dto = validateCustomerQuotationReject({
        rejectionReason: 'Scope exceeds current budget allocation',
      });
      expect(dto.rejectionReason).toBe('Scope exceeds current budget allocation');
    });

    it('rejects rejection payload without reason', () => {
      expect(() => {
        validateCustomerQuotationReject({
          rejectionReason: '',
        });
      }).toThrow(/A rejection reason is required/);
    });
  });

  describe('Approval Workflow & State Guards', () => {
    it('approves a sent quotation and records signatory details', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            quotation_id: QUOTE_ID,
            status: 'accepted',
            accepted_at: new Date().toISOString(),
          },
          error: null,
        }),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'quotations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: {
                          id: QUOTE_ID,
                          quotation_number: 'QT-2026-001',
                          status: 'sent',
                          valid_until: tomorrow,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
              update: updateMock,
            };
          }
          return {};
        }),
      } as any;

      const res = await CustomerQuotationService.approveQuotation(
        mockClient,
        DEMO_COMPANY_A,
        CUSTOMER_ID,
        QUOTE_ID,
        { signatoryName: 'Director John' }
      );

      expect(res.status).toBe('accepted');
    });

    it('rejects approval of an expired quotation', async () => {
      const pastDate = '2020-01-01';

      const mockClient = {
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Procedure fallback' } }),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'quotations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: {
                          id: QUOTE_ID,
                          quotation_number: 'QT-2026-001',
                          status: 'sent',
                          valid_until: pastDate,
                        },
                        error: null,
                      }),
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
        CustomerQuotationService.approveQuotation(
          mockClient,
          DEMO_COMPANY_A,
          CUSTOMER_ID,
          QUOTE_ID,
          { signatoryName: 'Director John' }
        )
      ).rejects.toThrow(/Quotation has expired/);
    });

    it('shields internal draft quotation from customer detail query', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'quotations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: QUOTE_ID,
                        status: 'draft', // Internal draft!
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
        CustomerQuotationService.getQuotationDetail(mockClient, CUSTOMER_ID, QUOTE_ID)
      ).rejects.toThrow(/Quotation is undergoing internal review and is not yet available/);
    });
  });
});

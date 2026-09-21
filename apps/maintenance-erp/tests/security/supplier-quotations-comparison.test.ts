/**
 * =============================================================================
 * Phase 10 - Test Suite 3: Supplier Quotations & Multi-Vendor Comparison Matrix
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { SupplierQuotationService } from '../../src/services/supplier-quotation.service.js';
import { validateSupplierQuotationCreate } from '../../src/schemas/procurement-request.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Supplier Quotations & Multi-Vendor Comparison Matrix', () => {
  const PR_ID = 'pr-uuid-201';
  const SUP_A_ID = 'sup-alpha-1';
  const SUP_B_ID = 'sup-beta-2';

  it('records a supplier quotation with item lines and computes grand total', async () => {
    const rawQuote = {
      companyId: DEMO_COMPANY_A,
      supplierId: SUP_A_ID,
      purchaseRequestId: PR_ID,
      quoteNumber: 'Q-ALPHA-888',
      validUntil: '2026-12-31',
      leadTimeDays: 5,
      freightCharges: 50.0,
      otherCharges: 10.0,
      warrantyTerms: '1 Year Manufacturer Warranty',
      paymentTerms: '30 Days Net',
      items: [
        {
          itemId: 'item-filter-01',
          description: 'HEPA Air Filter',
          quantity: 10,
          unitPrice: 45.0,
          taxRate: 5.0,
          discountAmount: 10.0,
        },
      ],
    };

    const validated = validateSupplierQuotationCreate(rawQuote);
    expect(validated.quoteNumber).toBe('Q-ALPHA-888');

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'supplier_quotations') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              // Subtotal: 10 * 45 = 450; Taxable: 450 - 10 = 440; Tax: 5% of 440 = 22
              // Grand: 450 - 10 + 22 + 50 (freight) + 10 (other) = 522
              expect(payload.subtotal).toBe(450);
              expect(payload.discount_amount).toBe(10);
              expect(payload.tax_amount).toBe(22);
              expect(payload.grand_total).toBe(522);

              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'sq-1',
                      ...payload,
                    },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'supplier_quotation_items') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const quote = await SupplierQuotationService.createSupplierQuotation(mockClient, validated, 'user-buyer-1');
    expect(quote.id).toBe('sq-1');
    expect(quote.grand_total).toBe(522);
  });

  it('generates a multi-vendor comparison matrix across multiple bids for a purchase request', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'sq-1',
                  quote_number: 'Q-ALPHA-888',
                  supplier_id: SUP_A_ID,
                  grand_total: 522.0,
                  freight_charges: 50.0,
                  lead_time_days: 5,
                  valid_until: '2026-12-31',
                  warranty_terms: '1 Year Warranty',
                  payment_terms: '30 Days Net',
                  suppliers: { id: SUP_A_ID, name: 'Alpha Supplies' },
                  supplier_quotation_items: [
                    {
                      item_id: 'item-filter-01',
                      description: 'HEPA Air Filter',
                      quantity: 10,
                      unit_price: 45.0,
                      line_total: 462.0,
                    },
                  ],
                },
                {
                  id: 'sq-2',
                  quote_number: 'Q-BETA-999',
                  supplier_id: SUP_B_ID,
                  grand_total: 480.0,
                  freight_charges: 0.0,
                  lead_time_days: 14,
                  valid_until: '2026-12-31',
                  warranty_terms: '6 Months Warranty',
                  payment_terms: 'Immediate',
                  suppliers: { id: SUP_B_ID, name: 'Beta Trading' },
                  supplier_quotation_items: [
                    {
                      item_id: 'item-filter-01',
                      description: 'HEPA Air Filter',
                      quantity: 10,
                      unit_price: 42.0,
                      line_total: 441.0,
                    },
                  ],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const matrix = await SupplierQuotationService.compareSupplierQuotations(
      mockClient,
      DEMO_COMPANY_A,
      PR_ID
    );

    expect(matrix.purchaseRequestId).toBe(PR_ID);
    expect(matrix.supplierSummaries).toHaveLength(2);
    expect(matrix.items).toHaveLength(1);

    const filterComparison = matrix.items[0];
    expect(filterComparison.description).toBe('HEPA Air Filter');
    expect(filterComparison.supplierQuotes).toHaveLength(2);

    // Alpha: 45.0 unit price, 5 days lead time
    const alphaQuote = filterComparison.supplierQuotes.find((q) => q.supplierId === SUP_A_ID);
    expect(alphaQuote?.unitPrice).toBe(45.0);
    expect(alphaQuote?.leadTimeDays).toBe(5);

    // Beta: 42.0 unit price, 14 days lead time
    const betaQuote = filterComparison.supplierQuotes.find((q) => q.supplierId === SUP_B_ID);
    expect(betaQuote?.unitPrice).toBe(42.0);
    expect(betaQuote?.leadTimeDays).toBe(14);
  });
});

/**
 * =============================================================================
 * Phase 10 - Test Suite 10: Supplier Statement, AP Aging & Procurement Analytics
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcurementReportingService } from '../../src/services/procurement-reporting.service.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Supplier Statement, AP Aging & Procurement Analytics', () => {
  const SUPPLIER_ID = 'sup-rep-1001';

  it('calculates AP aging analysis across current and overdue buckets', async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null, // trigger fallback calculation logic
        error: new Error('RPC not found in unit test'),
      }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'bill-1',
                  supplier_id: SUPPLIER_ID,
                  supplier: { id: SUPPLIER_ID, name: 'Acme Cooling', code: 'SUP-001' },
                  currency: 'AED',
                  grand_total: 1000.0,
                  amount_paid: 0.0,
                  amount_due: 1000.0,
                  due_date: '2026-04-15', // Current (future)
                },
                {
                  id: 'bill-2',
                  supplier_id: SUPPLIER_ID,
                  supplier: { id: SUPPLIER_ID, name: 'Acme Cooling', code: 'SUP-001' },
                  currency: 'AED',
                  grand_total: 2000.0,
                  amount_paid: 0.0,
                  amount_due: 2000.0,
                  due_date: '2026-02-15', // Overdue by ~45 days (bucket 31-60)
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const aging = await ProcurementReportingService.getAgingAnalysis(mockClient, {
      companyId: DEMO_COMPANY_A,
      asOfDate: '2026-04-01',
    });

    expect(aging.totalPayable).toBe(3000.0);
    expect(aging.summary.current).toBe(1000.0);
    expect(aging.summary.days31To60).toBe(2000.0);
    expect(aging.buckets).toHaveLength(1);
    expect(aging.buckets[0].supplierName).toBe('Acme Cooling');
  });

  it('generates a chronological statement of accounts with running balance', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'suppliers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: SUPPLIER_ID, name: 'Apex Engineering', code: 'APEX', currency: 'AED' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_bills') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  neq: vi.fn().mockResolvedValue({
                    data: [{ grand_total: 5000.0 }], // Prior billed before fromDate
                    error: null,
                  }),
                }),
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      order: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'b-101',
                            bill_number: 'BILL-101',
                            bill_date: '2026-03-05',
                            grand_total: 3000.0,
                            notes: 'Parts supply',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  is: vi.fn().mockResolvedValue({
                    data: [{ amount: 2000.0 }], // Prior paid before fromDate -> Opening = 5000 - 2000 = 3000
                    error: null,
                  }),
                }),
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      order: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'p-101',
                            payment_number: 'PAY-101',
                            payment_date: '2026-03-10',
                            amount: 1500.0,
                            payment_type: 'standard',
                            notes: 'Bank transfer',
                          },
                        ],
                        error: null,
                      }),
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

    const statement = await ProcurementReportingService.getSupplierStatement(
      mockClient,
      SUPPLIER_ID,
      '2026-03-01',
      '2026-03-31'
    );

    expect(statement.supplierName).toBe('Apex Engineering');
    expect(statement.openingBalance).toBe(3000.0); // 5000 - 2000
    expect(statement.totalBilled).toBe(3000.0);
    expect(statement.totalPaid).toBe(1500.0);
    expect(statement.closingBalance).toBe(4500.0); // 3000 + 3000 - 1500 = 4500
    expect(statement.transactions).toHaveLength(2);
    expect(statement.transactions[0].type).toBe('BILL');
    expect(statement.transactions[1].type).toBe('PAYMENT');
  });

  it('computes procurement spend analytics categorized by vendor category and top spenders', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'po-1',
                  grand_total: 40000.0,
                  supplier_id: 'sup-hvac-1',
                  supplier: { id: 'sup-hvac-1', name: 'Carrier Middle East', category: 'HVAC' },
                },
                {
                  id: 'po-2',
                  grand_total: 10000.0,
                  supplier_id: 'sup-elec-2',
                  supplier: { id: 'sup-elec-2', name: 'Schneider Electric', category: 'ELECTRICAL' },
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const analytics = await ProcurementReportingService.getProcurementSpendAnalytics(
      mockClient,
      DEMO_COMPANY_A
    );

    expect(analytics.totalSpend).toBe(50000.0);
    expect(analytics.totalOrders).toBe(2);
    expect(analytics.byCategory).toHaveLength(2);

    const hvacCat = analytics.byCategory.find((c) => c.category === 'HVAC');
    expect(hvacCat?.amount).toBe(40000.0);
    expect(hvacCat?.percentage).toBe(80.0);

    const topSup = analytics.topSuppliers[0];
    expect(topSup.supplierName).toBe('Carrier Middle East');
    expect(topSup.spend).toBe(40000.0);
    expect(topSup.percentage).toBe(80.0);
  });

  it('computes supplier performance metrics (on-time delivery and quality acceptance rates)', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'po-1', expected_delivery_date: '2026-03-10' },
                    { id: 'po-2', expected_delivery_date: '2026-03-20' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'goods_receipts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'grn-1',
                    receipt_date: '2026-03-08', // On-time! (<= 2026-03-10)
                    po_id: 'po-1',
                    lines: [
                      { accepted_quantity: 10, rejected_quantity: 0, damaged_quantity: 0, received_quantity: 10 },
                    ],
                  },
                  {
                    id: 'grn-2',
                    receipt_date: '2026-03-25', // Late! (> 2026-03-20)
                    po_id: 'po-2',
                    lines: [
                      { accepted_quantity: 8, rejected_quantity: 2, damaged_quantity: 0, received_quantity: 10 }, // 8 accepted out of 10
                    ],
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const metrics = await ProcurementReportingService.getSupplierPerformanceMetrics(
      mockClient,
      SUPPLIER_ID
    );

    expect(metrics.totalOrders).toBe(2);
    expect(metrics.evaluatedReceipts).toBe(2);
    expect(metrics.onTimeDeliveryRate).toBe(50.0); // 1 on-time out of 2 = 50%
    expect(metrics.qualityAcceptanceRate).toBe(90.0); // 18 accepted out of 20 = 90%
  });
});

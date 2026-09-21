/**
 * =============================================================================
 * Test Suite 3: Customer Dashboard & Asset Service History
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerDashboardService } from '../../src/services/customer-dashboard.service.js';
import { CustomerAssetPortalService } from '../../src/services/customer-asset-portal.service.js';

describe('Phase 9: Customer Dashboard & Asset Service History', () => {
  const CUSTOMER_ID = 'cust-100-200-300';

  describe('Dashboard Summary Calculations', () => {
    it('aggregates asset, ticket, work order, and invoice metrics accurately', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ count: 12, error: null }),
                }),
              }),
            };
          }
          if (table === 'service_requests') {
            return {
              select: vi.fn().mockImplementation((_cols: string, opts: any) => {
                if (opts?.count === 'exact') {
                  return {
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ count: 3, error: null }),
                    }),
                  };
                }
                return {
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'req-1',
                            request_number: 'REQ-001',
                            description: 'AC cooling issue in server room',
                            status: 'new',
                            created_at: '2026-03-01T10:00:00Z',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                };
              }),
            };
          }
          if (table === 'work_orders') {
            return {
              select: vi.fn().mockImplementation((_cols: string, opts: any) => {
                if (opts?.count === 'exact') {
                  return {
                    eq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ count: 2, error: null }),
                    }),
                  };
                }
                return {
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'wo-1',
                            work_order_number: 'WO-001',
                            description: 'Routine maintenance',
                            status: 'in_progress',
                            updated_at: '2026-03-02T11:00:00Z',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                };
              }),
            };
          }
          if (table === 'quotations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
                }),
              }),
            };
          }
          if (table === 'invoices') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [
                      { id: 'inv-1', amount_due: 1500.5, status: 'issued' },
                      { id: 'inv-2', amount_due: 2499.5, status: 'overdue' },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'amc_contracts') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
                }),
              }),
            };
          }
          if (table === 'rental_contracts') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ count: 1, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      const summary = await CustomerDashboardService.getDashboardSummary(mockClient, CUSTOMER_ID);

      expect(summary.activeAssetsCount).toBe(12);
      expect(summary.openRequestsCount).toBe(3);
      expect(summary.inProgressWorkOrdersCount).toBe(2);
      expect(summary.pendingQuotationsCount).toBe(1);
      expect(summary.unpaidInvoicesCount).toBe(2);
      expect(summary.totalOutstandingAmount).toBe(4000);
      expect(summary.activeAmcContractsCount).toBe(2);
      expect(summary.activeRentalsCount).toBe(1);
      expect(summary.recentActivity.length).toBeGreaterThan(0);
      expect(summary.recentActivity[0].type).toBe('work_order'); // Newer timestamp
    });
  });

  describe('Customer Asset Catalog & Detail', () => {
    it('accurately resolves warranty status and AMC coverage for customer equipment', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'asset-101',
                        customer_id: CUSTOMER_ID,
                        asset_code: 'EQ-AHU-01',
                        name: 'Rooftop Air Handling Unit',
                        asset_type: 'HVAC',
                        brand: 'Daikin',
                        model: 'AHU-3000',
                        serial_number: 'DK998877',
                        capacity: 50,
                        capacity_unit: 'TR',
                        refrigerant_type: 'R410A',
                        warranty_start_date: '2025-01-01',
                        warranty_end_date: '2028-12-31', // Active
                        status: 'active',
                        site_id: 'site-1',
                        customer_sites: { id: 'site-1', name: 'Main Campus' },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'amc_contract_assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        contract_id: 'amc-1',
                        amc_contracts: {
                          contract_number: 'AMC-2026-001',
                          status: 'active',
                          start_date: '2026-01-01',
                          end_date: '2027-01-01',
                        },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      const detail = await CustomerAssetPortalService.getAssetDetail(
        mockClient,
        CUSTOMER_ID,
        'asset-101'
      );

      expect(detail.assetCode).toBe('EQ-AHU-01');
      expect(detail.isUnderWarranty).toBe(true);
      expect(detail.hasActiveAmc).toBe(true);
      expect(detail.amcContractNumber).toBe('AMC-2026-001');
      expect(detail.capacity).toBe(50);
      expect(detail.refrigerantType).toBe('R410A');
    });
  });
});

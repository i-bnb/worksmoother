/**
 * =============================================================================
 * Test Suite 9: Customer Response Serialization & Secret Shielding
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerWorkOrderService } from '../../src/services/customer-work-order.service.js';
import { CustomerQuotationService } from '../../src/services/customer-quotation.service.js';
import { CustomerAssetPortalService } from '../../src/services/customer-asset-portal.service.js';

describe('Phase 9: Customer Response Serialization & Secret Shielding', () => {
  const CUSTOMER_ID = 'cust-sec-999';

  describe('Work Order & Service Report Secret Shielding', () => {
    it('guarantees that service visit reports NEVER expose parts purchase costs or labor hourly rates', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'work_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'wo-1',
                        work_order_number: 'WO-001',
                        status: 'completed',
                        priority: 'high',
                        description: 'Compressor replacement',
                        // Internal sensitive fields present in DB:
                        total_estimated_cost: 4500.0,
                        internal_labor_cost: 1200.0,
                        internal_markup_percent: 35.0,
                        notes: 'INTERNAL: Client was frustrated, discount applied from margin pool',
                        customer_sites: { name: 'HQ Building' },
                        customer_assets: { name: 'Chiller Alpha' },
                        service_feedback: [],
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'service_visit_reports') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'report-1',
                      report_number: 'REP-001',
                      problem_reported: 'Compressor burnt out',
                      diagnosis: 'Motor winding insulation failure',
                      work_performed: 'Replaced hermetic compressor and filter drier',
                      completion_status: 'resolved',
                      // Internal parts summary in DB contains internal purchase costs:
                      parts_used_summary: JSON.stringify([
                        {
                          item_id: 'item-101',
                          name: 'Copeland Scroll Compressor 5HP',
                          quantity: 1,
                          unit_cost: 1800.0, // Internal purchase cost!
                          markup_percentage: 40, // Internal markup!
                          supplier_name: 'Gulf Refrigeration Supplies LLC', // Internal supplier!
                        },
                        {
                          item_id: 'item-202',
                          name: 'Liquid Line Filter Drier',
                          quantity: 1,
                          unit_cost: 45.0,
                          markup_percentage: 50,
                        },
                      ]),
                      // Internal labor details in DB:
                      labor_summary: JSON.stringify([
                        { technician_id: 'emp-1', hourly_wage: 65.0, hours_spent: 4.5 },
                      ]),
                      created_at: '2026-03-15T16:00:00Z',
                      employees: { first_name: 'Ahmed', last_name: 'Khan' },
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

      const report = await CustomerWorkOrderService.getServiceReport(
        mockClient,
        CUSTOMER_ID,
        'wo-1'
      );

      // Verify customer-safe structure
      expect(report.reportNumber).toBe('REP-001');
      expect(report.technicianName).toBe('Ahmed Khan');
      expect(report.partsReplaced.length).toBe(2);

      // Customer only receives partName and quantity:
      expect(report.partsReplaced[0].partName).toBe('Copeland Scroll Compressor 5HP');
      expect(report.partsReplaced[0].quantity).toBe(1);

      // SENSITIVE DATA LEAK AUDIT:
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('unit_cost');
      expect(serialized).not.toContain('1800');
      expect(serialized).not.toContain('markup_percentage');
      expect(serialized).not.toContain('supplier_name');
      expect(serialized).not.toContain('Gulf Refrigeration Supplies LLC');
      expect(serialized).not.toContain('hourly_wage');
      expect(serialized).not.toContain('65.0');
    });

    it('guarantees that work order detail DTO never leaks estimated cost or private notes', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'work_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'wo-2',
                        work_order_number: 'WO-002',
                        status: 'scheduled',
                        priority: 'medium',
                        description: 'AHU filter replacement',
                        total_estimated_cost: 350.0,
                        internal_labor_cost: 150.0,
                        notes: 'SECRET_FLAG: High risk customer',
                        customer_sites: { name: 'Main Campus', address: 'JAFZA' },
                        customer_assets: { name: 'AHU-01', asset_code: 'AHU01' },
                        service_appointments: [],
                        service_feedback: [],
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

      const wo = await CustomerWorkOrderService.getWorkOrderDetail(mockClient, CUSTOMER_ID, 'wo-2');
      const serialized = JSON.stringify(wo);

      expect(wo.workOrderNumber).toBe('WO-002');
      expect(serialized).not.toContain('total_estimated_cost');
      expect(serialized).not.toContain('350');
      expect(serialized).not.toContain('SECRET_FLAG');
      expect(serialized).not.toContain('High risk customer');
    });
  });

  describe('Quotation & Asset Secret Shielding', () => {
    it('guarantees that quotation detail DTO only exposes customer rates and zero supplier info', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'quotations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'q-1',
                        quotation_number: 'QT-100',
                        version: 1,
                        quotation_date: '2026-03-01',
                        valid_until: '2026-04-01',
                        currency: 'AED',
                        subtotal: 1000,
                        discount_amount: 50,
                        tax_amount: 47.5,
                        grand_total: 997.5,
                        status: 'sent',
                        // Database line with internal supplier cost:
                        quotation_lines: [
                          {
                            id: 'line-1',
                            line_type: 'service',
                            description: 'Preventive HVAC service',
                            quantity: 1,
                            unit_price: 1000,
                            discount_amount: 50,
                            tax_amount: 47.5,
                            total_amount: 997.5,
                            purchase_cost: 400, // Secret purchase cost
                            margin: 600, // Secret margin
                          },
                        ],
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

      const q = await CustomerQuotationService.getQuotationDetail(mockClient, CUSTOMER_ID, 'q-1');
      const serialized = JSON.stringify(q);

      expect(serialized).not.toContain('purchase_cost');
      expect(serialized).not.toContain('margin');
      expect(serialized).not.toContain('400');
    });

    it('guarantees customer asset detail DTO does not leak acquisition cost or depreciation schedule', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'asset-1',
                        asset_code: 'EQ-001',
                        name: 'Boiler 1',
                        asset_type: 'Boiler',
                        status: 'active',
                        site_id: 's-1',
                        purchase_price: 85000, // Internal acquisition cost
                        residual_value: 10000,
                        depreciation_method: 'straight_line',
                        customer_sites: { id: 's-1', name: 'Factory' },
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
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      const asset = await CustomerAssetPortalService.getAssetDetail(mockClient, CUSTOMER_ID, 'asset-1');
      const serialized = JSON.stringify(asset);

      expect(serialized).not.toContain('purchase_price');
      expect(serialized).not.toContain('85000');
      expect(serialized).not.toContain('depreciation_method');
      expect(serialized).not.toContain('straight_line');
    });
  });
});

/**
 * =============================================================================
 * Phase 10 - Test Suite 1: Supplier Master Lifecycle & Audit Trail
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { SupplierService } from '../../src/services/supplier.service.js';
import { validateSupplierCreate, validateSupplierStatusChange } from '../../src/schemas/supplier.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Supplier Master Lifecycle & Audit Trail', () => {
  const SUPPLIER_ID = 'sup-uuid-001';

  it('validates and creates a new supplier with unique code enforcement', async () => {
    const rawSupplier = {
      companyId: DEMO_COMPANY_A,
      code: 'SUP-ACME-01',
      name: 'Acme Spare Parts LLC',
      legalName: 'Acme Commercial Spare Parts LLC',
      supplierType: 'PARTS_SUPPLIER',
      category: 'HVAC',
      currency: 'AED',
      creditLimit: 50000,
      status: 'ACTIVE',
      contacts: [
        {
          name: 'John Doe',
          email: 'john@acme.com',
          phone: '+971501234567',
          isPrimary: true,
        },
      ],
    };

    const validated = validateSupplierCreate(rawSupplier);
    expect(validated.code).toBe('SUP-ACME-01');
    expect(validated.status).toBe('ACTIVE');

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'suppliers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: SUPPLIER_ID,
                    ...validated,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_contacts') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const supplier = await SupplierService.createSupplier(mockClient, validated, 'user-admin-1');
    expect(supplier.id).toBe(SUPPLIER_ID);
    expect(supplier.name).toBe('Acme Spare Parts LLC');
  });

  it('rejects duplicate supplier code within the same company', async () => {
    const validated = validateSupplierCreate({
      companyId: DEMO_COMPANY_A,
      code: 'SUP-DUPLICATE',
      name: 'Duplicate Inc',
    });

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'existing-id', code: 'SUP-DUPLICATE' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      SupplierService.createSupplier(mockClient, validated, 'user-admin-1')
    ).rejects.toThrow('already exists in this company');
  });

  it('tracks supplier lifecycle status transitions with mandatory reason in audit history', async () => {
    const statusDto = validateSupplierStatusChange({
      status: 'BLACKLISTED',
      reason: 'Failed multiple quality inspections and delivered counterfeit parts',
    });

    let historyInserted = false;
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'suppliers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: SUPPLIER_ID, status: 'ACTIVE', is_active: true },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: SUPPLIER_ID, status: 'BLACKLISTED', is_active: false },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'supplier_status_history') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              historyInserted = true;
              expect(payload.previous_status).toBe('ACTIVE');
              expect(payload.new_status).toBe('BLACKLISTED');
              expect(payload.change_reason).toContain('counterfeit');
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }
        return {};
      }),
    } as any;

    const updated = await SupplierService.changeSupplierStatus(
      mockClient,
      DEMO_COMPANY_A,
      SUPPLIER_ID,
      statusDto,
      'user-auditor-9'
    );

    expect(updated.status).toBe('BLACKLISTED');
    expect(updated.is_active).toBe(false);
    expect(historyInserted).toBe(true);
  });

  it('maps an item to supplier catalog with pricing and lead times', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'sp-1',
                supplier_id: SUPPLIER_ID,
                item_id: 'item-fan-01',
                standard_purchase_price: 250.0,
                min_order_quantity: 5,
                lead_time_days: 3,
                is_preferred: true,
              },
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const mapping = await SupplierService.mapProduct(mockClient, {
      companyId: DEMO_COMPANY_A,
      supplierId: SUPPLIER_ID,
      itemId: 'item-fan-01',
      standardPurchasePrice: 250.0,
      minOrderQuantity: 5,
      leadTimeDays: 3,
      isPreferred: true,
    });

    expect(mapping.is_preferred).toBe(true);
    expect(mapping.standard_purchase_price).toBe(250.0);
  });
});

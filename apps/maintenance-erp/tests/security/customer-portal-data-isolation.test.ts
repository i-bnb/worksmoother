/**
 * =============================================================================
 * Test Suite 2: Customer Data Isolation & Cross-Tenant Leak Prevention
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerPortalAuthService } from '../../src/services/customer-portal-auth.service.js';
import { CustomerAssetPortalService } from '../../src/services/customer-asset-portal.service.js';
import { CustomerWorkOrderService } from '../../src/services/customer-work-order.service.js';
import { CustomerQuotationService } from '../../src/services/customer-quotation.service.js';
import { CustomerPaymentService } from '../../src/services/customer-payment.service.js';

describe('Phase 9: Customer Data Isolation & Cross-Tenant Leak Prevention', () => {
  const CUSTOMER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const CUSTOMER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  describe('Customer Organization Access Boundary', () => {
    it('strictly prevents Customer A from accessing Customer B customer context', async () => {
      // Mock client that returns user mapped to Customer A
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_portal_users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'portal-user-1',
                        customer_id: CUSTOMER_A,
                        portal_role: 'CUSTOMER_ADMIN',
                        is_active: true,
                        customers: { id: CUSTOMER_A, name: 'Client A Corp', is_active: true },
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

      // Accessing Customer A should succeed
      const allowed = await CustomerPortalAuthService.verifyCustomerAccess(
        mockClient,
        'user-1',
        CUSTOMER_A
      );
      expect(allowed.customerId).toBe(CUSTOMER_A);

      // Accessing Customer B MUST fail with Cross-tenant violation
      await expect(
        CustomerPortalAuthService.verifyCustomerAccess(mockClient, 'user-1', CUSTOMER_B)
      ).rejects.toThrow(/Cross-tenant violation/);
    });

    it('rejects access if the customer organization is deactivated', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_portal_users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'portal-user-2',
                        customer_id: CUSTOMER_A,
                        portal_role: 'CUSTOMER_ADMIN',
                        is_active: true,
                        customers: { id: CUSTOMER_A, name: 'Client Suspended', is_active: false },
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
        CustomerPortalAuthService.getPortalUser(mockClient, 'user-suspended')
      ).rejects.toThrow(/Customer account is deactivated or suspended/);
    });
  });

  describe('Horizontal Data Isolation Across Domain Services', () => {
    it('customer asset query strictly includes customer_id filter', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: eqMock,
            order: orderMock,
          }),
        }),
      } as any;

      await CustomerAssetPortalService.listAssets(mockClient, CUSTOMER_A);
      expect(eqMock).toHaveBeenCalledWith('customer_id', CUSTOMER_A);
      expect(eqMock).not.toHaveBeenCalledWith('customer_id', CUSTOMER_B);
    });

    it('work order listing strictly isolates queries by customer_id', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: eqMock,
            order: orderMock,
          }),
        }),
      } as any;

      await CustomerWorkOrderService.listWorkOrders(mockClient, CUSTOMER_A);
      expect(eqMock).toHaveBeenCalledWith('customer_id', CUSTOMER_A);
    });

    it('quotations query strictly scopes by customer_id and filters out internal drafts', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const inMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: eqMock,
            in: inMock,
            order: orderMock,
          }),
        }),
      } as any;

      await CustomerQuotationService.listQuotations(mockClient, CUSTOMER_A);
      expect(eqMock).toHaveBeenCalledWith('customer_id', CUSTOMER_A);
      expect(inMock).toHaveBeenCalledWith('status', ['sent', 'approved', 'accepted', 'rejected', 'expired']);
    });

    it('invoice query strictly filters by customer_id and hides drafts', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const notMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: eqMock,
            not: notMock,
            order: orderMock,
          }),
        }),
      } as any;

      await CustomerPaymentService.listInvoices(mockClient, CUSTOMER_A);
      expect(eqMock).toHaveBeenCalledWith('customer_id', CUSTOMER_A);
      expect(notMock).toHaveBeenCalledWith('status', 'eq', 'draft');
    });
  });
});

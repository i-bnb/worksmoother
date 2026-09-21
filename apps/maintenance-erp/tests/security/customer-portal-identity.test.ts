/**
 * =============================================================================
 * Test Suite 1: Customer Portal Identity, Roles & Permissions
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getAdminClient,
  getAnonClient,
  DEMO_COMPANY_A,
  DEMO_COMPANY_B,
} from './helpers.js';
import { CustomerPortalAuthService } from '../../src/services/customer-portal-auth.service.js';
import {
  validatePortalUserInvite,
  validatePortalProfileUpdate,
  validatePortalSiteRequest,
  CustomerSafePortalUserDto,
} from '../../src/schemas/customer-portal-auth.schema.js';
import { CustomerPortalProfileApiController } from '../../src/api/customer-portal-profile.js';

describe('Phase 9: Customer Portal Identity, Roles & Permissions', () => {
  const admin = getAdminClient();
  const anon = getAnonClient();

  const dummyCustomerUser: CustomerSafePortalUserDto = {
    id: '11111111-2222-3333-4444-555555555555',
    customerId: 'cust-1111-2222-3333-444444444444',
    email: 'client.admin@facilitycare.com',
    fullName: 'Jane Doe',
    portalRole: 'CUSTOMER_ADMIN',
    isActive: true,
  };

  const dummyViewerUser: CustomerSafePortalUserDto = {
    id: '22222222-3333-4444-5555-666666666666',
    customerId: 'cust-1111-2222-3333-444444444444',
    email: 'client.viewer@facilitycare.com',
    fullName: 'John Smith',
    portalRole: 'CUSTOMER_VIEWER',
    isActive: true,
  };

  const dummyAccountsUser: CustomerSafePortalUserDto = {
    id: '33333333-4444-5555-6666-777777777777',
    customerId: 'cust-1111-2222-3333-444444444444',
    email: 'client.accounts@facilitycare.com',
    fullName: 'Alice Finance',
    portalRole: 'CUSTOMER_ACCOUNTS',
    isActive: true,
  };

  describe('Portal Roles & Privilege Gating', () => {
    it('allows CUSTOMER_ADMIN to satisfy any required role', () => {
      expect(() => {
        CustomerPortalAuthService.requirePortalRole(dummyCustomerUser, ['CUSTOMER_ACCOUNTS']);
      }).not.toThrow();

      expect(() => {
        CustomerPortalAuthService.requirePortalRole(dummyCustomerUser, ['CUSTOMER_SERVICE']);
      }).not.toThrow();
    });

    it('permits authorized role and throws for unauthorized role', () => {
      // CUSTOMER_ACCOUNTS attempting finance action
      expect(() => {
        CustomerPortalAuthService.requirePortalRole(dummyAccountsUser, ['CUSTOMER_ACCOUNTS']);
      }).not.toThrow();

      // CUSTOMER_VIEWER attempting quote approval
      expect(() => {
        CustomerPortalAuthService.requirePortalRole(dummyViewerUser, ['CUSTOMER_ADMIN', 'CUSTOMER_ACCOUNTS']);
      }).toThrow(/Insufficient privileges/);
    });
  });

  describe('Customer Portal Invitation & Profile Validation', () => {
    it('validates customer user invite DTO and normalizes email and role', () => {
      const invite = validatePortalUserInvite({
        companyId: DEMO_COMPANY_A,
        customerId: 'cust-100',
        email: '  User.Invite@Domain.Com  ',
        role: 'customer_admin',
        fullName: 'New Admin',
      });

      expect(invite.email).toBe('user.invite@domain.com');
      expect(invite.role).toBe('CUSTOMER_ADMIN');
      expect(invite.companyId).toBe(DEMO_COMPANY_A);
    });

    it('rejects invalid portal roles during invitation', () => {
      expect(() => {
        validatePortalUserInvite({
          companyId: DEMO_COMPANY_A,
          customerId: 'cust-100',
          email: 'valid@example.com',
          role: 'SUPER_ADMIN',
        });
      }).toThrow(/Invalid portal role/);
    });

    it('validates site request parameters correctly', () => {
      const siteReq = validatePortalSiteRequest({
        companyId: DEMO_COMPANY_A,
        customerId: 'cust-100',
        name: 'Warehouse B3',
        address: 'Plot 45, Al Quoz Industrial Area 3',
        city: 'Dubai',
      });

      expect(siteReq.name).toBe('Warehouse B3');
      expect(siteReq.country).toBe('AE');
    });

    it('rejects site request missing mandatory fields', () => {
      expect(() => {
        validatePortalSiteRequest({
          companyId: DEMO_COMPANY_A,
          customerId: 'cust-100',
          name: '',
          address: '',
        });
      }).toThrow(/Site name is required/);
    });
  });

  describe('Portal Profile Controller Safety', () => {
    it('returns 400 when customerId is missing from profile request', async () => {
      const res = await CustomerPortalProfileApiController.getProfile(anon, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/customerId is required/);
    });

    it('returns 400 when customerId is missing from sites listing', async () => {
      const res = await CustomerPortalProfileApiController.getSites(anon, {
        query: {},
      });
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/customerId is required/);
    });
  });
});

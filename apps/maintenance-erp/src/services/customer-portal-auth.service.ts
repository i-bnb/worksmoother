/**
 * =============================================================================
 * Customer Portal Authentication & Identity Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PortalRole,
  PortalUserInviteDto,
  CustomerSafePortalUserDto,
} from '../schemas/customer-portal-auth.schema.js';

export class CustomerPortalAuthService {
  /**
   * Resolves the active customer portal user profile for a given user ID.
   * Ensures both the portal user record and the customer organization are active.
   */
  static async getPortalUser(
    client: SupabaseClient,
    userId: string
  ): Promise<CustomerSafePortalUserDto | null> {
    if (!userId) return null;

    // 1. Check customer_portal_users
    const { data: portalUser, error } = await client
      .from('customer_portal_users')
      .select(`
        id,
        customer_id,
        contact_id,
        user_id,
        portal_role,
        is_active,
        last_login_at,
        customers (
          id,
          name,
          is_active
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve customer portal user: ${error.message}`);
    }

    if (portalUser) {
      const cust = portalUser.customers as any;
      if (!cust || !cust.is_active) {
        throw new Error('Customer account is deactivated or suspended');
      }

      return {
        id: portalUser.id,
        customerId: portalUser.customer_id,
        customerName: cust?.name,
        contactId: portalUser.contact_id,
        email: '',
        portalRole: portalUser.portal_role as PortalRole,
        isActive: portalUser.is_active,
        lastLoginAt: portalUser.last_login_at,
      };
    }

    // 2. Fallback to profiles table with customer_id link
    const { data: profile } = await client
      .from('profiles')
      .select('id, customer_id, email, full_name, is_active, customers (id, name, is_active)')
      .eq('id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (profile && profile.customer_id) {
      const cust = profile.customers as any;
      if (!cust || !cust.is_active) {
        throw new Error('Customer account is deactivated or suspended');
      }

      return {
        id: profile.id,
        customerId: profile.customer_id,
        customerName: cust?.name,
        email: profile.email,
        fullName: profile.full_name,
        portalRole: 'CUSTOMER_VIEWER',
        isActive: profile.is_active,
      };
    }

    return null;
  }

  /**
   * Asserts that the authenticated user has access to the target customer account.
   */
  static async verifyCustomerAccess(
    client: SupabaseClient,
    userId: string,
    targetCustomerId: string
  ): Promise<CustomerSafePortalUserDto> {
    const portalUser = await this.getPortalUser(client, userId);
    if (!portalUser) {
      throw new Error('Access denied: User is not authorized for customer portal');
    }

    if (portalUser.customerId !== targetCustomerId) {
      throw new Error('Cross-tenant violation: Access denied to target customer data');
    }

    return portalUser;
  }

  /**
   * Asserts that the user possesses at least one of the required portal roles.
   * Note: CUSTOMER_ADMIN automatically satisfies all permission checks.
   */
  static requirePortalRole(
    portalUser: CustomerSafePortalUserDto,
    allowedRoles: PortalRole[]
  ): void {
    if (portalUser.portalRole === 'CUSTOMER_ADMIN') {
      return;
    }

    if (!allowedRoles.includes(portalUser.portalRole)) {
      throw new Error(
        `Insufficient privileges: Action requires one of [${allowedRoles.join(', ')}], current role is ${portalUser.portalRole}`
      );
    }
  }

  /**
   * Invites or registers a customer contact as a portal user.
   */
  static async invitePortalUser(
    client: SupabaseClient,
    dto: PortalUserInviteDto,
    inviterUserId?: string
  ): Promise<{ id: string; invitationToken: string }> {
    const invitationToken = `tok_${Math.random().toString(36).substring(2)}_${Date.now()}`;

    // Verify customer exists
    const { data: customer, error: custErr } = await client
      .from('customers')
      .select('id, company_id, is_active')
      .eq('id', dto.customerId)
      .eq('company_id', dto.companyId)
      .single();

    if (custErr || !customer) {
      throw new Error('Customer not found');
    }

    if (!customer.is_active) {
      throw new Error('Cannot invite users to an inactive customer account');
    }

    const { data, error } = await client
      .from('customer_portal_users')
      .insert({
        company_id: dto.companyId,
        customer_id: dto.customerId,
        contact_id: dto.contactId || null,
        user_id: inviterUserId || '00000000-0000-0000-0000-000000000000',
        portal_role: dto.role,
        is_active: true,
        invitation_token: invitationToken,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to invite customer portal user: ${error.message}`);
    }

    return {
      id: data.id,
      invitationToken,
    };
  }
}

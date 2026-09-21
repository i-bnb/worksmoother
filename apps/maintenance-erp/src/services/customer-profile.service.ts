/**
 * =============================================================================
 * Customer Profile & Sites Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PortalProfileUpdateDto,
  PortalSiteRequestDto,
} from '../schemas/customer-portal-auth.schema.js';

export interface CustomerSafeProfileDto {
  id: string;
  name: string;
  code: string;
  customerType: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  currency: string;
  isActive: boolean;
  primaryContact?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    designation?: string | null;
  } | null;
  sitesCount: number;
}

export interface CustomerSafeSiteDto {
  id: string;
  name: string;
  code?: string | null;
  address: string;
  city?: string | null;
  state?: string | null;
  country: string;
  postalCode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  isActive: boolean;
  assetsCount?: number;
}

export class CustomerProfileService {
  /**
   * Retrieves the customer profile and primary contact information.
   */
  static async getProfile(
    client: SupabaseClient,
    customerId: string
  ): Promise<CustomerSafeProfileDto> {
    if (!customerId) {
      throw new Error('customerId is required');
    }

    const { data: customer, error } = await client
      .from('customers')
      .select(`
        id,
        name,
        code,
        customer_type,
        tax_id,
        email,
        phone,
        currency,
        is_active,
        customer_contacts (
          id,
          name,
          email,
          phone,
          designation,
          is_primary,
          is_active
        ),
        customer_sites (
          id
        )
      `)
      .eq('id', customerId)
      .single();

    if (error || !customer) {
      throw new Error(`Customer profile not found: ${error?.message || 'Unknown error'}`);
    }

    const contacts = (customer.customer_contacts as any[]) || [];
    const primaryContact = contacts.find((c) => c.is_primary && c.is_active) || contacts[0] || null;
    const sites = (customer.customer_sites as any[]) || [];

    return {
      id: customer.id,
      name: customer.name,
      code: customer.code,
      customerType: customer.customer_type,
      taxId: customer.tax_id,
      email: customer.email,
      phone: customer.phone,
      currency: customer.currency || 'AED',
      isActive: customer.is_active,
      primaryContact: primaryContact
        ? {
            id: primaryContact.id,
            name: primaryContact.name,
            email: primaryContact.email,
            phone: primaryContact.phone,
            designation: primaryContact.designation,
          }
        : null,
      sitesCount: sites.length,
    };
  }

  /**
   * Updates allowed customer profile contact information.
   */
  static async updateProfile(
    client: SupabaseClient,
    customerId: string,
    dto: PortalProfileUpdateDto
  ): Promise<void> {
    if (!customerId) throw new Error('customerId is required');

    const updatePayload: Record<string, any> = {};
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.email !== undefined) updatePayload.email = dto.email;

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await client
        .from('customers')
        .update(updatePayload)
        .eq('id', customerId);

      if (error) {
        throw new Error(`Failed to update customer profile: ${error.message}`);
      }
    }
  }

  /**
   * Retrieves registered service sites for the customer.
   */
  static async getSites(
    client: SupabaseClient,
    customerId: string
  ): Promise<CustomerSafeSiteDto[]> {
    if (!customerId) throw new Error('customerId is required');

    const { data: sites, error } = await client
      .from('customer_sites')
      .select(`
        id,
        name,
        code,
        address,
        city,
        state,
        country,
        postal_code,
        contact_name,
        contact_phone,
        contact_email,
        is_active,
        customer_assets (id)
      `)
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      throw new Error(`Failed to list customer sites: ${error.message}`);
    }

    return (sites || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      address: s.address,
      city: s.city,
      state: s.state,
      country: s.country,
      postalCode: s.postal_code,
      contactName: s.contact_name,
      contactPhone: s.contact_phone,
      contactEmail: s.contact_email,
      isActive: s.is_active,
      assetsCount: s.customer_assets?.length || 0,
    }));
  }

  /**
   * Submits a request for a new service site / address.
   */
  static async requestSite(
    client: SupabaseClient,
    dto: PortalSiteRequestDto,
    userId?: string
  ): Promise<{ id: string; name: string }> {
    const { data, error } = await client
      .from('customer_sites')
      .insert({
        company_id: dto.companyId,
        customer_id: dto.customerId,
        name: dto.name,
        address: dto.address,
        city: dto.city || null,
        state: dto.state || null,
        country: dto.country || 'AE',
        postal_code: dto.postalCode || null,
        contact_name: dto.contactName || null,
        contact_phone: dto.contactPhone || null,
        notes: dto.notes ? `[Portal Request]: ${dto.notes}` : '[Portal Request]',
        is_active: true,
        created_by: userId || null,
      })
      .select('id, name')
      .single();

    if (error) {
      throw new Error(`Failed to request service site: ${error.message}`);
    }

    return {
      id: data.id,
      name: data.name,
    };
  }
}

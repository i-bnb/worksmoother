/**
 * =============================================================================
 * Customer Portal Authentication & Identity Schemas
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

export type PortalRole =
  | 'CUSTOMER_ADMIN'
  | 'CUSTOMER_SERVICE'
  | 'CUSTOMER_ACCOUNTS'
  | 'CUSTOMER_VIEWER';

export interface PortalUserInviteDto {
  companyId: string;
  customerId: string;
  contactId?: string | null;
  email: string;
  role: PortalRole;
  fullName?: string;
}

export interface PortalProfileUpdateDto {
  name?: string;
  phone?: string;
  email?: string;
  designation?: string;
  preferredLanguage?: string;
}

export interface PortalSiteRequestDto {
  companyId: string;
  customerId: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
}

export interface CustomerSafePortalUserDto {
  id: string;
  customerId: string;
  customerName?: string;
  contactId?: string | null;
  email: string;
  fullName?: string;
  portalRole: PortalRole;
  isActive: boolean;
  lastLoginAt?: string | null;
}

export function validatePortalUserInvite(body: any): PortalUserInviteDto {
  if (!body) throw new Error('Portal user invite body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const email = (body.email || '').trim().toLowerCase();
  const role = (body.role || body.portalRole || body.portal_role || 'CUSTOMER_VIEWER').toUpperCase();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!email || !email.includes('@')) throw new Error('Valid email address is required');

  const validRoles: PortalRole[] = [
    'CUSTOMER_ADMIN',
    'CUSTOMER_SERVICE',
    'CUSTOMER_ACCOUNTS',
    'CUSTOMER_VIEWER',
  ];
  if (!validRoles.includes(role as PortalRole)) {
    throw new Error(`Invalid portal role: ${role}. Must be one of ${validRoles.join(', ')}`);
  }

  return {
    companyId,
    customerId,
    contactId: body.contactId || body.contact_id || null,
    email,
    role: role as PortalRole,
    fullName: body.fullName || body.full_name || body.name,
  };
}

export function validatePortalProfileUpdate(body: any): PortalProfileUpdateDto {
  if (!body) throw new Error('Profile update body is required');

  return {
    name: body.name?.trim(),
    phone: body.phone?.trim(),
    email: body.email ? body.email.trim().toLowerCase() : undefined,
    designation: body.designation?.trim(),
    preferredLanguage: body.preferredLanguage || body.preferred_language || 'en',
  };
}

export function validatePortalSiteRequest(body: any): PortalSiteRequestDto {
  if (!body) throw new Error('Site request body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const name = (body.name || '').trim();
  const address = (body.address || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!name) throw new Error('Site name is required');
  if (!address) throw new Error('Site physical address is required');

  return {
    companyId,
    customerId,
    name,
    address,
    city: body.city?.trim(),
    state: body.state?.trim(),
    country: body.country?.trim() || 'AE',
    postalCode: body.postalCode || body.postal_code,
    contactName: body.contactName || body.contact_name,
    contactPhone: body.contactPhone || body.contact_phone,
    notes: body.notes?.trim(),
  };
}

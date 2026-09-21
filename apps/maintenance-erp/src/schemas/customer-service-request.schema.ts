/**
 * =============================================================================
 * Customer Service Request Schemas
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

export type CustomerRequestPriority = 'low' | 'medium' | 'high' | 'urgent';
export type PreferredTimeSlot = 'morning' | 'afternoon' | 'evening' | 'anytime';

export interface CustomerServiceRequestCreateDto {
  companyId: string;
  customerId: string;
  siteId: string;
  assetId?: string | null;
  serviceTypeId?: string | null;
  title: string;
  description: string;
  priority: CustomerRequestPriority;
  preferredDate?: string | null;
  preferredTimeSlot?: PreferredTimeSlot;
  attachmentUrls?: string[];
  contactName?: string | null;
  contactPhone?: string | null;
}

export interface CustomerServiceRequestCancelDto {
  reason: string;
}

export interface CustomerSafeServiceRequestDto {
  id: string;
  requestNumber: string;
  customerId: string;
  siteId: string;
  siteName?: string;
  assetId?: string | null;
  assetName?: string | null;
  assetCode?: string | null;
  title: string;
  description: string;
  priority: CustomerRequestPriority;
  status: string;
  source: string;
  preferredDate?: string | null;
  preferredTimeSlot?: string | null;
  attachmentUrls: string[];
  convertedWorkOrderId?: string | null;
  workOrderNumber?: string | null;
  workOrderStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function validateCustomerServiceRequestCreate(body: any): CustomerServiceRequestCreateDto {
  if (!body) throw new Error('Service request body is required');
  const companyId = body.companyId || body.company_id;
  const customerId = body.customerId || body.customer_id;
  const siteId = body.siteId || body.site_id;
  const title = (body.title || '').trim();
  const description = (body.description || '').trim();
  const rawPriority = (body.priority || 'medium').toLowerCase();
  const rawSlot = (body.preferredTimeSlot || body.preferred_time_slot || 'anytime').toLowerCase();

  if (!companyId) throw new Error('companyId is required');
  if (!customerId) throw new Error('customerId is required');
  if (!siteId) throw new Error('siteId is required');
  if (!title) throw new Error('Service request title is required');
  if (!description) throw new Error('Service request description is required');

  const validPriorities: CustomerRequestPriority[] = ['low', 'medium', 'high', 'urgent'];
  if (!validPriorities.includes(rawPriority as CustomerRequestPriority)) {
    throw new Error(`Invalid priority: ${rawPriority}. Must be one of ${validPriorities.join(', ')}`);
  }

  const validSlots: PreferredTimeSlot[] = ['morning', 'afternoon', 'evening', 'anytime'];
  if (!validSlots.includes(rawSlot as PreferredTimeSlot)) {
    throw new Error(`Invalid preferred time slot: ${rawSlot}. Must be one of ${validSlots.join(', ')}`);
  }

  // Validate attachments
  let attachmentUrls: string[] = [];
  const rawAttachments = body.attachmentUrls || body.attachment_urls || body.attachments;
  if (Array.isArray(rawAttachments)) {
    if (rawAttachments.length > 5) {
      throw new Error('Maximum 5 attachments are allowed per service request');
    }
    attachmentUrls = rawAttachments.map((url: any) => {
      const u = String(url).trim();
      if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('/storage/')) {
        throw new Error(`Invalid attachment URL: ${u}`);
      }
      return u;
    });
  }

  return {
    companyId,
    customerId,
    siteId,
    assetId: body.assetId || body.asset_id || null,
    serviceTypeId: body.serviceTypeId || body.service_type_id || null,
    title,
    description,
    priority: rawPriority as CustomerRequestPriority,
    preferredDate: body.preferredDate || body.preferred_date || null,
    preferredTimeSlot: rawSlot as PreferredTimeSlot,
    attachmentUrls,
    contactName: body.contactName || body.contact_name || null,
    contactPhone: body.contactPhone || body.contact_phone || null,
  };
}

export function validateCustomerServiceRequestCancel(body: any): CustomerServiceRequestCancelDto {
  if (!body) throw new Error('Cancellation body is required');
  const reason = (body.reason || '').trim();
  if (!reason) throw new Error('A cancellation reason is required');
  return { reason };
}

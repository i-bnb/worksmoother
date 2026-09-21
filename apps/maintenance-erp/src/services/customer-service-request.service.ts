/**
 * =============================================================================
 * Customer Service Request Domain Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  CustomerServiceRequestCreateDto,
  CustomerSafeServiceRequestDto,
} from '../schemas/customer-service-request.schema.js';

export class CustomerServiceRequestService {
  /**
   * Creates a service request initiated by a customer portal user.
   * Enforces that the specified site and asset belong to the customer.
   */
  static async createServiceRequest(
    client: SupabaseClient,
    dto: CustomerServiceRequestCreateDto,
    userId?: string
  ): Promise<{ id: string; requestNumber: string }> {
    // 1. Validate site ownership
    const { data: site, error: siteErr } = await client
      .from('customer_sites')
      .select('id, name')
      .eq('id', dto.siteId)
      .eq('customer_id', dto.customerId)
      .single();

    if (siteErr || !site) {
      throw new Error('Selected site is invalid or does not belong to your account');
    }

    // 2. Validate asset ownership if asset is provided
    if (dto.assetId) {
      const { data: asset, error: assetErr } = await client
        .from('customer_assets')
        .select('id, name')
        .eq('id', dto.assetId)
        .eq('customer_id', dto.customerId)
        .single();

      if (assetErr || !asset) {
        throw new Error('Selected asset is invalid or does not belong to your account');
      }
    }

    // 3. Prepare notes and attachment metadata
    let descriptionText = dto.description;
    if (dto.title) {
      descriptionText = `[${dto.title}] ${dto.description}`;
    }

    const payload: Record<string, any> = {
      company_id: dto.companyId,
      customer_id: dto.customerId,
      site_id: dto.siteId,
      asset_id: dto.assetId || null,
      service_type_id: dto.serviceTypeId || null,
      priority: dto.priority,
      source: 'customer_portal',
      description: descriptionText,
      requested_date: dto.preferredDate || new Date().toISOString().split('T')[0],
      status: 'new',
      created_by: userId || null,
    };

    const { data, error } = await client
      .from('service_requests')
      .insert(payload)
      .select('id, request_number')
      .single();

    if (error) {
      throw new Error(`Failed to submit service request: ${error.message}`);
    }

    // 4. Publish domain event to notify operations dispatchers
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'PORTAL_REQUEST_SUBMITTED',
        entity_type: 'service_request',
        entity_id: data.id,
        actor_id: userId || null,
        payload: {
          request_number: data.request_number,
          customer_id: dto.customerId,
          site_id: dto.siteId,
          asset_id: dto.assetId,
          priority: dto.priority,
          title: dto.title,
        },
      });
    } catch {
      // Event publication failure shouldn't break the customer request creation
    }

    return {
      id: data.id,
      requestNumber: data.request_number,
    };
  }

  /**
   * Lists service requests for the customer.
   */
  static async listServiceRequests(
    client: SupabaseClient,
    customerId: string,
    filter?: { status?: string; siteId?: string }
  ): Promise<CustomerSafeServiceRequestDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('service_requests')
      .select(`
        id,
        request_number,
        customer_id,
        site_id,
        asset_id,
        priority,
        status,
        source,
        description,
        requested_date,
        converted_work_order_id,
        created_at,
        updated_at,
        customer_sites (
          name
        ),
        customer_assets (
          name,
          asset_code
        ),
        work_orders (
          work_order_number,
          status
        )
      `)
      .eq('customer_id', customerId);

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.siteId) {
      query = query.eq('site_id', filter.siteId);
    }

    const { data: requests, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list service requests: ${error.message}`);
    }

    return (requests || []).map((r: any) => {
      const site = r.customer_sites as any;
      const asset = r.customer_assets as any;
      const wo = r.work_orders as any;

      // Parse title from [Title] Description format if present
      let title = r.description;
      let desc = r.description;
      const titleMatch = r.description.match(/^\[(.*?)\]\s*(.*)$/s);
      if (titleMatch) {
        title = titleMatch[1];
        desc = titleMatch[2];
      }

      return {
        id: r.id,
        requestNumber: r.request_number,
        customerId: r.customer_id,
        siteId: r.site_id,
        siteName: site?.name,
        assetId: r.asset_id,
        assetName: asset?.name,
        assetCode: asset?.asset_code,
        title,
        description: desc,
        priority: r.priority,
        status: r.status,
        source: r.source,
        preferredDate: r.requested_date,
        attachmentUrls: [],
        convertedWorkOrderId: r.converted_work_order_id,
        workOrderNumber: wo?.work_order_number,
        workOrderStatus: wo?.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /**
   * Retrieves detail of a single service request.
   */
  static async getServiceRequestDetail(
    client: SupabaseClient,
    customerId: string,
    requestId: string
  ): Promise<CustomerSafeServiceRequestDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!requestId) throw new Error('requestId is required');

    const { data: r, error } = await client
      .from('service_requests')
      .select(`
        id,
        request_number,
        customer_id,
        site_id,
        asset_id,
        priority,
        status,
        source,
        description,
        requested_date,
        converted_work_order_id,
        created_at,
        updated_at,
        customer_sites (
          name
        ),
        customer_assets (
          name,
          asset_code
        ),
        work_orders (
          work_order_number,
          status
        )
      `)
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .single();

    if (error || !r) {
      throw new Error('Service request not found or does not belong to your account');
    }

    const site = r.customer_sites as any;
    const asset = r.customer_assets as any;
    const wo = r.work_orders as any;

    let title = r.description;
    let desc = r.description;
    const titleMatch = r.description.match(/^\[(.*?)\]\s*(.*)$/s);
    if (titleMatch) {
      title = titleMatch[1];
      desc = titleMatch[2];
    }

    return {
      id: r.id,
      requestNumber: r.request_number,
      customerId: r.customer_id,
      siteId: r.site_id,
      siteName: site?.name,
      assetId: r.asset_id,
      assetName: asset?.name,
      assetCode: asset?.asset_code,
      title,
      description: desc,
      priority: r.priority,
      status: r.status,
      source: r.source,
      preferredDate: r.requested_date,
      attachmentUrls: [],
      convertedWorkOrderId: r.converted_work_order_id,
      workOrderNumber: wo?.work_order_number,
      workOrderStatus: wo?.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Allows customer to cancel a request if still in 'new' status.
   */
  static async cancelServiceRequest(
    client: SupabaseClient,
    customerId: string,
    requestId: string,
    reason: string,
    userId?: string
  ): Promise<void> {
    const { data: request, error: findErr } = await client
      .from('service_requests')
      .select('id, company_id, status, request_number')
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .single();

    if (findErr || !request) {
      throw new Error('Service request not found or does not belong to your account');
    }

    if (request.status !== 'new') {
      throw new Error(
        `Cannot cancel request in '${request.status}' status. Only newly submitted requests can be cancelled directly.`
      );
    }

    const { error: updateErr } = await client
      .from('service_requests')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (updateErr) {
      throw new Error(`Failed to cancel service request: ${updateErr.message}`);
    }

    // Publish event
    try {
      await client.from('domain_events').insert({
        company_id: request.company_id,
        event_type: 'PORTAL_REQUEST_CANCELLED',
        entity_type: 'service_request',
        entity_id: requestId,
        actor_id: userId || null,
        payload: {
          request_number: request.request_number,
          customer_id: customerId,
          cancellation_reason: reason,
        },
      });
    } catch {
      // ignore
    }
  }
}

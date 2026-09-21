/**
 * =============================================================================
 * Customer Asset Portal & Service History Service
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerSafeAssetListItemDto {
  id: string;
  assetCode: string;
  name: string;
  assetType: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  siteId: string;
  siteName?: string;
  status: string;
  warrantyEndDate?: string | null;
  isUnderWarranty: boolean;
}

export interface CustomerSafeAssetDetailDto extends CustomerSafeAssetListItemDto {
  capacity?: number | null;
  capacityUnit?: string | null;
  refrigerantType?: string | null;
  installationDate?: string | null;
  warrantyStartDate?: string | null;
  qrCode?: string | null;
  hasActiveAmc: boolean;
  amcContractNumber?: string | null;
}

export interface CustomerSafeAssetServiceHistoryDto {
  assetId: string;
  assetName: string;
  assetCode: string;
  workOrders: Array<{
    id: string;
    workOrderNumber: string;
    status: string;
    priority: string;
    description: string;
    scheduledStart?: string | null;
    completedAt?: string | null;
    serviceReportNumber?: string | null;
    workPerformed?: string | null;
    partsReplaced?: string[];
  }>;
}

export class CustomerAssetPortalService {
  /**
   * Lists equipment and assets belonging strictly to the customer.
   * Internal acquisition costs and markup notes are completely excluded.
   */
  static async listAssets(
    client: SupabaseClient,
    customerId: string,
    filter?: { siteId?: string; status?: string; search?: string }
  ): Promise<CustomerSafeAssetListItemDto[]> {
    if (!customerId) throw new Error('customerId is required');

    let query = client
      .from('customer_assets')
      .select(`
        id,
        asset_code,
        name,
        asset_type,
        category,
        brand,
        model,
        serial_number,
        site_id,
        status,
        warranty_end_date,
        customer_sites (
          id,
          name
        )
      `)
      .eq('customer_id', customerId);

    if (filter?.siteId) {
      query = query.eq('site_id', filter.siteId);
    }

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.search) {
      query = query.or(`name.ilike.%${filter.search}%,asset_code.ilike.%${filter.search}%,serial_number.ilike.%${filter.search}%`);
    }

    const { data: assets, error } = await query.order('name');

    if (error) {
      throw new Error(`Failed to list customer assets: ${error.message}`);
    }

    const today = new Date().toISOString().split('T')[0];

    return (assets || []).map((a: any) => {
      const site = a.customer_sites as any;
      const isUnderWarranty = Boolean(a.warranty_end_date && a.warranty_end_date >= today);

      return {
        id: a.id,
        assetCode: a.asset_code,
        name: a.name,
        assetType: a.asset_type,
        category: a.category,
        brand: a.brand,
        model: a.model,
        serialNumber: a.serial_number,
        siteId: a.site_id,
        siteName: site?.name || 'Main Site',
        status: a.status,
        warrantyEndDate: a.warranty_end_date,
        isUnderWarranty,
      };
    });
  }

  /**
   * Retrieves asset details with warranty and AMC contract coverage.
   */
  static async getAssetDetail(
    client: SupabaseClient,
    customerId: string,
    assetId: string
  ): Promise<CustomerSafeAssetDetailDto> {
    if (!customerId) throw new Error('customerId is required');
    if (!assetId) throw new Error('assetId is required');

    const { data: asset, error } = await client
      .from('customer_assets')
      .select(`
        id,
        customer_id,
        asset_code,
        name,
        asset_type,
        category,
        brand,
        model,
        serial_number,
        capacity,
        capacity_unit,
        refrigerant_type,
        installation_date,
        warranty_start_date,
        warranty_end_date,
        status,
        qr_code,
        site_id,
        customer_sites (
          id,
          name
        )
      `)
      .eq('id', assetId)
      .eq('customer_id', customerId)
      .single();

    if (error || !asset) {
      throw new Error('Asset not found or does not belong to your account');
    }

    const today = new Date().toISOString().split('T')[0];
    const isUnderWarranty = Boolean(asset.warranty_end_date && asset.warranty_end_date >= today);
    const site = asset.customer_sites as any;

    // Check AMC contract coverage if amc_contract_assets exists
    let hasActiveAmc = false;
    let amcContractNumber: string | null = null;
    try {
      const { data: amcData } = await client
        .from('amc_contract_assets')
        .select(`
          contract_id,
          amc_contracts (
            contract_number,
            status,
            start_date,
            end_date
          )
        `)
        .eq('asset_id', assetId)
        .limit(1);

      if (amcData && amcData.length > 0) {
        const contract = (amcData[0] as any).amc_contracts;
        if (contract && contract.status === 'active' && contract.end_date >= today) {
          hasActiveAmc = true;
          amcContractNumber = contract.contract_number;
        }
      }
    } catch {
      hasActiveAmc = false;
    }

    return {
      id: asset.id,
      assetCode: asset.asset_code,
      name: asset.name,
      assetType: asset.asset_type,
      category: asset.category,
      brand: asset.brand,
      model: asset.model,
      serialNumber: asset.serial_number,
      siteId: asset.site_id,
      siteName: site?.name || 'Main Site',
      status: asset.status,
      warrantyEndDate: asset.warranty_end_date,
      warrantyStartDate: asset.warranty_start_date,
      installationDate: asset.installation_date,
      capacity: asset.capacity ? Number(asset.capacity) : null,
      capacityUnit: asset.capacity_unit,
      refrigerantType: asset.refrigerant_type,
      qrCode: asset.qr_code,
      isUnderWarranty,
      hasActiveAmc,
      amcContractNumber,
    };
  }

  /**
   * Retrieves past maintenance logs and work orders for a specific equipment asset.
   */
  static async getAssetServiceHistory(
    client: SupabaseClient,
    customerId: string,
    assetId: string
  ): Promise<CustomerSafeAssetServiceHistoryDto> {
    const asset = await this.getAssetDetail(client, customerId, assetId);

    const { data: workOrders, error } = await client
      .from('work_orders')
      .select(`
        id,
        work_order_number,
        status,
        priority,
        description,
        scheduled_start,
        updated_at,
        service_visit_reports (
          id,
          report_number,
          work_performed,
          parts_used_summary
        )
      `)
      .eq('asset_id', assetId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch asset service history: ${error.message}`);
    }

    const formattedWorkOrders = (workOrders || []).map((w: any) => {
      const reports = (w.service_visit_reports as any[]) || [];
      const primaryReport = reports[0];

      let partsReplaced: string[] = [];
      if (primaryReport?.parts_used_summary) {
        try {
          const parts = Array.isArray(primaryReport.parts_used_summary)
            ? primaryReport.parts_used_summary
            : JSON.parse(primaryReport.parts_used_summary);
          partsReplaced = parts.map((p: any) => p.name || p.item_name || 'Part');
        } catch {
          partsReplaced = [];
        }
      }

      return {
        id: w.id,
        workOrderNumber: w.work_order_number,
        status: w.status,
        priority: w.priority,
        description: w.description,
        scheduledStart: w.scheduled_start,
        completedAt: w.status === 'completed' || w.status === 'closed' ? w.updated_at : null,
        serviceReportNumber: primaryReport?.report_number || null,
        workPerformed: primaryReport?.work_performed || null,
        partsReplaced,
      };
    });

    return {
      assetId: asset.id,
      assetName: asset.name,
      assetCode: asset.assetCode,
      workOrders: formattedWorkOrders,
    };
  }
}

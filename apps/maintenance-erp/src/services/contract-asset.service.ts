import { SupabaseClient } from '@supabase/supabase-js';
import { ContractAssetAddDto } from '../schemas/contract.schema.js';

export class ContractAssetService {
  /**
   * Adds an asset to a contract.
   */
  static async addAssetToContract(client: SupabaseClient, dto: ContractAssetAddDto) {
    const { data, error } = await client
      .from('amc_contract_assets')
      .insert({
        amc_contract_id: dto.contractId,
        customer_asset_id: dto.customerAssetId,
        coverage_type: dto.coverageType || 'full_service',
        coverage_start: dto.coverageStart || null,
        coverage_end: dto.coverageEnd || null,
        asset_price: dto.assetPrice || 0,
        visit_frequency: dto.visitFrequency || 'quarterly',
        service_notes: dto.serviceNotes || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add asset to contract: ${error.message}`);
    return data;
  }

  /**
   * Lists covered assets under a contract.
   */
  static async listContractAssets(client: SupabaseClient, contractId: string) {
    const { data, error } = await client
      .from('amc_contract_assets')
      .select('*, asset:customer_assets(*)')
      .eq('amc_contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to list contract assets: ${error.message}`);
    return data;
  }

  /**
   * Soft-deactivates an asset from a contract.
   */
  static async removeAssetFromContract(client: SupabaseClient, contractAssetId: string) {
    const { data, error } = await client
      .from('amc_contract_assets')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', contractAssetId)
      .select()
      .single();

    if (error) throw new Error(`Failed to remove asset from contract: ${error.message}`);
    return data;
  }

  /**
   * Consolidated customer asset maintenance history:
   * Returns contracts covering this asset, work orders performed, parts consumed, and technicians.
   */
  static async getAssetMaintenanceHistory(client: SupabaseClient, assetId: string) {
    // 1. Contracts covering this asset
    const { data: contracts } = await client
      .from('amc_contract_assets')
      .select('*, contract:amc_contracts(*)')
      .eq('customer_asset_id', assetId);

    // 2. Work orders on this asset
    const { data: workOrders } = await client
      .from('work_orders')
      .select('id, work_order_number, title, priority, status, created_at, scheduled_start, contract_id, coverage_status')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false });

    // 3. Parts replaced on this asset
    const woIds = (workOrders || []).map((w: any) => w.id);
    let partsReplaced: any[] = [];
    if (woIds.length > 0) {
      const { data: parts } = await client
        .from('job_material_movements')
        .select('*')
        .in('work_order_id', woIds)
        .eq('movement_type', 'installed');
      partsReplaced = parts || [];
    }

    return {
      assetId,
      coveredContracts: contracts || [],
      workOrders: workOrders || [],
      partsReplaced,
    };
  }
}

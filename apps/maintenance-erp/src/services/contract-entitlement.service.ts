import { SupabaseClient } from '@supabase/supabase-js';
import { ContractEntitlementCreateDto } from '../schemas/contract.schema.js';
import { Decimal } from '../lib/decimal.js';

export class ContractEntitlementService {
  /**
   * Creates a contract entitlement limit.
   */
  static async createEntitlement(client: SupabaseClient, dto: ContractEntitlementCreateDto) {
    const { data, error } = await client
      .from('contract_entitlements')
      .insert({
        company_id: dto.companyId,
        contract_id: dto.contractId,
        contract_asset_id: dto.contractAssetId || null,
        entitlement_type: dto.entitlementType,
        total_entitled: dto.totalEntitled,
        used_quantity: 0.0,
        unit: dto.unit || 'visits',
        limit_action: dto.limitAction || 'convert_to_billable',
      })
      .select()
      .single();

    if (error) throw new Error(`Entitlement creation failed: ${error.message}`);
    return data;
  }

  /**
   * Lists entitlements configured on a contract.
   */
  static async listEntitlements(client: SupabaseClient, contractId: string) {
    const { data, error } = await client
      .from('contract_entitlements')
      .select('*')
      .eq('contract_id', contractId)
      .order('entitlement_type', { ascending: true });

    if (error) throw new Error(`Failed to list entitlements: ${error.message}`);
    return data;
  }

  /**
   * Records usage against an entitlement via transactional RPC.
   */
  static async recordUsage(
    client: SupabaseClient,
    contractId: string,
    entitlementType: string,
    amount: number,
    assetId?: string
  ) {
    const { data, error } = await client.rpc('record_entitlement_usage', {
      p_contract_id: contractId,
      p_type: entitlementType,
      p_amount: amount,
      p_asset_id: assetId || null,
    });

    if (error) throw new Error(`Failed to record entitlement usage: ${error.message}`);
    return data;
  }

  /**
   * Pure calculation of entitlement balance with Decimal precision.
   */
  static calculateEntitlementBalance(
    totalEntitled: number,
    usedQuantity: number,
    requestedAmount: number,
    limitAction: 'reject_coverage' | 'convert_to_billable' | 'require_approval' = 'convert_to_billable'
  ) {
    const total = new Decimal(totalEntitled);
    const used = new Decimal(usedQuantity);
    const req = new Decimal(requestedAmount);

    const available = total.minus(used);
    const remainingAfter = available.minus(req);

    if (remainingAfter.isNegative()) {
      // Exceeded limit
      const covered = available.greaterThan(0) ? available : Decimal.zero();
      const excess = req.minus(covered);


      return {
        isCovered: limitAction === 'convert_to_billable' ? covered.greaterThan(0) : false,
        limitExceeded: true,
        limitAction,
        coveredAmount: covered.toNumber(),
        billableAmount: excess.toNumber(),
        remainingBefore: available.toNumber(),
        remainingAfter: 0,
      };
    } else {
      // Fully covered
      return {
        isCovered: true,
        limitExceeded: false,
        limitAction,
        coveredAmount: req.toNumber(),
        billableAmount: 0,
        remainingBefore: available.toNumber(),
        remainingAfter: remainingAfter.toNumber(),
      };
    }
  }

  /**
   * Gets contract entitlement usage summary.
   */
  static async getContractUsage(client: SupabaseClient, contractId: string) {
    const entitlements = await this.listEntitlements(client, contractId);
    return entitlements.map((e: any) => ({
      entitlementType: e.entitlement_type,
      totalEntitled: Number(e.total_entitled),
      usedQuantity: Number(e.used_quantity),
      remainingQuantity: Number(e.remaining_quantity),
      unit: e.unit,
      limitAction: e.limit_action,
      percentageUsed: e.total_entitled > 0 ? parseFloat(((e.used_quantity / e.total_entitled) * 100).toFixed(1)) : 0,
    }));
  }
}

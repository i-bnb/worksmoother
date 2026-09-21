import { SupabaseClient } from '@supabase/supabase-js';

export type RentalDamageType =
  | 'mechanical'
  | 'electrical'
  | 'structural'
  | 'cosmetic'
  | 'missing_parts'
  | 'total_loss';

export type RentalDamageSeverity = 'minor' | 'moderate' | 'severe' | 'total_loss';

export type RentalResponsibility = 'full' | 'partial' | 'waived' | 'disputed';

export interface AssessDamageDTO {
  contractId: string;
  assetId: string;
  returnId: string;
  damageType: RentalDamageType;
  severity: RentalDamageSeverity;
  description: string;
  photos?: string[];
  estimatedCost?: number;
  customerResponsibility?: RentalResponsibility;
  approvedCharge?: number;
  spawnWorkOrder?: boolean;
}

export class RentalDamageService {
  /**
   * Log equipment damage assessment and optionally spawn a repair work order.
   */
  static async assessDamage(
    client: SupabaseClient,
    dto: AssessDamageDTO
  ): Promise<{
    damageAssessmentId: string;
    assessmentNumber: string;
    repairWorkOrderId?: string;
    approvedCharge: number;
    status: string;
  }> {
    const { data, error } = await client.rpc('assess_rental_damage', {
      p_contract_id: dto.contractId,
      p_asset_id: dto.assetId,
      p_return_id: dto.returnId,
      p_damage_type: dto.damageType,
      p_severity: dto.severity,
      p_description: dto.description,
      p_photos: dto.photos || [],
      p_estimated_cost: dto.estimatedCost ?? 0,
      p_customer_resp: dto.customerResponsibility || 'full',
      p_approved_charge: dto.approvedCharge ?? 0,
      p_spawn_work_order: dto.spawnWorkOrder ?? true,
    });

    if (error) throw error;
    return {
      damageAssessmentId: data.damage_assessment_id,
      assessmentNumber: data.assessment_number,
      repairWorkOrderId: data.repair_work_order_id,
      approvedCharge: Number(data.approved_charge ?? 0),
      status: data.status,
    };
  }

  /**
   * Approve a damage charge, adding the charge to the contract for billing.
   */
  static async approveDamageCharge(
    client: SupabaseClient,
    damageId: string,
    approvedCharge: number,
    approverId?: string
  ): Promise<void> {
    const { data: damage, error: fetchErr } = await client
      .from('rental_damage_assessments')
      .select('*')
      .eq('id', damageId)
      .single();

    if (fetchErr) throw fetchErr;

    // Update assessment
    const { error: updateErr } = await client
      .from('rental_damage_assessments')
      .update({
        approved_charge: approvedCharge,
        status: 'approved',
        approved_by: approverId || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', damageId);

    if (updateErr) throw updateErr;

    // Insert into rental charges
    await client.from('rental_charges').insert({
      rental_contract_id: damage.rental_contract_id,
      charge_type: 'damage',
      description: `Damage recovery (${damage.assessment_number}): ${damage.description}`,
      amount: approvedCharge,
    });
  }

  /**
   * Waive a damage charge (company absorbs repair cost).
   */
  static async waiveDamageCharge(
    client: SupabaseClient,
    damageId: string,
    reason?: string
  ): Promise<void> {
    const { error } = await client
      .from('rental_damage_assessments')
      .update({
        customer_responsibility: 'waived',
        approved_charge: 0,
        status: 'waived',
        description: reason ? `Waived: ${reason}` : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', damageId);

    if (error) throw error;
  }
}

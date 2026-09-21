import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export type CoverageClassification = 'covered' | 'partially_covered' | 'billable' | 'out_of_scope';

export interface EvaluateLineItemParams {
  lineType: 'service' | 'part' | 'labor';
  isScheduledPreventive: boolean;
  coverageType: 'full_service' | 'parts_only' | 'labor_only' | 'preventive_only' | 'breakdown_only' | 'parts_and_labor' | 'custom';
  amount: number;
  availableEntitlement?: number | null; // e.g. remaining parts allowance in INR or labor hours
}

export class ContractCoverageService {
  /**
   * Pure evaluation of coverage for a work order line item (part, labor, or service).
   */
  static evaluateLineItemCoverage(params: EvaluateLineItemParams): {
    coverageStatus: CoverageClassification;
    coveredAmount: number;
    billableAmount: number;
    reason: string;
  } {
    const amt = new Decimal(params.amount);

    // 1. Check if line type is eligible based on contract coverage type
    let isEligible = false;
    let reason = '';

    switch (params.coverageType) {
      case 'full_service':
      case 'parts_and_labor':
        isEligible = true;
        reason = 'Fully covered under full service contract';
        break;

      case 'parts_only':
        if (params.lineType === 'part') {
          isEligible = true;
          reason = 'Parts covered under parts-only contract';
        } else {
          isEligible = false;
          reason = 'Labor and services are billable under parts-only contract';
        }
        break;

      case 'labor_only':
        if (params.lineType === 'labor' || params.lineType === 'service') {
          isEligible = true;
          reason = 'Labor covered under labor-only contract';
        } else {
          isEligible = false;
          reason = 'Parts are billable under labor-only contract';
        }
        break;

      case 'preventive_only':
        if (params.isScheduledPreventive) {
          isEligible = true;
          reason = 'Covered under preventive-only contract';
        } else {
          isEligible = false;
          reason = 'Corrective/emergency breakdown visits are billable under preventive-only contract';
        }
        break;

      case 'breakdown_only':
        if (!params.isScheduledPreventive) {
          isEligible = true;
          reason = 'Breakdown repair covered under breakdown-only contract';
        } else {
          isEligible = false;
          reason = 'Preventive maintenance is billable under breakdown-only contract';
        }
        break;

      default:
        isEligible = true;
        reason = 'Covered under custom contract terms';
    }

    if (!isEligible) {
      return {
        coverageStatus: 'billable',
        coveredAmount: 0,
        billableAmount: amt.toNumber(),
        reason,
      };
    }

    // 2. Check entitlement monetary caps or hour allowances if specified
    if (params.availableEntitlement !== undefined && params.availableEntitlement !== null) {
      const avail = new Decimal(params.availableEntitlement);
      if (avail.lessThanOrEqualTo(0)) {
        return {
          coverageStatus: 'billable',
          coveredAmount: 0,
          billableAmount: amt.toNumber(),
          reason: 'Entitlement allowance exhausted; converted to billable',
        };
      }

      if (amt.greaterThan(avail)) {
        const excess = amt.minus(avail);
        return {
          coverageStatus: 'partially_covered',
          coveredAmount: avail.toNumber(),
          billableAmount: excess.toNumber(),
          reason: `Partially covered: ${avail.toFixed(2)} covered by allowance, ${excess.toFixed(2)} billable excess`,
        };
      }
    }

    // Fully covered
    return {
      coverageStatus: 'covered',
      coveredAmount: amt.toNumber(),
      billableAmount: 0,
      reason,
    };
  }

  /**
   * Evaluates work order contract coverage via database RPC.
   */
  static async evaluateWorkOrderCoverage(client: SupabaseClient, workOrderId: string) {
    const { data, error } = await client.rpc('calculate_contract_coverage', {
      p_work_order_id: workOrderId,
    });

    if (error) throw new Error(`Failed to calculate contract coverage: ${error.message}`);
    return data;
  }
}

import { SupabaseClient } from '@supabase/supabase-js';

export type PartsReadinessStatus = 'READY' | 'PARTIAL' | 'NOT_READY' | 'NOT_REQUIRED';

export interface PartRequirement {
  itemCode: string;
  itemName?: string;
  quantityRequired: number;
}

export interface PartsReadinessEvaluationResult {
  status: PartsReadinessStatus;
  totalRequiredParts: number;
  availablePartsCount: number;
  missingParts: Array<{
    itemCode: string;
    quantityRequired: number;
    quantityAvailable: number;
  }>;
}

export class PartsReadinessService {
  /**
   * Pure evaluation algorithm for parts readiness.
   */
  static evaluateReadiness(
    requirements: PartRequirement[],
    stockBalancesByItem: Record<string, number>
  ): PartsReadinessEvaluationResult {
    if (requirements.length === 0) {
      return {
        status: 'NOT_REQUIRED',
        totalRequiredParts: 0,
        availablePartsCount: 0,
        missingParts: [],
      };
    }

    let availableCount = 0;
    const missing: PartsReadinessEvaluationResult['missingParts'] = [];

    for (const req of requirements) {
      const available = stockBalancesByItem[req.itemCode] || 0;
      if (available >= req.quantityRequired) {
        availableCount++;
      } else {
        missing.push({
          itemCode: req.itemCode,
          quantityRequired: req.quantityRequired,
          quantityAvailable: available,
        });
      }
    }

    let status: PartsReadinessStatus = 'NOT_READY';
    if (availableCount === requirements.length) {
      status = 'READY';
    } else if (availableCount > 0) {
      status = 'PARTIAL';
    } else {
      status = 'NOT_READY';
    }

    return {
      status,
      totalRequiredParts: requirements.length,
      availablePartsCount: availableCount,
      missingParts: missing,
    };
  }

  /**
   * Evaluates parts readiness on the live database.
   */
  static async checkPartsReadiness(
    client: SupabaseClient,
    companyId: string,
    workOrderId: string
  ): Promise<PartsReadinessEvaluationResult> {
    // 1. Fetch work order parts lines
    const { data: lines, error: lineErr } = await client
      .from('work_order_lines')
      .select('item_code, description, quantity')
      .eq('work_order_id', workOrderId)
      .eq('line_type', 'part');

    if (lineErr) throw new Error(`Failed to fetch work order lines: ${lineErr.message}`);

    const requirements: PartRequirement[] = (lines || []).map((l: any) => ({
      itemCode: l.item_code,
      itemName: l.description,
      quantityRequired: Number(l.quantity || 1),
    }));

    if (requirements.length === 0) {
      return {
        status: 'NOT_REQUIRED',
        totalRequiredParts: 0,
        availablePartsCount: 0,
        missingParts: [],
      };
    }

    // 2. Fetch stock balances for required items
    const itemCodes = requirements.map((r) => r.itemCode);
    const { data: balances } = await client
      .from('stock_balances')
      .select('quantity_on_hand, item:items(item_code)')
      .eq('company_id', companyId)
      .in('item.item_code', itemCodes);

    const stockMap: Record<string, number> = {};
    for (const b of balances || []) {
      const code = (b.item as any)?.item_code;
      if (code) {
        stockMap[code] = (stockMap[code] || 0) + Number(b.quantity_on_hand || 0);
      }
    }

    return this.evaluateReadiness(requirements, stockMap);
  }
}

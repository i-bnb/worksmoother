import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export type RentalDepositAction =
  | 'receipt'
  | 'refund'
  | 'damage_deduction'
  | 'rent_adjustment'
  | 'forfeiture';

export interface RecordDepositActionDTO {
  contractId: string;
  action: RentalDepositAction;
  amount: number;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
}

export interface DepositBalanceResult {
  newHeld: number;
  newRefundedDelta: number;
  newAdjustedDelta: number;
  newStatus: string;
}

export class RentalDepositService {
  /**
   * Pure calculation of deposit balance transition with Decimal precision.
   */
  static calculateDepositBalance(
    currentHeld: number,
    action: RentalDepositAction,
    amount: number
  ): DepositBalanceResult {
    if (amount <= 0) {
      throw new Error('Deposit transaction amount must be strictly positive');
    }

    const heldDec = new Decimal(currentHeld);
    const amountDec = new Decimal(amount);

    if (action === 'receipt') {
      const newHeld = heldDec.plus(amountDec).toNumber();
      return {
        newHeld,
        newRefundedDelta: 0,
        newAdjustedDelta: 0,
        newStatus: 'held',
      };
    }

    // Deductive actions (refund, damage_deduction, rent_adjustment, forfeiture)
    if (amountDec.greaterThan(heldDec)) {
      throw new Error(
        `Transaction amount (${amount}) exceeds currently held deposit balance (${currentHeld})`
      );
    }

    const newHeldDec = heldDec.minus(amountDec);
    const newHeld = newHeldDec.toNumber();

    if (action === 'refund') {
      return {
        newHeld,
        newRefundedDelta: amount,
        newAdjustedDelta: 0,
        newStatus: newHeld === 0 ? 'fully_refunded' : 'partially_refunded',
      };
    }

    if (action === 'damage_deduction' || action === 'rent_adjustment') {
      return {
        newHeld,
        newRefundedDelta: 0,
        newAdjustedDelta: amount,
        newStatus: 'adjusted',
      };
    }

    // forfeiture
    return {
      newHeld,
      newRefundedDelta: 0,
      newAdjustedDelta: amount,
      newStatus: 'forfeited',
    };
  }

  /**
   * Execute deposit action via RPC.
   */
  static async recordDepositAction(
    client: SupabaseClient,
    dto: RecordDepositActionDTO
  ): Promise<{
    depositTransactionId: string;
    action: string;
    amount: number;
    depositHeld: number;
    depositRefunded: number;
    depositAdjusted: number;
    depositStatus: string;
  }> {
    const { data, error } = await client.rpc('record_rental_deposit_action', {
      p_contract_id: dto.contractId,
      p_action: dto.action,
      p_amount: dto.amount,
      p_payment_method: dto.paymentMethod || 'bank_transfer',
      p_payment_ref: dto.paymentReference || null,
      p_notes: dto.notes || null,
    });

    if (error) throw error;
    return {
      depositTransactionId: data.deposit_transaction_id,
      action: data.action,
      amount: Number(data.amount ?? 0),
      depositHeld: Number(data.deposit_held ?? 0),
      depositRefunded: Number(data.deposit_refunded ?? 0),
      depositAdjusted: Number(data.deposit_adjusted ?? 0),
      depositStatus: data.deposit_status,
    };
  }

  /**
   * Retrieve deposit transaction history for a rental contract.
   */
  static async getDepositLedger(
    client: SupabaseClient,
    contractId: string
  ): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await client
      .from('rental_security_deposits')
      .select('*')
      .eq('rental_contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }
}

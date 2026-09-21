import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface RequestExtensionDTO {
  contractId: string;
  extendedEndDate: string;
  notes?: string;
}

export interface CalculatedExtensionCharge {
  additionalDays: number;
  additionalCharge: number;
  taxAmount: number;
  totalAmount: number;
}

export class RentalExtensionService {
  /**
   * Pure calculation of extension charges with arbitrary-precision Decimal.
   */
  static calculateExtensionCharge(
    additionalDays: number,
    unitRate: number,
    taxRate: number = 5.0
  ): CalculatedExtensionCharge {
    if (additionalDays <= 0) {
      throw new Error('additionalDays must be strictly positive');
    }

    const daysDec = new Decimal(additionalDays);
    const rateDec = new Decimal(unitRate);
    const chargeDec = daysDec.times(rateDec).round(3);

    const taxRateDec = new Decimal(taxRate).dividedBy(100);
    const taxDec = chargeDec.times(taxRateDec).round(3);
    const totalDec = chargeDec.plus(taxDec);

    return {
      additionalDays,
      additionalCharge: chargeDec.toNumber(),
      taxAmount: taxDec.toNumber(),
      totalAmount: totalDec.toNumber(),
    };
  }

  /**
   * Submit a rental contract extension request via RPC.
   */
  static async requestExtension(
    client: SupabaseClient,
    dto: RequestExtensionDTO
  ): Promise<{
    extensionId: string;
    additionalDays: number;
    additionalCharge: number;
    taxAmount: number;
  }> {
    const { data, error } = await client.rpc('request_rental_extension', {
      p_contract_id: dto.contractId,
      p_extended_end_date: dto.extendedEndDate,
      p_notes: dto.notes || null,
    });

    if (error) throw error;
    return {
      extensionId: data.extension_id,
      additionalDays: data.additional_days,
      additionalCharge: Number(data.additional_charge ?? 0),
      taxAmount: Number(data.tax_amount ?? 0),
    };
  }

  /**
   * Approve a rental extension.
   */
  static async approveExtension(
    client: SupabaseClient,
    extensionId: string,
    approvedBy?: string
  ): Promise<{
    extensionId: string;
    contractId: string;
    newExpectedReturnDate: string;
  }> {
    const { data, error } = await client.rpc('approve_rental_extension', {
      p_extension_id: extensionId,
      p_approved_by: approvedBy || null,
    });

    if (error) throw error;
    return {
      extensionId: data.extension_id,
      contractId: data.contract_id,
      newExpectedReturnDate: data.new_expected_return_date,
    };
  }

  /**
   * Reject a rental extension.
   */
  static async rejectExtension(
    client: SupabaseClient,
    extensionId: string,
    rejectionReason: string
  ): Promise<void> {
    const { data: ext, error: fetchErr } = await client
      .from('rental_extensions')
      .select('status, rental_contract_id')
      .eq('id', extensionId)
      .single();

    if (fetchErr) throw fetchErr;
    if (ext.status !== 'requested') {
      throw new Error(`Cannot reject extension in status '${ext.status}'`);
    }

    const { error: updateErr } = await client
      .from('rental_extensions')
      .update({
        status: 'rejected',
        rejection_reason: rejectionReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', extensionId);

    if (updateErr) throw updateErr;

    // Reset contract status back to active
    await client
      .from('rental_contracts')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', ext.rental_contract_id);
  }
}

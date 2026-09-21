import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';

export interface DispatchAssetPayload {
  contractId: string;
  assetId: string;
  meterReading: number;
  condition?: string;
  signatureUrl?: string;
  photos?: string[];
  notes?: string;
  carrierInfo?: Record<string, unknown>;
}

export interface ReturnChargesCalculationParams {
  startDate: string | Date;
  expectedReturnDate: string | Date;
  actualReturnDate: string | Date;
  dispatchMeter: number;
  returnMeter: number;
  dailyRate: number;
  meterRatePerUnit: number;
  includedUnitsPerDay: number;
  cleaningRequired?: boolean;
  cleaningCharge?: number;
  damageCharge?: number;
}

export interface CalculatedReturnCharges {
  meterDifference: number;
  allowedUnits: number;
  excessUnits: number;
  excessMeterCharge: number;
  rentalDays: number;
  extraDays: number;
  extraDayCharge: number;
  cleaningCharge: number;
  damageCharge: number;
  totalExtraCharges: number;
}

export interface ReturnAssetPayload {
  contractId: string;
  assetId: string;
  meterReading: number;
  condition?: string;
  cleaningRequired?: boolean;
  damageNotes?: string;
  damageCharge?: number;
  cleaningCharge?: number;
  photos?: string[];
  notes?: string;
  returnLocationId?: string;
}

export class RentalHandoverService {
  /**
   * Pure deterministic calculation of return surcharges (meter delta, overdue days, cleaning, damages) with Decimal precision.
   */
  static calculateReturnCharges(params: ReturnChargesCalculationParams): CalculatedReturnCharges {
    const start = typeof params.startDate === 'string' ? new Date(params.startDate) : params.startDate;
    const expected = typeof params.expectedReturnDate === 'string' ? new Date(params.expectedReturnDate) : params.expectedReturnDate;
    const actual = typeof params.actualReturnDate === 'string' ? new Date(params.actualReturnDate) : params.actualReturnDate;

    // Rental duration in days (minimum 1)
    const diffTime = actual.getTime() - start.getTime();
    const rentalDays = Math.max(Math.ceil(diffTime / (1000 * 60 * 60 * 24)), 1);

    // Overdue extra days
    let extraDays = 0;
    if (actual > expected) {
      const overdueTime = actual.getTime() - expected.getTime();
      extraDays = Math.ceil(overdueTime / (1000 * 60 * 60 * 24));
    }

    const extraDayChargeDec = new Decimal(extraDays).times(new Decimal(params.dailyRate)).round(3);

    // Meter delta & excess usage
    const returnMeterDec = new Decimal(params.returnMeter);
    const dispatchMeterDec = new Decimal(params.dispatchMeter);
    const meterDiffDec = returnMeterDec.minus(dispatchMeterDec);
    const meterDifference = Math.max(meterDiffDec.toNumber(), 0);

    const allowedUnitsDec = new Decimal(rentalDays).times(new Decimal(params.includedUnitsPerDay));
    const excessDiffDec = new Decimal(meterDifference).minus(allowedUnitsDec);
    const excessUnitsDec = excessDiffDec.greaterThan(Decimal.zero()) ? excessDiffDec : Decimal.zero();
    const excessMeterChargeDec = excessUnitsDec.times(new Decimal(params.meterRatePerUnit)).round(3);

    // Cleaning charge
    let cleaningChargeDec = Decimal.zero();
    if (params.cleaningRequired || (params.cleaningCharge && params.cleaningCharge > 0)) {
      cleaningChargeDec = new Decimal(params.cleaningCharge ?? 50.0).round(3);
    }

    // Damage charge
    const damageChargeDec = new Decimal(params.damageCharge ?? 0).round(3);

    const totalExtraDec = extraDayChargeDec
      .plus(excessMeterChargeDec)
      .plus(cleaningChargeDec)
      .plus(damageChargeDec);

    return {
      meterDifference: meterDifference,
      allowedUnits: allowedUnitsDec.toNumber(),
      excessUnits: excessUnitsDec.toNumber(),
      excessMeterCharge: excessMeterChargeDec.toNumber(),
      rentalDays: rentalDays,
      extraDays: extraDays,
      extraDayCharge: extraDayChargeDec.toNumber(),
      cleaningCharge: cleaningChargeDec.toNumber(),
      damageCharge: damageChargeDec.toNumber(),
      totalExtraCharges: totalExtraDec.toNumber(),
    };
  }

  /**
   * Dispatch/Handover asset to customer jobsite via RPC.
   */
  static async dispatchAsset(
    client: SupabaseClient,
    payload: DispatchAssetPayload
  ): Promise<{ deliveryId: string; status: string }> {
    const { data, error } = await client.rpc('dispatch_rental_asset_v2', {
      p_contract_id: payload.contractId,
      p_asset_id: payload.assetId,
      p_meter_reading: payload.meterReading,
      p_condition: payload.condition || 'good',
      p_signature_url: payload.signatureUrl || null,
      p_photos: payload.photos || [],
      p_notes: payload.notes || null,
      p_carrier_info: payload.carrierInfo || {},
    });

    if (error) throw error;
    return {
      deliveryId: data.delivery_id,
      status: data.status,
    };
  }

  /**
   * Process asset return/check-in via RPC.
   */
  static async returnAsset(
    client: SupabaseClient,
    payload: ReturnAssetPayload
  ): Promise<{
    returnId: string;
    meterDifference: number;
    totalExtraCharges: number;
    assetStatus: string;
  }> {
    const { data, error } = await client.rpc('return_rental_asset_v2', {
      p_contract_id: payload.contractId,
      p_asset_id: payload.assetId,
      p_meter_reading: payload.meterReading,
      p_condition: payload.condition || 'good',
      p_cleaning_required: payload.cleaningRequired ?? false,
      p_damage_notes: payload.damageNotes || null,
      p_damage_charge: payload.damageCharge ?? 0,
      p_cleaning_charge: payload.cleaningCharge ?? 0,
      p_photos: payload.photos || [],
      p_notes: payload.notes || null,
      p_return_location_id: payload.returnLocationId || null,
    });

    if (error) throw error;
    return {
      returnId: data.return_id,
      meterDifference: Number(data.meter_difference ?? 0),
      totalExtraCharges: Number(data.total_extra_charges ?? 0),
      assetStatus: data.asset_status,
    };
  }
}

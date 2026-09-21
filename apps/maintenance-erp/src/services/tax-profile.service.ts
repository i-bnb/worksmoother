import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  TaxProfileCreateDto,
  HsnSacCodeCreateDto,
  PlaceOfSupplyResolveDto,
  validateTaxProfileCreate,
  validateHsnSacCodeCreate,
  validatePlaceOfSupplyResolve,
  INDIA_GST_STATE_CODES,
} from '../schemas/tax-profile.schema.js';

export interface TaxSnapshotOutput {
  version: string;
  timestamp: string;
  supplier: {
    gstin?: string | null;
    stateCode: string;
    stateName: string;
    legalName: string;
  };
  recipient: {
    gstin?: string | null;
    stateCode: string;
    stateName: string;
    legalName: string;
    registrationType: string;
  };
  placeOfSupplyStateCode: string;
  placeOfSupplyStateName: string;
  taxType: 'INTRA_STATE' | 'INTER_STATE' | 'SEZ' | 'EXPORT';
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTax: number;
  grandTotal: number;
  isRcmApplicable: boolean;
}

export class TaxProfileService {
  /**
   * Creates or updates an entity tax profile (Company, Customer, or Supplier).
   */
  static async createOrUpdateTaxProfile(
    client: SupabaseClient,
    rawDto: TaxProfileCreateDto
  ) {
    const dto = validateTaxProfileCreate(rawDto);
    const now = new Date().toISOString();

    const payload = {
      company_id: dto.companyId,
      entity_type: dto.entityType,
      entity_id: dto.entityId,
      gstin: dto.gstin || null,
      legal_name: dto.legalName,
      trade_name: dto.tradeName || null,
      pan_number: dto.panNumber || null,
      state_code: dto.stateCode,
      state_name: dto.stateName || INDIA_GST_STATE_CODES[dto.stateCode] || 'Unknown',
      registration_type: dto.registrationType || 'regular',
      place_of_supply_state: dto.placeOfSupplyState || dto.stateCode,
      is_rcm_applicable: dto.isRcmApplicable || false,
      updated_at: now,
    };

    const { data: existing } = await client
      .from('tax_profiles')
      .select('id')
      .eq('company_id', dto.companyId)
      .eq('entity_type', dto.entityType)
      .eq('entity_id', dto.entityId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await client
        .from('tax_profiles')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) throw new Error(`Failed to update tax profile: ${error.message}`);
      return data;
    } else {
      const { data, error } = await client
        .from('tax_profiles')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw new Error(`Failed to insert tax profile: ${error.message}`);
      return data;
    }
  }

  /**
   * Retrieves an entity tax profile.
   */
  static async getTaxProfile(
    client: SupabaseClient,
    companyId: string,
    entityType: 'company' | 'customer' | 'supplier',
    entityId: string
  ) {
    const { data, error } = await client
      .from('tax_profiles')
      .select('*')
      .eq('company_id', companyId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .maybeSingle();

    if (error) throw new Error(`Failed to get tax profile: ${error.message}`);
    return data;
  }

  /**
   * Resolves place of supply and computes CGST, SGST, IGST tax breakdown.
   */
  static resolvePlaceOfSupply(rawDto: PlaceOfSupplyResolveDto) {
    const dto = validatePlaceOfSupplyResolve(rawDto);

    const taxableDec = new Decimal(dto.taxableAmount);
    const gstRateDec = new Decimal(dto.gstRate);
    const hundred = new Decimal(100);

    let taxType: 'INTRA_STATE' | 'INTER_STATE' | 'SEZ' | 'EXPORT' = 'INTRA_STATE';
    let cgstRateDec = Decimal.zero();
    let sgstRateDec = Decimal.zero();
    let igstRateDec = Decimal.zero();

    if (dto.isExport) {
      taxType = 'EXPORT';
      // Zero-rated export
      igstRateDec = Decimal.zero();
    } else if (dto.isSez) {
      taxType = 'SEZ';
      // SEZ supplies are treated as inter-state
      igstRateDec = gstRateDec;
    } else if (dto.supplierStateCode === dto.placeOfSupplyStateCode) {
      // Intra-state supply: CGST + SGST (50% each)
      taxType = 'INTRA_STATE';
      const halfRate = gstRateDec.dividedBy(new Decimal(2));
      cgstRateDec = halfRate;
      sgstRateDec = halfRate;
    } else {
      // Inter-state supply: IGST (100%)
      taxType = 'INTER_STATE';
      igstRateDec = gstRateDec;
    }

    const cgstAmtDec = taxableDec.times(cgstRateDec).dividedBy(hundred).round(3);
    const sgstAmtDec = taxableDec.times(sgstRateDec).dividedBy(hundred).round(3);
    const igstAmtDec = taxableDec.times(igstRateDec).dividedBy(hundred).round(3);
    const totalTaxDec = cgstAmtDec.plus(sgstAmtDec).plus(igstAmtDec);
    const grandTotalDec = taxableDec.plus(totalTaxDec);

    return {
      taxType,
      taxableAmount: taxableDec.toNumber(),
      cgstRate: cgstRateDec.toNumber(),
      cgstAmount: cgstAmtDec.toNumber(),
      sgstRate: sgstRateDec.toNumber(),
      sgstAmount: sgstAmtDec.toNumber(),
      igstRate: igstRateDec.toNumber(),
      igstAmount: igstAmtDec.toNumber(),
      totalTax: totalTaxDec.toNumber(),
      grandTotal: grandTotalDec.toNumber(),
      isRcmApplicable: dto.isRcmApplicable || false,
    };
  }

  /**
   * Generates an immutable tax snapshot for storing in invoices, bills, and credit notes.
   */
  static generateTaxSnapshot(params: {
    supplier: {
      gstin?: string | null;
      stateCode: string;
      legalName: string;
    };
    recipient: {
      gstin?: string | null;
      stateCode: string;
      legalName: string;
      registrationType?: string;
    };
    placeOfSupplyStateCode?: string;
    taxableAmount: number;
    gstRate: number;
    isSez?: boolean;
    isExport?: boolean;
    isRcmApplicable?: boolean;
  }): TaxSnapshotOutput {
    const posState = params.placeOfSupplyStateCode || params.recipient.stateCode;
    const resolved = this.resolvePlaceOfSupply({
      supplierStateCode: params.supplier.stateCode,
      customerStateCode: params.recipient.stateCode,
      placeOfSupplyStateCode: posState,
      isSez: params.isSez,
      isExport: params.isExport,
      isRcmApplicable: params.isRcmApplicable,
      taxableAmount: params.taxableAmount,
      gstRate: params.gstRate,
    });

    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      supplier: {
        gstin: params.supplier.gstin || null,
        stateCode: params.supplier.stateCode,
        stateName: INDIA_GST_STATE_CODES[params.supplier.stateCode] || 'Unknown',
        legalName: params.supplier.legalName,
      },
      recipient: {
        gstin: params.recipient.gstin || null,
        stateCode: params.recipient.stateCode,
        stateName: INDIA_GST_STATE_CODES[params.recipient.stateCode] || 'Unknown',
        legalName: params.recipient.legalName,
        registrationType: params.recipient.registrationType || 'regular',
      },
      placeOfSupplyStateCode: posState,
      placeOfSupplyStateName: INDIA_GST_STATE_CODES[posState] || 'Unknown',
      taxType: resolved.taxType,
      taxableAmount: resolved.taxableAmount,
      cgstRate: resolved.cgstRate,
      cgstAmount: resolved.cgstAmount,
      sgstRate: resolved.sgstRate,
      sgstAmount: resolved.sgstAmount,
      igstRate: resolved.igstRate,
      igstAmount: resolved.igstAmount,
      totalTax: resolved.totalTax,
      grandTotal: resolved.grandTotal,
      isRcmApplicable: resolved.isRcmApplicable,
    };
  }

  /**
   * Creates a new HSN/SAC code master record.
   */
  static async createHsnSacCode(
    client: SupabaseClient,
    rawDto: HsnSacCodeCreateDto
  ) {
    const dto = validateHsnSacCodeCreate(rawDto);
    const payload = {
      company_id: dto.companyId,
      code: dto.code,
      description: dto.description,
      code_type: dto.codeType,
      gst_rate: dto.gstRate,
      cgst_rate: dto.cgstRate,
      sgst_rate: dto.sgstRate,
      igst_rate: dto.igstRate,
      cess_rate: dto.cessRate || 0,
      is_active: dto.isActive !== undefined ? dto.isActive : true,
    };

    const { data, error } = await client
      .from('hsn_sac_codes')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create HSN/SAC code: ${error.message}`);
    return data;
  }

  /**
   * Retrieves HSN/SAC code by code.
   */
  static async getHsnSacByCode(
    client: SupabaseClient,
    companyId: string,
    code: string
  ) {
    const { data, error } = await client
      .from('hsn_sac_codes')
      .select('*')
      .eq('company_id', companyId)
      .eq('code', code)
      .maybeSingle();

    if (error) throw new Error(`Failed to get HSN/SAC code: ${error.message}`);
    return data;
  }
}

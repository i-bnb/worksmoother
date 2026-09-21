/**
 * =============================================================================
 * Tax Profiles, GSTIN & HSN/SAC Master Validation Schemas
 * Maintenance Management ERP — Phase 11 Advanced Finance
 * =============================================================================
 */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export const INDIA_GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export function extractPanFromGstin(gstin: string): string {
  const clean = gstin.trim().toUpperCase();
  if (clean.length === 15) {
    return clean.slice(2, 12);
  }
  return '';
}

export interface TaxProfileCreateDto {
  companyId: string;
  entityType: 'company' | 'customer' | 'supplier';
  entityId: string;
  gstin?: string | null;
  legalName: string;
  tradeName?: string | null;
  panNumber?: string | null;
  stateCode: string;
  stateName?: string;
  registrationType?: 'regular' | 'composition' | 'consumer' | 'unregistered' | 'sez' | 'overseas';
  placeOfSupplyState?: string | null;
  isRcmApplicable?: boolean;
}

export interface TaxProfileUpdateDto {
  gstin?: string | null;
  legalName?: string;
  tradeName?: string | null;
  panNumber?: string | null;
  stateCode?: string;
  stateName?: string;
  registrationType?: 'regular' | 'composition' | 'consumer' | 'unregistered' | 'sez' | 'overseas';
  placeOfSupplyState?: string | null;
  isRcmApplicable?: boolean;
}

export interface HsnSacCodeCreateDto {
  companyId: string;
  code: string;
  description: string;
  codeType: 'goods' | 'services';
  gstRate: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  cessRate?: number;
  isActive?: boolean;
}

export interface PlaceOfSupplyResolveDto {
  supplierStateCode: string;
  customerStateCode: string;
  placeOfSupplyStateCode?: string | null;
  isSez?: boolean;
  isExport?: boolean;
  isRcmApplicable?: boolean;
  taxableAmount: number;
  gstRate: number;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateTaxProfileCreate(body: any): TaxProfileCreateDto {
  if (!body) throw new Error('Tax profile payload is required');
  const companyId = body.companyId || body.company_id;
  const entityType = (body.entityType || body.entity_type || '').toLowerCase();
  const entityId = body.entityId || body.entity_id;
  const legalName = (body.legalName || body.legal_name || '').trim();
  let stateCode = (body.stateCode || body.state_code || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!['company', 'customer', 'supplier'].includes(entityType)) {
    throw new Error('entityType must be company, customer, or supplier');
  }
  if (!entityId) throw new Error('entityId is required');
  if (!legalName) throw new Error('legalName is required');

  let gstin = body.gstin ? String(body.gstin).trim().toUpperCase() : null;
  let panNumber = body.panNumber || body.pan_number ? String(body.panNumber || body.pan_number).trim().toUpperCase() : null;

  if (gstin) {
    if (!GSTIN_REGEX.test(gstin)) {
      throw new Error(`Invalid GSTIN format: ${gstin}. Must be a 15-character Indian standard GSTIN.`);
    }
    const gstinStatePrefix = gstin.slice(0, 2);
    if (!stateCode) {
      stateCode = gstinStatePrefix;
    } else if (stateCode !== gstinStatePrefix) {
      throw new Error(`State code '${stateCode}' does not match GSTIN state prefix '${gstinStatePrefix}'`);
    }
    if (!panNumber) {
      panNumber = extractPanFromGstin(gstin);
    }
  }

  if (!stateCode) {
    throw new Error('stateCode is required');
  }

  const stateName = body.stateName || body.state_name || INDIA_GST_STATE_CODES[stateCode] || 'Unknown State';

  const registrationType = (body.registrationType || body.registration_type || (gstin ? 'regular' : 'unregistered')).toLowerCase();
  const validRegTypes = ['regular', 'composition', 'consumer', 'unregistered', 'sez', 'overseas'];
  if (!validRegTypes.includes(registrationType)) {
    throw new Error(`Invalid registrationType: ${registrationType}`);
  }

  return {
    companyId,
    entityType: entityType as any,
    entityId,
    gstin,
    legalName,
    tradeName: body.tradeName || body.trade_name || null,
    panNumber,
    stateCode,
    stateName,
    registrationType: registrationType as any,
    placeOfSupplyState: body.placeOfSupplyState || body.place_of_supply_state || stateCode,
    isRcmApplicable: Boolean(body.isRcmApplicable ?? body.is_rcm_applicable ?? false),
  };
}

export function validateHsnSacCodeCreate(body: any): HsnSacCodeCreateDto {
  if (!body) throw new Error('HSN/SAC payload is required');
  const companyId = body.companyId || body.company_id;
  const code = (body.code || '').trim();
  const description = (body.description || '').trim();
  const codeType = (body.codeType || body.code_type || 'services').toLowerCase();
  const gstRate = Number(body.gstRate ?? body.gst_rate);

  if (!companyId) throw new Error('companyId is required');
  if (!code) throw new Error('HSN/SAC code is required');
  if (!description) throw new Error('description is required');
  if (!['goods', 'services'].includes(codeType)) {
    throw new Error('codeType must be either goods or services');
  }
  if (isNaN(gstRate) || gstRate < 0) {
    throw new Error('gstRate cannot be negative');
  }

  const halfRate = gstRate / 2;
  const cgstRate = body.cgstRate !== undefined ? Number(body.cgstRate) : halfRate;
  const sgstRate = body.sgstRate !== undefined ? Number(body.sgstRate) : halfRate;
  const igstRate = body.igstRate !== undefined ? Number(body.igstRate) : gstRate;
  const cessRate = Number(body.cessRate ?? body.cess_rate ?? 0);

  return {
    companyId,
    code,
    description,
    codeType: codeType as 'goods' | 'services',
    gstRate,
    cgstRate,
    sgstRate,
    igstRate,
    cessRate,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validatePlaceOfSupplyResolve(body: any): PlaceOfSupplyResolveDto {
  if (!body) throw new Error('Place of supply payload is required');
  const supplierStateCode = (body.supplierStateCode || body.supplier_state_code || '').trim();
  const customerStateCode = (body.customerStateCode || body.customer_state_code || '').trim();
  const taxableAmount = Number(body.taxableAmount ?? body.taxable_amount);
  const gstRate = Number(body.gstRate ?? body.gst_rate);

  if (!supplierStateCode) throw new Error('supplierStateCode is required');
  if (!customerStateCode) throw new Error('customerStateCode is required');
  if (isNaN(taxableAmount) || taxableAmount < 0) throw new Error('taxableAmount cannot be negative');
  if (isNaN(gstRate) || gstRate < 0) throw new Error('gstRate cannot be negative');

  return {
    supplierStateCode,
    customerStateCode,
    placeOfSupplyStateCode: body.placeOfSupplyStateCode || body.place_of_supply_state_code || customerStateCode,
    isSez: Boolean(body.isSez ?? body.is_sez ?? false),
    isExport: Boolean(body.isExport ?? body.is_export ?? false),
    isRcmApplicable: Boolean(body.isRcmApplicable ?? body.is_rcm_applicable ?? false),
    taxableAmount,
    gstRate,
  };
}

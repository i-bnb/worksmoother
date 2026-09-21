export interface ContractCreateDto {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  siteId?: string | null;
  contractType?: 'amc' | 'warranty' | 'preventive_maintenance' | 'service_retainer' | 'custom';
  startDate: string;
  endDate: string;
  contractValue: number;
  taxAmount?: number;
  billingFrequency?: 'annual_upfront' | 'semi_annual' | 'quarterly' | 'monthly' | 'milestone';
  serviceFrequency?: 'monthly' | 'bi_monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'custom';
  currency?: string;
  description?: string | null;
  termsAndConditions?: string | null;
  renewalSettings?: {
    auto_renewal?: boolean;
    renewal_notice_days?: number;
    price_adjustment_percent?: number;
  };
  notes?: string | null;
}

export function validateContractCreate(body: any): ContractCreateDto {
  if (!body) throw new Error('Contract request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!body.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    throw new Error('startDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
    throw new Error('endDate is required and must be in YYYY-MM-DD format');
  }
  if (new Date(body.startDate) > new Date(body.endDate)) {
    throw new Error('startDate must be on or before endDate');
  }
  if (typeof body.contractValue !== 'number' || body.contractValue < 0) {
    throw new Error('contractValue must be a non-negative number');
  }

  const validContractTypes = ['amc', 'warranty', 'preventive_maintenance', 'service_retainer', 'custom'];
  if (body.contractType && !validContractTypes.includes(body.contractType)) {
    throw new Error(`contractType must be one of: ${validContractTypes.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    customerId: body.customerId,
    siteId: body.siteId || null,
    contractType: body.contractType || 'amc',
    startDate: body.startDate,
    endDate: body.endDate,
    contractValue: body.contractValue,
    taxAmount: body.taxAmount || 0,
    billingFrequency: body.billingFrequency || 'quarterly',
    serviceFrequency: body.serviceFrequency || 'quarterly',
    currency: body.currency || 'INR',
    description: body.description || null,
    termsAndConditions: body.termsAndConditions || null,
    renewalSettings: body.renewalSettings || {
      auto_renewal: false,
      renewal_notice_days: 30,
      price_adjustment_percent: 0,
    },
    notes: body.notes || null,
  };
}

export interface ContractAssetAddDto {
  contractId: string;
  customerAssetId: string;
  coverageType?: 'full_service' | 'parts_only' | 'labor_only' | 'preventive_only' | 'breakdown_only' | 'parts_and_labor' | 'custom';
  coverageStart?: string | null;
  coverageEnd?: string | null;
  assetPrice?: number;
  visitFrequency?: string;
  serviceNotes?: string | null;
}

export function validateContractAssetAdd(body: any): ContractAssetAddDto {
  if (!body) throw new Error('Contract asset body is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.customerAssetId) throw new Error('customerAssetId is required');

  const validCoverages = ['full_service', 'parts_only', 'labor_only', 'preventive_only', 'breakdown_only', 'parts_and_labor', 'custom'];
  if (body.coverageType && !validCoverages.includes(body.coverageType)) {
    throw new Error(`coverageType must be one of: ${validCoverages.join(', ')}`);
  }

  return {
    contractId: body.contractId,
    customerAssetId: body.customerAssetId,
    coverageType: body.coverageType || 'full_service',
    coverageStart: body.coverageStart || null,
    coverageEnd: body.coverageEnd || null,
    assetPrice: body.assetPrice || 0,
    visitFrequency: body.visitFrequency || 'quarterly',
    serviceNotes: body.serviceNotes || null,
  };
}

export interface ContractEntitlementCreateDto {
  companyId: string;
  contractId: string;
  contractAssetId?: string | null;
  entitlementType: 'preventive_visits' | 'emergency_visits' | 'total_visits' | 'labor_hours' | 'parts_allowance' | 'annual_service_value';
  totalEntitled: number;
  unit?: string;
  limitAction?: 'reject_coverage' | 'convert_to_billable' | 'require_approval';
}

export function validateContractEntitlementCreate(body: any): ContractEntitlementCreateDto {
  if (!body) throw new Error('Entitlement request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.contractId) throw new Error('contractId is required');

  const validTypes = ['preventive_visits', 'emergency_visits', 'total_visits', 'labor_hours', 'parts_allowance', 'annual_service_value'];
  if (!body.entitlementType || !validTypes.includes(body.entitlementType)) {
    throw new Error(`entitlementType must be one of: ${validTypes.join(', ')}`);
  }
  if (typeof body.totalEntitled !== 'number' || body.totalEntitled <= 0) {
    throw new Error('totalEntitled must be a strictly positive number');
  }

  const validActions = ['reject_coverage', 'convert_to_billable', 'require_approval'];
  if (body.limitAction && !validActions.includes(body.limitAction)) {
    throw new Error(`limitAction must be one of: ${validActions.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    contractId: body.contractId,
    contractAssetId: body.contractAssetId || null,
    entitlementType: body.entitlementType,
    totalEntitled: body.totalEntitled,
    unit: body.unit || (body.entitlementType.includes('visits') ? 'visits' : body.entitlementType.includes('hours') ? 'hours' : 'INR'),
    limitAction: body.limitAction || 'convert_to_billable',
  };
}

/**
 * =============================================================================
 * Supplier Management & Catalog Validation Schemas
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

export type SupplierType =
  | 'PARTS_SUPPLIER'
  | 'EQUIPMENT_SUPPLIER'
  | 'SERVICE_PROVIDER'
  | 'CONTRACTOR'
  | 'GENERAL_SUPPLIER';

export type SupplierStatus =
  | 'PROSPECT'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'SUSPENDED'
  | 'INACTIVE'
  | 'BLACKLISTED';

export interface SupplierContactDto {
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  isPrimary?: boolean;
}

export interface SupplierCreateDto {
  companyId: string;
  code: string;
  name: string;
  legalName?: string | null;
  supplierType?: SupplierType;
  category?: string;
  taxId?: string | null;
  panNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  paymentAddress?: string | null;
  currency?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  status?: SupplierStatus;
  contacts?: SupplierContactDto[];
}

export interface SupplierUpdateDto {
  name?: string;
  legalName?: string | null;
  supplierType?: SupplierType;
  category?: string;
  taxId?: string | null;
  panNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  paymentAddress?: string | null;
  currency?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
}

export interface SupplierStatusChangeDto {
  status: SupplierStatus;
  reason: string;
}

export interface SupplierProductMappingDto {
  companyId: string;
  supplierId: string;
  itemId: string;
  supplierSku?: string | null;
  supplierDescription?: string | null;
  unit?: string;
  standardPurchasePrice?: number | null;
  lastPurchasePrice?: number | null;
  minOrderQuantity?: number;
  leadTimeDays?: number;
  isPreferred?: boolean;
}

export function validateSupplierCreate(body: any): SupplierCreateDto {
  if (!body) throw new Error('Supplier body is required');
  const companyId = body.companyId || body.company_id;
  const code = (body.code || '').trim().toUpperCase();
  const name = (body.name || '').trim();

  if (!companyId) throw new Error('companyId is required');
  if (!code) throw new Error('Supplier code is required');
  if (!name) throw new Error('Supplier name is required');

  const validTypes: SupplierType[] = [
    'PARTS_SUPPLIER',
    'EQUIPMENT_SUPPLIER',
    'SERVICE_PROVIDER',
    'CONTRACTOR',
    'GENERAL_SUPPLIER',
  ];
  const rawType = (body.supplierType || body.supplier_type || 'PARTS_SUPPLIER').toUpperCase();
  if (!validTypes.includes(rawType as SupplierType)) {
    throw new Error(`Invalid supplier type: ${rawType}`);
  }

  const validStatuses: SupplierStatus[] = [
    'PROSPECT',
    'ACTIVE',
    'ON_HOLD',
    'SUSPENDED',
    'INACTIVE',
    'BLACKLISTED',
  ];
  const rawStatus = (body.status || 'ACTIVE').toUpperCase();
  if (!validStatuses.includes(rawStatus as SupplierStatus)) {
    throw new Error(`Invalid supplier status: ${rawStatus}`);
  }

  return {
    companyId,
    code,
    name,
    legalName: body.legalName || body.legal_name || null,
    supplierType: rawType as SupplierType,
    category: body.category || 'GENERAL',
    taxId: body.taxId || body.tax_id || null,
    panNumber: body.panNumber || body.pan_number || null,
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    phone: body.phone ? String(body.phone).trim() : null,
    website: body.website ? String(body.website).trim() : null,
    address: body.address ? String(body.address).trim() : null,
    billingAddress: body.billingAddress || body.billing_address || null,
    paymentAddress: body.paymentAddress || body.payment_address || null,
    currency: body.currency || 'AED',
    paymentTermsDays: body.paymentTermsDays !== undefined ? Math.max(0, parseInt(body.paymentTermsDays, 10)) : 30,
    creditLimit: body.creditLimit !== undefined ? Math.max(0, Number(body.creditLimit)) : 0,
    status: rawStatus as SupplierStatus,
    contacts: Array.isArray(body.contacts) ? body.contacts : [],
  };
}

export function validateSupplierUpdate(body: any): SupplierUpdateDto {
  if (!body) throw new Error('Supplier update body is required');

  const out: SupplierUpdateDto = {};
  if (body.name !== undefined) out.name = String(body.name).trim();
  if (body.legalName !== undefined || body.legal_name !== undefined) {
    out.legalName = body.legalName || body.legal_name || null;
  }
  if (body.supplierType !== undefined || body.supplier_type !== undefined) {
    out.supplierType = (body.supplierType || body.supplier_type).toUpperCase();
  }
  if (body.category !== undefined) out.category = String(body.category).trim();
  if (body.taxId !== undefined || body.tax_id !== undefined) out.taxId = body.taxId || body.tax_id;
  if (body.panNumber !== undefined || body.pan_number !== undefined) out.panNumber = body.panNumber || body.pan_number;
  if (body.email !== undefined) out.email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (body.phone !== undefined) out.phone = body.phone ? String(body.phone).trim() : null;
  if (body.address !== undefined) out.address = body.address ? String(body.address).trim() : null;
  if (body.creditLimit !== undefined || body.credit_limit !== undefined) {
    out.creditLimit = Math.max(0, Number(body.creditLimit || body.credit_limit));
  }
  return out;
}

export function validateSupplierStatusChange(body: any): SupplierStatusChangeDto {
  if (!body) throw new Error('Status change body is required');
  const status = (body.status || '').toUpperCase();
  const reason = (body.reason || '').trim();

  const validStatuses: SupplierStatus[] = [
    'PROSPECT',
    'ACTIVE',
    'ON_HOLD',
    'SUSPENDED',
    'INACTIVE',
    'BLACKLISTED',
  ];
  if (!validStatuses.includes(status as SupplierStatus)) {
    throw new Error(`Invalid supplier status: ${status}`);
  }
  if (!reason) {
    throw new Error('A reason is required when changing supplier status');
  }

  return { status: status as SupplierStatus, reason };
}

export function validateSupplierProductMapping(body: any): SupplierProductMappingDto {
  if (!body) throw new Error('Supplier product mapping body is required');
  const companyId = body.companyId || body.company_id;
  const supplierId = body.supplierId || body.supplier_id;
  const itemId = body.itemId || body.item_id;

  if (!companyId) throw new Error('companyId is required');
  if (!supplierId) throw new Error('supplierId is required');
  if (!itemId) throw new Error('itemId is required');

  return {
    companyId,
    supplierId,
    itemId,
    supplierSku: body.supplierSku || body.supplier_sku || null,
    supplierDescription: body.supplierDescription || body.supplier_description || null,
    unit: body.unit || 'pcs',
    standardPurchasePrice: body.standardPurchasePrice !== undefined ? Number(body.standardPurchasePrice) : null,
    lastPurchasePrice: body.lastPurchasePrice !== undefined ? Number(body.lastPurchasePrice) : null,
    minOrderQuantity: body.minOrderQuantity !== undefined ? Number(body.minOrderQuantity) : 1,
    leadTimeDays: body.leadTimeDays !== undefined ? Number(body.leadTimeDays) : 7,
    isPreferred: Boolean(body.isPreferred || body.is_preferred),
  };
}

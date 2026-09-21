import { DispatchAssetPayload, ReturnAssetPayload } from '../services/rental-handover.service.js';
import { RequestExtensionDTO } from '../services/rental-extension.service.js';
import { AssessDamageDTO, RentalDamageType, RentalDamageSeverity, RentalResponsibility } from '../services/rental-damage.service.js';
import { RecordDepositActionDTO, RentalDepositAction } from '../services/rental-deposit.service.js';

export function validateRentalDispatch(body: any): DispatchAssetPayload {
  if (!body) throw new Error('Dispatch payload is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.assetId) throw new Error('assetId is required');
  if (typeof body.meterReading !== 'number' || body.meterReading < 0) {
    throw new Error('meterReading must be a non-negative number');
  }

  return {
    contractId: body.contractId,
    assetId: body.assetId,
    meterReading: body.meterReading,
    condition: body.condition || 'good',
    signatureUrl: body.signatureUrl || undefined,
    photos: Array.isArray(body.photos) ? body.photos : [],
    notes: body.notes || undefined,
    carrierInfo: body.carrierInfo || {},
  };
}

export function validateRentalReturn(body: any): ReturnAssetPayload {
  if (!body) throw new Error('Return payload is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.assetId) throw new Error('assetId is required');
  if (typeof body.meterReading !== 'number' || body.meterReading < 0) {
    throw new Error('meterReading must be a non-negative number');
  }

  return {
    contractId: body.contractId,
    assetId: body.assetId,
    meterReading: body.meterReading,
    condition: body.condition || 'good',
    cleaningRequired: Boolean(body.cleaningRequired),
    damageNotes: body.damageNotes || undefined,
    damageCharge: body.damageCharge ? Number(body.damageCharge) : 0,
    cleaningCharge: body.cleaningCharge ? Number(body.cleaningCharge) : 0,
    photos: Array.isArray(body.photos) ? body.photos : [],
    notes: body.notes || undefined,
    returnLocationId: body.returnLocationId || undefined,
  };
}

export function validateRentalExtensionRequest(body: any): RequestExtensionDTO {
  if (!body) throw new Error('Extension request payload is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.extendedEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.extendedEndDate)) {
    throw new Error('extendedEndDate is required and must be in YYYY-MM-DD format');
  }

  return {
    contractId: body.contractId,
    extendedEndDate: body.extendedEndDate,
    notes: body.notes || undefined,
  };
}

export function validateRentalDamageAssessment(body: any): AssessDamageDTO {
  if (!body) throw new Error('Damage assessment payload is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.assetId) throw new Error('assetId is required');
  if (!body.returnId) throw new Error('returnId is required');
  if (!body.description) throw new Error('description is required');

  const validTypes: RentalDamageType[] = ['mechanical', 'electrical', 'structural', 'cosmetic', 'missing_parts', 'total_loss'];
  if (!body.damageType || !validTypes.includes(body.damageType)) {
    throw new Error(`damageType must be one of: ${validTypes.join(', ')}`);
  }

  const validSeverities: RentalDamageSeverity[] = ['minor', 'moderate', 'severe', 'total_loss'];
  if (!body.severity || !validSeverities.includes(body.severity)) {
    throw new Error(`severity must be one of: ${validSeverities.join(', ')}`);
  }

  const validResp: RentalResponsibility[] = ['full', 'partial', 'waived', 'disputed'];
  if (body.customerResponsibility && !validResp.includes(body.customerResponsibility)) {
    throw new Error(`customerResponsibility must be one of: ${validResp.join(', ')}`);
  }

  return {
    contractId: body.contractId,
    assetId: body.assetId,
    returnId: body.returnId,
    damageType: body.damageType,
    severity: body.severity,
    description: body.description,
    photos: Array.isArray(body.photos) ? body.photos : [],
    estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : 0,
    customerResponsibility: body.customerResponsibility || 'full',
    approvedCharge: body.approvedCharge ? Number(body.approvedCharge) : 0,
    spawnWorkOrder: body.spawnWorkOrder !== undefined ? Boolean(body.spawnWorkOrder) : true,
  };
}

export function validateRentalDepositAction(body: any): RecordDepositActionDTO {
  if (!body) throw new Error('Deposit action payload is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    throw new Error('amount must be a positive number');
  }

  const validActions: RentalDepositAction[] = ['receipt', 'refund', 'damage_deduction', 'rent_adjustment', 'forfeiture'];
  if (!body.action || !validActions.includes(body.action)) {
    throw new Error(`action must be one of: ${validActions.join(', ')}`);
  }

  return {
    contractId: body.contractId,
    action: body.action,
    amount: body.amount,
    paymentMethod: body.paymentMethod || 'bank_transfer',
    paymentReference: body.paymentReference || undefined,
    notes: body.notes || undefined,
  };
}

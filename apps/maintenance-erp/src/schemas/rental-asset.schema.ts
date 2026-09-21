import { CreateRentalAssetDTO, UpdateRentalAssetDTO } from '../services/rental-asset.service.js';

export function validateRentalAssetCreate(body: any): CreateRentalAssetDTO {
  if (!body) throw new Error('Rental asset payload is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.assetCode || typeof body.assetCode !== 'string' || body.assetCode.trim() === '') {
    throw new Error('assetCode is required');
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    throw new Error('name is required');
  }
  if (typeof body.dailyRate !== 'number' || body.dailyRate < 0) {
    throw new Error('dailyRate must be a non-negative number');
  }

  const validOwnership = ['owned', 'leased', 'third_party'];
  if (body.ownershipType && !validOwnership.includes(body.ownershipType)) {
    throw new Error(`ownershipType must be one of: ${validOwnership.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    branchId: body.branchId || undefined,
    assetCode: body.assetCode.trim(),
    name: body.name.trim(),
    category: body.category || undefined,
    itemId: body.itemId || undefined,
    serialNumberId: body.serialNumberId || undefined,
    serialNumber: body.serialNumber || undefined,
    currentLocationId: body.currentLocationId || undefined,
    ownershipType: body.ownershipType || 'owned',
    registrationNumber: body.registrationNumber || undefined,
    customerAssetId: body.customerAssetId || undefined,
    dailyRate: body.dailyRate,
    weeklyRate: body.weeklyRate !== undefined ? Number(body.weeklyRate) : undefined,
    monthlyRate: body.monthlyRate !== undefined ? Number(body.monthlyRate) : undefined,
    depositAmount: body.depositAmount !== undefined ? Number(body.depositAmount) : undefined,
    condition: body.condition || 'good',
    meterReading: body.meterReading !== undefined ? Number(body.meterReading) : 0,
    meterUnit: body.meterUnit || 'hours',
    meterRatePerUnit: body.meterRatePerUnit !== undefined ? Number(body.meterRatePerUnit) : 0,
    includedUnitsPerDay: body.includedUnitsPerDay !== undefined ? Number(body.includedUnitsPerDay) : 8.0,
    maintenanceIntervalUnits: body.maintenanceIntervalUnits !== undefined ? Number(body.maintenanceIntervalUnits) : undefined,
    turnaroundBufferDays: body.turnaroundBufferDays !== undefined ? Number(body.turnaroundBufferDays) : 1,
    metadata: body.metadata || {},
  };
}

export function validateRentalAssetUpdate(body: any): UpdateRentalAssetDTO {
  if (!body) throw new Error('Update payload is required');
  const patch: UpdateRentalAssetDTO = {};

  if (body.name !== undefined) patch.name = String(body.name);
  if (body.category !== undefined) patch.category = String(body.category);
  if (body.currentLocationId !== undefined) patch.currentLocationId = String(body.currentLocationId);
  if (body.dailyRate !== undefined) {
    if (typeof body.dailyRate !== 'number' || body.dailyRate < 0) {
      throw new Error('dailyRate must be a non-negative number');
    }
    patch.dailyRate = body.dailyRate;
  }
  if (body.weeklyRate !== undefined) patch.weeklyRate = Number(body.weeklyRate);
  if (body.monthlyRate !== undefined) patch.monthlyRate = Number(body.monthlyRate);
  if (body.depositAmount !== undefined) patch.depositAmount = Number(body.depositAmount);
  if (body.condition !== undefined) patch.condition = String(body.condition);
  if (body.meterReading !== undefined) patch.meterReading = Number(body.meterReading);
  if (body.meterRatePerUnit !== undefined) patch.meterRatePerUnit = Number(body.meterRatePerUnit);
  if (body.includedUnitsPerDay !== undefined) patch.includedUnitsPerDay = Number(body.includedUnitsPerDay);
  if (body.maintenanceIntervalUnits !== undefined) patch.maintenanceIntervalUnits = Number(body.maintenanceIntervalUnits);
  if (body.turnaroundBufferDays !== undefined) patch.turnaroundBufferDays = Number(body.turnaroundBufferDays);
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  if (body.metadata !== undefined) patch.metadata = body.metadata;

  return patch;
}

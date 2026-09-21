import { CreateRentalContractDTO, RentalContractLineDTO } from '../services/rental-contract.service.js';

export function validateRentalContractCreate(body: any): CreateRentalContractDTO {
  if (!body) throw new Error('Rental contract payload is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!body.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    throw new Error('startDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.expectedReturnDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.expectedReturnDate)) {
    throw new Error('expectedReturnDate is required and must be in YYYY-MM-DD format');
  }
  if (new Date(body.startDate) > new Date(body.expectedReturnDate)) {
    throw new Error('startDate must be on or before expectedReturnDate');
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new Error('Rental contract must have at least one line');
  }

  const validFrequencies = ['upfront', 'daily', 'weekly', 'monthly', 'on_return'];
  if (body.billingFrequency && !validFrequencies.includes(body.billingFrequency)) {
    throw new Error(`billingFrequency must be one of: ${validFrequencies.join(', ')}`);
  }

  const validatedLines: RentalContractLineDTO[] = body.lines.map((l: any, idx: number) => {
    if (!l.rentalAssetId) throw new Error(`Line ${idx + 1}: rentalAssetId is required`);
    if (typeof l.unitRate !== 'number' || l.unitRate < 0) {
      throw new Error(`Line ${idx + 1}: unitRate must be a non-negative number`);
    }
    return {
      rentalAssetId: l.rentalAssetId,
      startDate: l.startDate || body.startDate,
      endDate: l.endDate || body.expectedReturnDate,
      rateType: l.rateType || 'daily',
      unitRate: l.unitRate,
      quantity: l.quantity ? Number(l.quantity) : 1,
      taxRate: l.taxRate !== undefined ? Number(l.taxRate) : 5.0,
      meterIncludedUnits: l.meterIncludedUnits ? Number(l.meterIncludedUnits) : 0,
      meterRatePerUnit: l.meterRatePerUnit ? Number(l.meterRatePerUnit) : 0,
      depositAmount: l.depositAmount ? Number(l.depositAmount) : 0,
    };
  });

  return {
    companyId: body.companyId,
    branchId: body.branchId || undefined,
    customerId: body.customerId,
    siteId: body.siteId || undefined,
    quotationId: body.quotationId || undefined,
    startDate: body.startDate,
    expectedReturnDate: body.expectedReturnDate,
    billingFrequency: body.billingFrequency || 'monthly',
    depositAmount: body.depositAmount !== undefined ? Number(body.depositAmount) : undefined,
    pricingTier: body.pricingTier || 'standard',
    termsAndConditions: body.termsAndConditions || undefined,
    notes: body.notes || undefined,
    lines: validatedLines,
  };
}

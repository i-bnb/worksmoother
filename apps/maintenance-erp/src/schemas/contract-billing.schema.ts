export interface ContractBillingQueryDto {
  asOfDate?: string;
}

export function validateContractBillingQuery(query: any): ContractBillingQueryDto {
  if (!query) return { asOfDate: new Date().toISOString().slice(0, 10) };
  if (query.asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(query.asOfDate)) {
    throw new Error('asOfDate must be in YYYY-MM-DD format');
  }
  return {
    asOfDate: query.asOfDate || new Date().toISOString().slice(0, 10),
  };
}

export interface ContractRenewalDto {
  priceAdjustmentPercent?: number;
  startDate?: string;
  endDate?: string;
}

export function validateContractRenewal(body: any): ContractRenewalDto {
  if (!body) return { priceAdjustmentPercent: 0 };
  if (body.priceAdjustmentPercent !== undefined) {
    if (typeof body.priceAdjustmentPercent !== 'number') {
      throw new Error('priceAdjustmentPercent must be a number');
    }
  }
  return {
    priceAdjustmentPercent: body.priceAdjustmentPercent || 0,
    startDate: body.startDate,
    endDate: body.endDate,
  };
}

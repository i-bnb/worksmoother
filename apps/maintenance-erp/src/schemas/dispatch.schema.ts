export interface DispatchQueryDto {
  companyId: string;
  territoryId?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  status?: string;
  technicianId?: string;
}

export interface CapacityQueryDto {
  companyId: string;
  technicianId?: string;
  territoryId?: string;
  date: string; // YYYY-MM-DD
}

export function validateDispatchQuery(query: any): DispatchQueryDto {
  if (!query) throw new Error('Query parameters required');
  const companyId = query.companyId || query.company_id;
  if (!companyId) throw new Error('companyId is required');
  const startDate = query.startDate || query.start_date;
  const endDate = query.endDate || query.end_date;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('startDate is required and must be in YYYY-MM-DD format');
  }
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('endDate is required and must be in YYYY-MM-DD format');
  }

  return {
    companyId,
    territoryId: query.territoryId || query.territory_id,
    startDate,
    endDate,
    status: query.status,
    technicianId: query.technicianId || query.technician_id,
  };
}

export function validateCapacityQuery(query: any): CapacityQueryDto {
  if (!query) throw new Error('Query parameters required');
  const companyId = query.companyId || query.company_id;
  if (!companyId) throw new Error('companyId is required');
  const date = query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date is required and must be in YYYY-MM-DD format');
  }

  return {
    companyId,
    technicianId: query.technicianId || query.technician_id,
    territoryId: query.territoryId || query.territory_id,
    date,
  };
}

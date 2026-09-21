export interface MaintenanceScheduleCreateDto {
  companyId: string;
  branchId?: string | null;
  contractId: string;
  contractAssetId?: string | null;
  customerAssetId?: string | null;
  scheduledDate: string;
  periodLabel: string;
  scheduleType?: 'preventive' | 'inspection' | 'calibration' | 'routine' | 'custom';
  frequency?: string;
  intervalDays?: number | null;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  checklistId?: string | null;
  assignedTechnicianId?: string | null;
  notes?: string | null;
}

export function validateMaintenanceScheduleCreate(body: any): MaintenanceScheduleCreateDto {
  if (!body) throw new Error('Maintenance schedule body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.contractId) throw new Error('contractId is required');
  if (!body.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate)) {
    throw new Error('scheduledDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.periodLabel || typeof body.periodLabel !== 'string') {
    throw new Error('periodLabel is required');
  }

  const validTypes = ['preventive', 'inspection', 'calibration', 'routine', 'custom'];
  if (body.scheduleType && !validTypes.includes(body.scheduleType)) {
    throw new Error(`scheduleType must be one of: ${validTypes.join(', ')}`);
  }

  const validPriorities = ['critical', 'high', 'medium', 'low'];
  if (body.priority && !validPriorities.includes(body.priority)) {
    throw new Error(`priority must be one of: ${validPriorities.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    contractId: body.contractId,
    contractAssetId: body.contractAssetId || null,
    customerAssetId: body.customerAssetId || null,
    scheduledDate: body.scheduledDate,
    periodLabel: body.periodLabel.trim(),
    scheduleType: body.scheduleType || 'preventive',
    frequency: body.frequency || 'quarterly',
    intervalDays: body.intervalDays || null,
    priority: body.priority || 'medium',
    checklistId: body.checklistId || null,
    assignedTechnicianId: body.assignedTechnicianId || null,
    notes: body.notes || null,
  };
}

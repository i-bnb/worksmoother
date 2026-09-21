export interface VisitCheckInDto {
  companyId: string;
  appointmentId: string;
  technicianId: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface VisitCheckOutDto {
  companyId: string;
  appointmentId: string;
  technicianId: string;
  latitude?: number | null;
  longitude?: number | null;
  workPerformed?: string | null;
  completionRemarks?: string | null;
}

export interface ServiceVisitReportCreateDto {
  companyId: string;
  visitId: string;
  workOrderId: string;
  appointmentId?: string | null;
  technicianId: string;
  customerId: string;
  assetId?: string | null;
  problemReported: string;
  diagnosis: string;
  workPerformed: string;
  partsUsedSummary?: Array<{
    item_code: string;
    item_name: string;
    quantity: number;
    unit_price?: number;
    is_billable?: boolean;
  }>;
  laborSummary?: Array<{
    technician_id: string;
    technician_name?: string;
    hours: number;
    labor_rate?: number;
  }>;
  recommendations?: string | null;
  followUpRequired?: boolean;
  followUpNotes?: string | null;
  customerRemarks?: string | null;
  technicianRemarks?: string | null;
  completionStatus?: 'resolved' | 'temporary_fix' | 'parts_pending' | 'unresolved';
}

export interface TravelRecordCreateDto {
  companyId: string;
  appointmentId: string;
  visitId?: string | null;
  technicianId: string;
  travelStart: string;
  travelEnd?: string | null;
  originReference?: string | null;
  destinationReference?: string | null;
  travelNotes?: string | null;
}

export function validateVisitCheckIn(body: any): VisitCheckInDto {
  if (!body) throw new Error('Check-in body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.technicianId) throw new Error('technicianId is required');

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    technicianId: body.technicianId,
    latitude: body.latitude !== undefined ? Number(body.latitude) : null,
    longitude: body.longitude !== undefined ? Number(body.longitude) : null,
  };
}

export function validateVisitCheckOut(body: any): VisitCheckOutDto {
  if (!body) throw new Error('Check-out body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.technicianId) throw new Error('technicianId is required');

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    technicianId: body.technicianId,
    latitude: body.latitude !== undefined ? Number(body.latitude) : null,
    longitude: body.longitude !== undefined ? Number(body.longitude) : null,
    workPerformed: body.workPerformed || null,
    completionRemarks: body.completionRemarks || null,
  };
}

export function validateServiceVisitReportCreate(body: any): ServiceVisitReportCreateDto {
  if (!body) throw new Error('Report body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.visitId) throw new Error('visitId is required');
  if (!body.workOrderId) throw new Error('workOrderId is required');
  if (!body.technicianId) throw new Error('technicianId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!body.problemReported) throw new Error('problemReported is required');
  if (!body.diagnosis) throw new Error('diagnosis is required');
  if (!body.workPerformed) throw new Error('workPerformed is required');

  const validStatuses = ['resolved', 'temporary_fix', 'parts_pending', 'unresolved'];
  if (body.completionStatus && !validStatuses.includes(body.completionStatus)) {
    throw new Error(`completionStatus must be one of: ${validStatuses.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    visitId: body.visitId,
    workOrderId: body.workOrderId,
    appointmentId: body.appointmentId || null,
    technicianId: body.technicianId,
    customerId: body.customerId,
    assetId: body.assetId || null,
    problemReported: body.problemReported.trim(),
    diagnosis: body.diagnosis.trim(),
    workPerformed: body.workPerformed.trim(),
    partsUsedSummary: Array.isArray(body.partsUsedSummary) ? body.partsUsedSummary : [],
    laborSummary: Array.isArray(body.laborSummary) ? body.laborSummary : [],
    recommendations: body.recommendations || null,
    followUpRequired: Boolean(body.followUpRequired),
    followUpNotes: body.followUpNotes || null,
    customerRemarks: body.customerRemarks || null,
    technicianRemarks: body.technicianRemarks || null,
    completionStatus: body.completionStatus || 'resolved',
  };
}

export function validateTravelRecordCreate(body: any): TravelRecordCreateDto {
  if (!body) throw new Error('Travel record body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.technicianId) throw new Error('technicianId is required');
  if (!body.travelStart) throw new Error('travelStart timestamp is required');

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    visitId: body.visitId || null,
    technicianId: body.technicianId,
    travelStart: body.travelStart,
    travelEnd: body.travelEnd || null,
    originReference: body.originReference || null,
    destinationReference: body.destinationReference || null,
    travelNotes: body.travelNotes || null,
  };
}

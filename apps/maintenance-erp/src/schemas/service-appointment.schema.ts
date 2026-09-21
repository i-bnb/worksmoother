export type AppointmentStatus =
  | 'unscheduled'
  | 'scheduled'
  | 'confirmed'
  | 'dispatched'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'no_show';

export type RescheduleReason =
  | 'CUSTOMER_REQUEST'
  | 'TECHNICIAN_UNAVAILABLE'
  | 'PART_NOT_AVAILABLE'
  | 'WEATHER'
  | 'EMERGENCY'
  | 'SLA_REASSIGNMENT'
  | 'OTHER';

export interface AppointmentCreateDto {
  companyId: string;
  branchId?: string | null;
  workOrderId: string;
  customerId: string;
  siteId: string;
  assetId?: string | null;
  assignedTechnicianId?: string | null;
  teamId?: string | null;
  territoryId?: string | null;
  appointmentDate: string; // YYYY-MM-DD
  startTime: string;       // ISO or timestamptz string
  endTime: string;         // ISO or timestamptz string
  estimatedDurationMinutes?: number;
  travelBufferMinutes?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  slaDeadline?: string | null;
  notes?: string | null;
  metadata?: Record<string, any>;
  userId?: string | null;
}

export interface AppointmentUpdateDto {
  assignedTechnicianId?: string | null;
  teamId?: string | null;
  territoryId?: string | null;
  appointmentDate?: string;
  startTime?: string;
  endTime?: string;
  estimatedDurationMinutes?: number;
  travelBufferMinutes?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  slaDeadline?: string | null;
  notes?: string | null;
  status?: AppointmentStatus;
  metadata?: Record<string, any>;
  userId?: string | null;
}

export interface AppointmentAssignDto {
  companyId: string;
  appointmentId: string;
  technicianId: string;
  teamId?: string | null;
  userId?: string | null;
}

export interface AppointmentRescheduleDto {
  companyId: string;
  appointmentId: string;
  newDate: string;      // YYYY-MM-DD
  newStartTime: string; // ISO
  newEndTime: string;   // ISO
  reason: RescheduleReason;
  reasonDetails?: string | null;
  userId?: string | null;
}

export interface AppointmentMultiAssignDto {
  companyId: string;
  appointmentId: string;
  employeeId: string;
  role?: string;
  isPrimary?: boolean;
}

export interface RequiredSkillCreateDto {
  companyId: string;
  workOrderId: string;
  skillId: string;
  minProficiencyLevel?: number; // 1-5
  isMandatory?: boolean;
  certificationRequired?: boolean;
}

export function validateAppointmentCreate(body: any): AppointmentCreateDto {
  if (!body) throw new Error('Appointment request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.workOrderId) throw new Error('workOrderId is required');
  if (!body.customerId) throw new Error('customerId is required');
  if (!body.siteId) throw new Error('siteId is required');
  if (!body.appointmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.appointmentDate)) {
    throw new Error('appointmentDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.startTime) throw new Error('startTime is required');
  if (!body.endTime) throw new Error('endTime is required');

  const start = new Date(body.startTime).getTime();
  const end = new Date(body.endTime).getTime();
  if (isNaN(start) || isNaN(end)) {
    throw new Error('startTime and endTime must be valid dates');
  }
  if (start >= end) {
    throw new Error('startTime must be strictly before endTime');
  }

  const validPriorities = ['critical', 'high', 'medium', 'low'];
  if (body.priority && !validPriorities.includes(body.priority)) {
    throw new Error(`priority must be one of: ${validPriorities.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    workOrderId: body.workOrderId,
    customerId: body.customerId,
    siteId: body.siteId,
    assetId: body.assetId || null,
    assignedTechnicianId: body.assignedTechnicianId || null,
    teamId: body.teamId || null,
    territoryId: body.territoryId || null,
    appointmentDate: body.appointmentDate,
    startTime: body.startTime,
    endTime: body.endTime,
    estimatedDurationMinutes: body.estimatedDurationMinutes !== undefined ? Number(body.estimatedDurationMinutes) : 120,
    travelBufferMinutes: body.travelBufferMinutes !== undefined ? Number(body.travelBufferMinutes) : 30,
    priority: body.priority || 'medium',
    slaDeadline: body.slaDeadline || null,
    notes: body.notes || null,
    metadata: body.metadata || {},
    userId: body.userId || null,
  };
}

export function validateAppointmentUpdate(body: any): AppointmentUpdateDto {
  if (!body) throw new Error('Update body is required');
  if (body.startTime && body.endTime) {
    const start = new Date(body.startTime).getTime();
    const end = new Date(body.endTime).getTime();
    if (start >= end) {
      throw new Error('startTime must be strictly before endTime');
    }
  }

  return body;
}

export function validateAppointmentAssign(body: any): AppointmentAssignDto {
  if (!body) throw new Error('Assignment body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.technicianId) throw new Error('technicianId is required');

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    technicianId: body.technicianId,
    teamId: body.teamId || null,
    userId: body.userId || null,
  };
}

export function validateAppointmentReschedule(body: any): AppointmentRescheduleDto {
  if (!body) throw new Error('Reschedule body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.newDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.newDate)) {
    throw new Error('newDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.newStartTime || !body.newEndTime) {
    throw new Error('newStartTime and newEndTime are required');
  }
  if (new Date(body.newStartTime).getTime() >= new Date(body.newEndTime).getTime()) {
    throw new Error('newStartTime must be strictly before newEndTime');
  }

  const validReasons: RescheduleReason[] = [
    'CUSTOMER_REQUEST', 'TECHNICIAN_UNAVAILABLE', 'PART_NOT_AVAILABLE',
    'WEATHER', 'EMERGENCY', 'SLA_REASSIGNMENT', 'OTHER'
  ];
  if (!body.reason || !validReasons.includes(body.reason)) {
    throw new Error(`reason must be one of: ${validReasons.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    newDate: body.newDate,
    newStartTime: body.newStartTime,
    newEndTime: body.newEndTime,
    reason: body.reason,
    reasonDetails: body.reasonDetails || null,
    userId: body.userId || null,
  };
}

export function validateAppointmentMultiAssign(body: any): AppointmentMultiAssignDto {
  if (!body) throw new Error('Multi-assign body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.appointmentId) throw new Error('appointmentId is required');
  if (!body.employeeId) throw new Error('employeeId is required');

  return {
    companyId: body.companyId,
    appointmentId: body.appointmentId,
    employeeId: body.employeeId,
    role: body.role || 'lead',
    isPrimary: body.isPrimary !== undefined ? Boolean(body.isPrimary) : true,
  };
}

export function validateRequiredSkillCreate(body: any): RequiredSkillCreateDto {
  if (!body) throw new Error('Required skill body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.workOrderId) throw new Error('workOrderId is required');
  if (!body.skillId) throw new Error('skillId is required');

  const lvl = body.minProficiencyLevel !== undefined ? Number(body.minProficiencyLevel) : 1;
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) {
    throw new Error('minProficiencyLevel must be an integer between 1 and 5');
  }

  return {
    companyId: body.companyId,
    workOrderId: body.workOrderId,
    skillId: body.skillId,
    minProficiencyLevel: lvl,
    isMandatory: body.isMandatory !== undefined ? Boolean(body.isMandatory) : true,
    certificationRequired: Boolean(body.certificationRequired),
  };
}

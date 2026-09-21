export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
export type HolidayType = 'public' | 'company' | 'optional' | 'regional';
export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'on_leave'
  | 'holiday'
  | 'week_off'
  | 'remote'
  | 'work_from_home';

export type LeaveAccrualMethod = 'yearly' | 'monthly' | 'joining_date' | 'custom';
export type LeaveRequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface WorkScheduleCreateDto {
  companyId: string;
  code: string;
  name: string;
  shiftStartTime: string; // HH:MM:SS or HH:MM
  shiftEndTime: string;   // HH:MM:SS or HH:MM
  workingDays?: number[]; // [1, 2, 3, 4, 5] (1 = Monday, 7 = Sunday)
  breakMinutes?: number;
  gracePeriodMinutes?: number;
  halfDayThresholdMinutes?: number;
  fullDayThresholdMinutes?: number;
  overtimeThresholdMinutes?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface ScheduleAssignmentDto {
  companyId: string;
  employeeId: string;
  scheduleId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface HolidayCalendarCreateDto {
  companyId: string;
  code: string;
  name: string;
  year: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface HolidayCreateDto {
  companyId: string;
  calendarId: string;
  holidayDate: string;
  name: string;
  holidayType?: HolidayType;
  isRecurring?: boolean;
}

export interface PunchRecordDto {
  companyId: string;
  employeeId: string;
  punchTime: string; // ISO string
  punchType: PunchType;
  latitude?: number | null;
  longitude?: number | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  notes?: string | null;
}

export interface DailyAttendanceCalcDto {
  companyId: string;
  employeeId: string;
  attendanceDate: string;
  scheduleId?: string | null;
}

export interface AttendanceCorrectionDto {
  companyId: string;
  employeeId: string;
  attendanceDate: string;
  requestedStatus?: AttendanceStatus;
  requestedPunchIn?: string | null;
  requestedPunchOut?: string | null;
  reason: string;
}

export interface LeaveTypeCreateDto {
  companyId: string;
  code: string;
  name: string;
  isPaid?: boolean;
  isEncashable?: boolean;
  requiresApproval?: boolean;
  description?: string | null;
  isActive?: boolean;
}

export interface LeavePolicyCreateDto {
  companyId: string;
  leaveTypeId: string;
  accrualMethod?: LeaveAccrualMethod;
  annualAllocation: number;
  maxCarryoverDays?: number;
  carryoverExpiryMonths?: number;
  minServiceDaysRequired?: number;
  noticeDaysRequired?: number;
  maxConsecutiveDays?: number;
  allowHalfDay?: boolean;
  allowNegativeBalance?: boolean;
  isActive?: boolean;
}

export interface LeaveBalanceInitDto {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  openingBalance?: number;
  accruedDays?: number;
  carryoverDays?: number;
}

export interface LeaveRequestSubmitDto {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: 'first_half' | 'second_half' | null;
  reason?: string | null;
  contactDuringLeave?: string | null;
}

export interface LeaveApprovalDto {
  requestId: string;
  approverId: string;
  approved: boolean;
  rejectionReason?: string | null;
}

export interface OvertimeRecordDto {
  companyId: string;
  employeeId: string;
  overtimeDate: string;
  startTime?: string | null;
  endTime?: string | null;
  overtimeHours: number;
  rateMultiplier?: number;
  reason?: string | null;
}

export function validateWorkScheduleCreate(body: any): WorkScheduleCreateDto {
  if (!body) throw new Error('Work schedule body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');
  if (!body.shiftStartTime) throw new Error('shiftStartTime is required');
  if (!body.shiftEndTime) throw new Error('shiftEndTime is required');

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    shiftStartTime: body.shiftStartTime.trim(),
    shiftEndTime: body.shiftEndTime.trim(),
    workingDays: Array.isArray(body.workingDays) ? body.workingDays : [1, 2, 3, 4, 5],
    breakMinutes: body.breakMinutes !== undefined ? Number(body.breakMinutes) : 60,
    gracePeriodMinutes: body.gracePeriodMinutes !== undefined ? Number(body.gracePeriodMinutes) : 15,
    halfDayThresholdMinutes: body.halfDayThresholdMinutes !== undefined ? Number(body.halfDayThresholdMinutes) : 240,
    fullDayThresholdMinutes: body.fullDayThresholdMinutes !== undefined ? Number(body.fullDayThresholdMinutes) : 480,
    overtimeThresholdMinutes: body.overtimeThresholdMinutes !== undefined ? Number(body.overtimeThresholdMinutes) : 540,
    isDefault: Boolean(body.isDefault),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateScheduleAssignment(body: any): ScheduleAssignmentDto {
  if (!body) throw new Error('Schedule assignment body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.scheduleId) throw new Error('scheduleId is required');
  if (!body.effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveFrom)) {
    throw new Error('effectiveFrom is required and must be in YYYY-MM-DD format');
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    scheduleId: body.scheduleId,
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo || null,
  };
}

export function validateHolidayCalendarCreate(body: any): HolidayCalendarCreateDto {
  if (!body) throw new Error('Holiday calendar body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a valid integer between 2000 and 2100');
  }

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    year,
    isDefault: Boolean(body.isDefault),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateHolidayCreate(body: any): HolidayCreateDto {
  if (!body) throw new Error('Holiday body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.calendarId) throw new Error('calendarId is required');
  if (!body.holidayDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.holidayDate)) {
    throw new Error('holidayDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.name) throw new Error('name is required');

  const validTypes: HolidayType[] = ['public', 'company', 'optional', 'regional'];
  if (body.holidayType && !validTypes.includes(body.holidayType)) {
    throw new Error(`holidayType must be one of: ${validTypes.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    calendarId: body.calendarId,
    holidayDate: body.holidayDate,
    name: body.name.trim(),
    holidayType: body.holidayType || 'public',
    isRecurring: Boolean(body.isRecurring),
  };
}

export function validatePunchRecord(body: any): PunchRecordDto {
  if (!body) throw new Error('Punch body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.punchTime) throw new Error('punchTime is required');

  const validPunches: PunchType[] = ['clock_in', 'clock_out', 'break_start', 'break_end'];
  if (!body.punchType || !validPunches.includes(body.punchType)) {
    throw new Error(`punchType must be one of: ${validPunches.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    punchTime: body.punchTime,
    punchType: body.punchType,
    latitude: body.latitude !== undefined ? Number(body.latitude) : null,
    longitude: body.longitude !== undefined ? Number(body.longitude) : null,
    deviceId: body.deviceId || null,
    ipAddress: body.ipAddress || null,
    notes: body.notes || null,
  };
}

export function validateDailyAttendanceCalc(body: any): DailyAttendanceCalcDto {
  if (!body) throw new Error('Calculation request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.attendanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.attendanceDate)) {
    throw new Error('attendanceDate is required and must be in YYYY-MM-DD format');
  }
  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    attendanceDate: body.attendanceDate,
    scheduleId: body.scheduleId || null,
  };
}

export function validateAttendanceCorrection(body: any): AttendanceCorrectionDto {
  if (!body) throw new Error('Correction body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.attendanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.attendanceDate)) {
    throw new Error('attendanceDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.reason) throw new Error('reason is required');

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    attendanceDate: body.attendanceDate,
    requestedStatus: body.requestedStatus || undefined,
    requestedPunchIn: body.requestedPunchIn || null,
    requestedPunchOut: body.requestedPunchOut || null,
    reason: body.reason.trim(),
  };
}

export function validateLeaveTypeCreate(body: any): LeaveTypeCreateDto {
  if (!body) throw new Error('Leave type body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    isPaid: body.isPaid !== undefined ? Boolean(body.isPaid) : true,
    isEncashable: Boolean(body.isEncashable),
    requiresApproval: body.requiresApproval !== undefined ? Boolean(body.requiresApproval) : true,
    description: body.description || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateLeavePolicyCreate(body: any): LeavePolicyCreateDto {
  if (!body) throw new Error('Leave policy body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.leaveTypeId) throw new Error('leaveTypeId is required');
  if (typeof body.annualAllocation !== 'number' || body.annualAllocation < 0) {
    throw new Error('annualAllocation must be a non-negative number');
  }

  const validMethods: LeaveAccrualMethod[] = ['yearly', 'monthly', 'joining_date', 'custom'];
  if (body.accrualMethod && !validMethods.includes(body.accrualMethod)) {
    throw new Error(`accrualMethod must be one of: ${validMethods.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    leaveTypeId: body.leaveTypeId,
    accrualMethod: body.accrualMethod || 'yearly',
    annualAllocation: Number(body.annualAllocation),
    maxCarryoverDays: body.maxCarryoverDays !== undefined ? Number(body.maxCarryoverDays) : 0,
    carryoverExpiryMonths: body.carryoverExpiryMonths !== undefined ? Number(body.carryoverExpiryMonths) : 12,
    minServiceDaysRequired: body.minServiceDaysRequired !== undefined ? Number(body.minServiceDaysRequired) : 0,
    noticeDaysRequired: body.noticeDaysRequired !== undefined ? Number(body.noticeDaysRequired) : 0,
    maxConsecutiveDays: body.maxConsecutiveDays !== undefined ? Number(body.maxConsecutiveDays) : 30,
    allowHalfDay: body.allowHalfDay !== undefined ? Boolean(body.allowHalfDay) : true,
    allowNegativeBalance: Boolean(body.allowNegativeBalance),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateLeaveBalanceInit(body: any): LeaveBalanceInitDto {
  if (!body) throw new Error('Leave balance body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.leaveTypeId) throw new Error('leaveTypeId is required');
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a valid integer');
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    leaveTypeId: body.leaveTypeId,
    year,
    openingBalance: body.openingBalance !== undefined ? Number(body.openingBalance) : 0,
    accruedDays: body.accruedDays !== undefined ? Number(body.accruedDays) : 0,
    carryoverDays: body.carryoverDays !== undefined ? Number(body.carryoverDays) : 0,
  };
}

export function validateLeaveRequestSubmit(body: any): LeaveRequestSubmitDto {
  if (!body) throw new Error('Leave request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.leaveTypeId) throw new Error('leaveTypeId is required');
  if (!body.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    throw new Error('startDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
    throw new Error('endDate is required and must be in YYYY-MM-DD format');
  }
  if (new Date(body.startDate) > new Date(body.endDate)) {
    throw new Error('startDate must be on or before endDate');
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    leaveTypeId: body.leaveTypeId,
    startDate: body.startDate,
    endDate: body.endDate,
    isHalfDay: Boolean(body.isHalfDay),
    halfDayPeriod: body.halfDayPeriod || null,
    reason: body.reason ? body.reason.trim() : null,
    contactDuringLeave: body.contactDuringLeave ? body.contactDuringLeave.trim() : null,
  };
}

export function validateLeaveApproval(body: any): LeaveApprovalDto {
  if (!body) throw new Error('Approval body is required');
  if (!body.requestId) throw new Error('requestId is required');
  if (!body.approverId) throw new Error('approverId is required');
  if (typeof body.approved !== 'boolean') throw new Error('approved must be a boolean');

  return {
    requestId: body.requestId,
    approverId: body.approverId,
    approved: body.approved,
    rejectionReason: body.rejectionReason || null,
  };
}

export function validateOvertimeRecord(body: any): OvertimeRecordDto {
  if (!body) throw new Error('Overtime record body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.overtimeDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.overtimeDate)) {
    throw new Error('overtimeDate is required and must be in YYYY-MM-DD format');
  }
  if (typeof body.overtimeHours !== 'number' || body.overtimeHours <= 0) {
    throw new Error('overtimeHours must be a positive number');
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    overtimeDate: body.overtimeDate,
    startTime: body.startTime || null,
    endTime: body.endTime || null,
    overtimeHours: Number(body.overtimeHours),
    rateMultiplier: body.rateMultiplier !== undefined ? Number(body.rateMultiplier) : 1.5,
    reason: body.reason || null,
  };
}

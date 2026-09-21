import { SupabaseClient } from '@supabase/supabase-js';
import { AttendanceService } from '../services/attendance.service.js';
import { LeaveService } from '../services/leave.service.js';
import {
  validateWorkScheduleCreate,
  validateScheduleAssignment,
  validateHolidayCalendarCreate,
  validateHolidayCreate,
  validatePunchRecord,
  validateDailyAttendanceCalc,
  validateAttendanceCorrection,
  validateLeaveTypeCreate,
  validateLeavePolicyCreate,
  validateLeaveBalanceInit,
  validateLeaveRequestSubmit,
  validateLeaveApproval,
  validateOvertimeRecord,
} from '../schemas/attendance-leave.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class AttendanceLeaveApiController {
  static async createWorkSchedule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateWorkScheduleCreate(req.body);
      const data = await AttendanceService.createWorkSchedule(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async assignSchedule(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateScheduleAssignment(req.body);
      const data = await AttendanceService.assignSchedule(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createHolidayCalendar(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateHolidayCalendarCreate(req.body);
      const data = await AttendanceService.createHolidayCalendar(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async addHoliday(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateHolidayCreate(req.body);
      const data = await AttendanceService.addHoliday(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async recordPunch(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validatePunchRecord(req.body);
      const data = await AttendanceService.recordPunch(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async processDailyAttendance(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateDailyAttendanceCalc(req.body);
      const data = await AttendanceService.processDailyAttendance(
        client,
        validated.companyId,
        validated.employeeId,
        validated.attendanceDate
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async requestCorrection(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateAttendanceCorrection(req.body);
      const data = await AttendanceService.requestCorrection(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveCorrection(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Correction ID is required' };
      const { approverId, approved, rejectionReason } = req.body || {};
      if (!approverId || approved === undefined) {
        return { status: 400, error: 'approverId and approved boolean are required' };
      }
      const data = await AttendanceService.approveCorrection(
        client,
        id,
        approverId,
        Boolean(approved),
        rejectionReason
      );
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createLeaveType(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateLeaveTypeCreate(req.body);
      const data = await LeaveService.createLeaveType(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createLeavePolicy(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateLeavePolicyCreate(req.body);
      const data = await LeaveService.createLeavePolicy(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async initializeLeaveBalance(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateLeaveBalanceInit(req.body);
      const data = await LeaveService.initializeLeaveBalance(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getLeaveBalance(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const employeeId = req.params?.employeeId || req.query?.employeeId;
      const leaveTypeId = req.params?.leaveTypeId || req.query?.leaveTypeId;
      const year = req.query?.year ? parseInt(req.query.year, 10) : new Date().getFullYear();

      if (!employeeId || !leaveTypeId) {
        return { status: 400, error: 'employeeId and leaveTypeId are required' };
      }

      const data = await LeaveService.getLeaveBalance(client, employeeId, leaveTypeId, year);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async submitLeaveRequest(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateLeaveRequestSubmit(req.body);
      const data = await LeaveService.submitLeaveRequest(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async approveLeaveRequest(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateLeaveApproval(req.body);
      const data = await LeaveService.approveLeaveRequest(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async cancelLeaveRequest(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      const employeeId = req.body?.employeeId || req.query?.employeeId;
      if (!id || !employeeId) {
        return { status: 400, error: 'Request ID and employeeId are required' };
      }
      const data = await LeaveService.cancelLeaveRequest(client, id, employeeId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async recordOvertime(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateOvertimeRecord(req.body);
      const data = await AttendanceService.recordOvertime(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

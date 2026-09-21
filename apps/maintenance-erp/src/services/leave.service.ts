import { SupabaseClient } from '@supabase/supabase-js';
import {
  LeaveTypeCreateDto,
  LeavePolicyCreateDto,
  LeaveBalanceInitDto,
  LeaveRequestSubmitDto,
  LeaveApprovalDto,
} from '../schemas/attendance-leave.schema.js';

export interface LeaveInterval {
  id?: string;
  startDate: string;
  endDate: string;
  status?: string;
}

export class LeaveService {
  /**
   * Pure algorithm to detect date overlaps between a requested range and existing active leave requests.
   */
  static checkLeaveOverlap(
    existing: LeaveInterval[],
    startDate: string,
    endDate: string,
    excludeId?: string
  ): boolean {
    const reqStart = new Date(startDate).getTime();
    const reqEnd = new Date(endDate).getTime();

    for (const item of existing) {
      if (excludeId && item.id === excludeId) continue;
      if (item.status && ['rejected', 'cancelled'].includes(item.status)) continue;

      const itemStart = new Date(item.startDate).getTime();
      const itemEnd = new Date(item.endDate).getTime();

      // [reqStart, reqEnd] overlaps with [itemStart, itemEnd] if reqStart <= itemEnd and reqEnd >= itemStart
      if (reqStart <= itemEnd && reqEnd >= itemStart) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculates calendar or working days between two dates inclusive.
   */
  static calculateLeaveDays(startDate: string, endDate: string, isHalfDay?: boolean): number {
    if (isHalfDay) return 0.5;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }

  /**
   * Creates a leave type.
   */
  static async createLeaveType(client: SupabaseClient, dto: LeaveTypeCreateDto) {
    const { data, error } = await client
      .from('leave_types')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        is_paid: dto.isPaid !== undefined ? dto.isPaid : true,
        is_encashable: Boolean(dto.isEncashable),
        requires_approval: dto.requiresApproval !== undefined ? dto.requiresApproval : true,
        description: dto.description || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create leave type: ${error.message}`);
    return data;
  }

  /**
   * Creates or configures a leave policy.
   */
  static async createLeavePolicy(client: SupabaseClient, dto: LeavePolicyCreateDto) {
    const { data, error } = await client
      .from('leave_policies')
      .insert({
        company_id: dto.companyId,
        leave_type_id: dto.leaveTypeId,
        accrual_method: dto.accrualMethod || 'yearly',
        annual_allocation: dto.annualAllocation,
        max_carryover_days: dto.maxCarryoverDays || 0,
        carryover_expiry_months: dto.carryoverExpiryMonths || 12,
        min_service_days_required: dto.minServiceDaysRequired || 0,
        notice_days_required: dto.noticeDaysRequired || 0,
        max_consecutive_days: dto.maxConsecutiveDays || 30,
        allow_half_day: dto.allowHalfDay !== undefined ? dto.allowHalfDay : true,
        allow_negative_balance: Boolean(dto.allowNegativeBalance),
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select('*, leave_type:leave_types(*)')
      .single();

    if (error) throw new Error(`Failed to create leave policy: ${error.message}`);
    return data;
  }

  /**
   * Initializes or updates employee leave balance for a given year.
   */
  static async initializeLeaveBalance(client: SupabaseClient, dto: LeaveBalanceInitDto) {
    const opening = dto.openingBalance || 0;
    const accrued = dto.accruedDays || 0;
    const carryover = dto.carryoverDays || 0;
    const closing = opening + accrued + carryover;

    const { data, error } = await client
      .from('leave_balances')
      .upsert(
        {
          company_id: dto.companyId,
          employee_id: dto.employeeId,
          leave_type_id: dto.leaveTypeId,
          year: dto.year,
          opening_balance: opening,
          accrued_days: accrued,
          carryover_days: carryover,
          closing_balance: closing,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id, employee_id, leave_type_id, year' }
      )
      .select('*, leave_type:leave_types(*)')
      .single();

    if (error) throw new Error(`Failed to initialize leave balance: ${error.message}`);
    return data;
  }

  /**
   * Fetches leave balance for an employee.
   */
  static async getLeaveBalance(
    client: SupabaseClient,
    employeeId: string,
    leaveTypeId: string,
    year: number
  ) {
    const { data, error } = await client
      .from('leave_balances')
      .select('*, leave_type:leave_types(*)')
      .eq('employee_id', employeeId)
      .eq('leave_type_id', leaveTypeId)
      .eq('year', year)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch leave balance: ${error.message}`);
    return data;
  }

  /**
   * Submits a leave request with overlap check and policy balance validation.
   */
  static async submitLeaveRequest(client: SupabaseClient, dto: LeaveRequestSubmitDto) {
    // 1. Fetch active leave requests to detect overlap
    const { data: existingLeaves } = await client
      .from('leave_requests')
      .select('id, start_date, end_date, status')
      .eq('company_id', dto.companyId)
      .eq('employee_id', dto.employeeId)
      .in('status', ['submitted', 'approved']);

    if (existingLeaves && existingLeaves.length > 0) {
      const intervals: LeaveInterval[] = existingLeaves.map((l) => ({
        id: l.id,
        startDate: l.start_date,
        endDate: l.end_date,
        status: l.status,
      }));

      if (this.checkLeaveOverlap(intervals, dto.startDate, dto.endDate)) {
        throw new Error('Leave request overlaps with an existing pending or approved leave');
      }
    }

    const totalDays = this.calculateLeaveDays(dto.startDate, dto.endDate, dto.isHalfDay);

    // 2. Check balance if policy requires
    const year = new Date(dto.startDate).getFullYear();
    const balance = await this.getLeaveBalance(client, dto.employeeId, dto.leaveTypeId, year);

    // If policy doesn't allow negative balance
    const { data: policy } = await client
      .from('leave_policies')
      .select('allow_negative_balance')
      .eq('company_id', dto.companyId)
      .eq('leave_type_id', dto.leaveTypeId)
      .maybeSingle();

    if (policy && !policy.allow_negative_balance && balance) {
      const available = (balance.opening_balance + balance.accrued_days + balance.carryover_days) - balance.used_days;
      if (totalDays > available) {
        throw new Error(`Insufficient leave balance: requested ${totalDays} days, available ${available} days`);
      }
    }

    const { data, error } = await client
      .from('leave_requests')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        leave_type_id: dto.leaveTypeId,
        start_date: dto.startDate,
        end_date: dto.endDate,
        is_half_day: Boolean(dto.isHalfDay),
        half_day_period: dto.halfDayPeriod || null,
        total_days: totalDays,
        reason: dto.reason || null,
        contact_during_leave: dto.contactDuringLeave || null,
        status: 'submitted',
      })
      .select('*, leave_type:leave_types(*), employee:employees(id, display_name, work_email)')
      .single();

    if (error) throw new Error(`Failed to submit leave request: ${error.message}`);
    return data;
  }

  /**
   * Approves or rejects a leave request.
   * If approved:
   *  - updates leave balance used_days
   *  - auto-marks daily attendance records as 'on_leave'
   */
  static async approveLeaveRequest(client: SupabaseClient, dto: LeaveApprovalDto) {
    const { data: leaveReq, error: fetchErr } = await client
      .from('leave_requests')
      .select('*')
      .eq('id', dto.requestId)
      .single();

    if (fetchErr || !leaveReq) throw new Error('Leave request not found');
    if (leaveReq.status !== 'submitted') {
      throw new Error(`Cannot approve leave request with status '${leaveReq.status}'`);
    }

    const nextStatus = dto.approved ? 'approved' : 'rejected';
    const { data: updated, error } = await client
      .from('leave_requests')
      .update({
        status: nextStatus,
        approved_by: dto.approverId,
        approved_at: new Date().toISOString(),
        rejection_reason: dto.rejectionReason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dto.requestId)
      .select()
      .single();

    if (error) throw new Error(`Failed to process leave approval: ${error.message}`);

    if (dto.approved) {
      // 1. Update leave balance
      const year = new Date(leaveReq.start_date).getFullYear();
      const balance = await this.getLeaveBalance(
        client,
        leaveReq.employee_id,
        leaveReq.leave_type_id,
        year
      );

      if (balance) {
        const newUsed = Number(balance.used_days || 0) + Number(leaveReq.total_days);
        const newClosing = (Number(balance.opening_balance) + Number(balance.accrued_days) + Number(balance.carryover_days)) - newUsed;
        await client
          .from('leave_balances')
          .update({
            used_days: newUsed,
            closing_balance: newClosing,
            updated_at: new Date().toISOString(),
          })
          .eq('id', balance.id);
      }

      // 2. Mark attendance days as 'on_leave'
      const start = new Date(leaveReq.start_date);
      const end = new Date(leaveReq.end_date);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        await client.from('attendance_days').upsert(
          {
            company_id: leaveReq.company_id,
            employee_id: leaveReq.employee_id,
            attendance_date: dateStr,
            status: 'on_leave',
            notes: `Approved leave request #${leaveReq.leave_number || leaveReq.id}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'company_id, employee_id, attendance_date' }
        );
      }
    }

    return updated;
  }

  /**
   * Cancels a submitted or approved leave request.
   */
  static async cancelLeaveRequest(client: SupabaseClient, requestId: string, employeeId: string) {
    const { data: leaveReq, error: fetchErr } = await client
      .from('leave_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchErr || !leaveReq) throw new Error('Leave request not found');
    if (leaveReq.employee_id !== employeeId) {
      throw new Error('Unauthorized to cancel this leave request');
    }
    if (['rejected', 'cancelled'].includes(leaveReq.status)) {
      throw new Error(`Leave request is already ${leaveReq.status}`);
    }

    const wasApproved = leaveReq.status === 'approved';

    const { data, error } = await client
      .from('leave_requests')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel leave request: ${error.message}`);

    // If was approved, restore balance
    if (wasApproved) {
      const year = new Date(leaveReq.start_date).getFullYear();
      const balance = await this.getLeaveBalance(
        client,
        leaveReq.employee_id,
        leaveReq.leave_type_id,
        year
      );

      if (balance) {
        const restoredUsed = Math.max(0, Number(balance.used_days || 0) - Number(leaveReq.total_days));
        const newClosing = (Number(balance.opening_balance) + Number(balance.accrued_days) + Number(balance.carryover_days)) - restoredUsed;
        await client
          .from('leave_balances')
          .update({
            used_days: restoredUsed,
            closing_balance: newClosing,
            updated_at: new Date().toISOString(),
          })
          .eq('id', balance.id);
      }
    }

    return data;
  }
}

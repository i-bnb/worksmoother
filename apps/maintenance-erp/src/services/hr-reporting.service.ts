import { SupabaseClient } from '@supabase/supabase-js';

export interface HeadcountSummary {
  totalEmployees: number;
  activeCount: number;
  onNoticeCount: number;
  onLeaveCount: number;
  terminatedCount: number;
  technicianCount: number;
  byDepartment: Record<string, number>;
  byDesignation: Record<string, number>;
  byEmploymentType: Record<string, number>;
}

export interface AttendanceSummaryReport {
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  halfDayCount: number;
  onLeaveCount: number;
  holidayCount: number;
  totalLateArrivalMinutes: number;
  totalEarlyDepartureMinutes: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
}

export interface PayrollYearlySummary {
  year: number;
  periodCount: number;
  totalGrossPay: number;
  totalDeductions: number;
  totalEmployerContributions: number;
  totalNetPay: number;
  periods: Array<{
    periodId: string;
    code: string;
    name: string;
    status: string;
    grossPay: number;
    deductions: number;
    employerContributions: number;
    netPay: number;
  }>;
}

export class HrReportingService {
  /**
   * Generates organization headcount summary.
   */
  static async getHeadcountSummary(
    client: SupabaseClient,
    companyId: string
  ): Promise<HeadcountSummary> {
    const { data: employees, error } = await client
      .from('employees')
      .select('id, employment_status, employment_type, is_technician, department:departments(name), designation:designations(title)')
      .eq('company_id', companyId);

    if (error) throw new Error(`Failed to fetch headcount: ${error.message}`);

    const summary: HeadcountSummary = {
      totalEmployees: employees?.length || 0,
      activeCount: 0,
      onNoticeCount: 0,
      onLeaveCount: 0,
      terminatedCount: 0,
      technicianCount: 0,
      byDepartment: {},
      byDesignation: {},
      byEmploymentType: {},
    };

    for (const emp of employees || []) {
      if (emp.employment_status === 'ACTIVE') summary.activeCount++;
      else if (emp.employment_status === 'ON_NOTICE') summary.onNoticeCount++;
      else if (emp.employment_status === 'ON_LEAVE') summary.onLeaveCount++;
      else if (['TERMINATED', 'RESIGNED'].includes(emp.employment_status)) summary.terminatedCount++;

      if (emp.is_technician) summary.technicianCount++;

      const deptName = (emp.department as any)?.name || 'Unassigned';
      summary.byDepartment[deptName] = (summary.byDepartment[deptName] || 0) + 1;

      const desigTitle = (emp.designation as any)?.title || 'Unassigned';
      summary.byDesignation[desigTitle] = (summary.byDesignation[desigTitle] || 0) + 1;

      const empType = emp.employment_type || 'FULL_TIME';
      summary.byEmploymentType[empType] = (summary.byEmploymentType[empType] || 0) + 1;
    }

    return summary;
  }

  /**
   * Generates organization attendance rollup summary for a date range.
   */
  static async getAttendanceSummary(
    client: SupabaseClient,
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<AttendanceSummaryReport> {
    const { data: records, error } = await client
      .from('attendance_days')
      .select('*')
      .eq('company_id', companyId)
      .gte('attendance_date', startDate)
      .lte('attendance_date', endDate);

    if (error) throw new Error(`Failed to fetch attendance summary: ${error.message}`);

    const report: AttendanceSummaryReport = {
      totalRecords: records?.length || 0,
      presentCount: 0,
      absentCount: 0,
      halfDayCount: 0,
      onLeaveCount: 0,
      holidayCount: 0,
      totalLateArrivalMinutes: 0,
      totalEarlyDepartureMinutes: 0,
      totalRegularHours: 0,
      totalOvertimeHours: 0,
    };

    for (const r of records || []) {
      if (r.status === 'present') report.presentCount++;
      else if (r.status === 'absent') report.absentCount++;
      else if (r.status === 'half_day') report.halfDayCount++;
      else if (r.status === 'on_leave') report.onLeaveCount++;
      else if (r.status === 'holiday') report.holidayCount++;

      report.totalLateArrivalMinutes += Number(r.late_arrival_minutes || 0);
      report.totalEarlyDepartureMinutes += Number(r.early_departure_minutes || 0);
      report.totalRegularHours += Number(r.regular_hours || 0);
      report.totalOvertimeHours += Number(r.overtime_hours || 0);
    }

    return report;
  }

  /**
   * Generates annual payroll expenses and disbursement report.
   */
  static async getPayrollSummary(
    client: SupabaseClient,
    companyId: string,
    year: number
  ): Promise<PayrollYearlySummary> {
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const { data: periods, error } = await client
      .from('payroll_periods')
      .select('*')
      .eq('company_id', companyId)
      .gte('period_start_date', startStr)
      .lte('period_end_date', endStr)
      .order('period_start_date', { ascending: true });

    if (error) throw new Error(`Failed to fetch payroll summary: ${error.message}`);

    const summary: PayrollYearlySummary = {
      year,
      periodCount: periods?.length || 0,
      totalGrossPay: 0,
      totalDeductions: 0,
      totalEmployerContributions: 0,
      totalNetPay: 0,
      periods: [],
    };

    for (const p of periods || []) {
      const gross = Number(p.total_gross_pay || 0);
      const ded = Number(p.total_deductions || 0);
      const emp = Number(p.total_employer_contributions || 0);
      const net = Number(p.total_net_pay || 0);

      summary.totalGrossPay += gross;
      summary.totalDeductions += ded;
      summary.totalEmployerContributions += emp;
      summary.totalNetPay += net;

      summary.periods.push({
        periodId: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        grossPay: gross,
        deductions: ded,
        employerContributions: emp,
        netPay: net,
      });
    }

    return summary;
  }
}

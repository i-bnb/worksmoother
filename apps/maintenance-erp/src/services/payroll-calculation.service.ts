import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal, DecimalLike } from '../lib/decimal.js';
import {
  PayrollPeriodCreateDto,
  SalaryComponentType,
  ComponentCalculationType,
} from '../schemas/payroll.schema.js';

export interface EmployeePayslipParams {
  employeeId: string;
  baseSalary: DecimalLike;
  overtimeRate?: DecimalLike;
  totalWorkingDays: number;
  presentDays: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  overtimeHours?: number;
  components?: Array<{
    componentId: string;
    code: string;
    name: string;
    type: SalaryComponentType;
    calculationType: ComponentCalculationType;
    amount?: number;
    percentage?: number;
    isTaxable?: boolean;
    isStatutory?: boolean;
  }>;
}

export interface CalculatedPayslip {
  employeeId: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
  baseSalary: number;
  proratedBaseSalary: number;
  overtimePay: number;
  grossPay: number;
  totalDeductions: number;
  employerContributions: number;
  netPay: number;
  earningsBreakdown: any[];
  deductionsBreakdown: any[];
  employerBreakdown: any[];
}

export class PayrollCalculationService {
  /**
   * Pure calculation engine: Computes payslip with exact Decimal proration and overtime.
   */
  static calculateEmployeePayslip(params: EmployeePayslipParams): CalculatedPayslip {
    const totalWorkingDays = Math.max(1, params.totalWorkingDays);
    const presentDays = Math.max(0, params.presentDays);
    const paidLeaveDays = Math.max(0, params.paidLeaveDays || 0);
    const unpaidLeaveDays = Math.max(0, params.unpaidLeaveDays || 0);
    const overtimeHours = Math.max(0, params.overtimeHours || 0);

    const baseSalary = new Decimal(params.baseSalary).round(2);
    const overtimeRate = new Decimal(params.overtimeRate || 0).round(2);

    // Daily rate = Base Salary / Total Working Days
    const dailyRate = baseSalary.dividedBy(totalWorkingDays).round(4);

    // Payable days = present days + approved paid leaves
    const payableDays = Math.min(totalWorkingDays, presentDays + paidLeaveDays);
    const proratedBase = dailyRate.times(payableDays).round(2);

    // Overtime pay
    const overtimePay = overtimeRate.times(overtimeHours).round(2);

    // Evaluate structure components
    const earningsBreakdown: any[] = [];
    const deductionsBreakdown: any[] = [];
    const employerBreakdown: any[] = [];

    let sumAllowances = Decimal.zero();
    let sumDeductions = Decimal.zero();
    let sumEmployer = Decimal.zero();

    const components = params.components || [];
    for (const c of components) {
      let amount = Decimal.zero();
      if (c.calculationType === 'percentage') {
        const pct = new Decimal(c.percentage || 0);
        amount = baseSalary.times(pct).dividedBy(100).round(2);
      } else {
        amount = new Decimal(c.amount || 0).round(2);
      }

      const item = {
        component_id: c.componentId,
        code: c.code,
        name: c.name,
        amount: amount.toNumber(),
        is_statutory: Boolean(c.isStatutory),
        is_taxable: Boolean(c.isTaxable),
      };

      if (c.type === 'earning') {
        earningsBreakdown.push(item);
        sumAllowances = sumAllowances.plus(amount);
      } else if (c.type === 'deduction') {
        deductionsBreakdown.push(item);
        sumDeductions = sumDeductions.plus(amount);
      } else if (c.type === 'employer_contribution') {
        employerBreakdown.push(item);
        sumEmployer = sumEmployer.plus(amount);
      }
    }

    // Unpaid leave deduction
    if (unpaidLeaveDays > 0) {
      const unpaidDeduction = dailyRate.times(unpaidLeaveDays).round(2);
      deductionsBreakdown.push({
        component_id: 'UNPAID_LEAVE',
        code: 'LOP',
        name: 'Loss of Pay',
        amount: unpaidDeduction.toNumber(),
        is_statutory: false,
        is_taxable: false,
      });
      sumDeductions = sumDeductions.plus(unpaidDeduction);
    }

    // Gross Pay = Prorated Base + Overtime Pay + Allowances
    const grossPay = proratedBase.plus(overtimePay).plus(sumAllowances).round(2);
    // Net Pay = Gross Pay - Total Deductions
    const netPay = grossPay.minus(sumDeductions).round(2);

    return {
      employeeId: params.employeeId,
      workingDays: totalWorkingDays,
      presentDays,
      leaveDays: paidLeaveDays,
      unpaidLeaveDays,
      overtimeHours,
      baseSalary: baseSalary.toNumber(),
      proratedBaseSalary: proratedBase.toNumber(),
      overtimePay: overtimePay.toNumber(),
      grossPay: grossPay.toNumber(),
      totalDeductions: sumDeductions.toNumber(),
      employerContributions: sumEmployer.toNumber(),
      netPay: netPay.toNumber(),
      earningsBreakdown,
      deductionsBreakdown,
      employerBreakdown,
    };
  }

  /**
   * Creates a payroll period.
   */
  static async createPayrollPeriod(client: SupabaseClient, dto: PayrollPeriodCreateDto) {
    const startDate = new Date(dto.periodStartDate);
    const endDate = new Date(dto.periodEndDate);
    const totalDays = Math.ceil(Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const workingDays = dto.totalWorkingDays || Math.min(totalDays, 26);

    const { data, error } = await client
      .from('payroll_periods')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        period_start_date: dto.periodStartDate,
        period_end_date: dto.periodEndDate,
        payment_date: dto.paymentDate || null,
        total_working_days: workingDays,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create payroll period: ${error.message}`);
    return data;
  }

  /**
   * Retrieves payroll period by ID.
   */
  static async getPayrollPeriod(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('payroll_periods')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Payroll period not found: ${error.message}`);
    return data;
  }

  /**
   * Locks a payroll period, preventing further mutations or recalculations.
   */
  static async lockPayrollPeriod(
    client: SupabaseClient,
    companyId: string,
    periodId: string,
    userId: string
  ) {
    const period = await this.getPayrollPeriod(client, periodId);
    if (period.status === 'locked') {
      return period;
    }

    const { data, error } = await client
      .from('payroll_periods')
      .update({
        status: 'locked',
        locked_at: new Date().toISOString(),
        locked_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to lock payroll period: ${error.message}`);

    // Mark payslips immutable
    await client
      .from('payslips')
      .update({ is_immutable: true, updated_at: new Date().toISOString() })
      .eq('payroll_period_id', periodId);

    return data;
  }

  /**
   * Processes batch payroll calculations for a period.
   */
  static async processPayrollPeriod(
    client: SupabaseClient,
    companyId: string,
    periodId: string,
    employeeIds?: string[]
  ) {
    const period = await this.getPayrollPeriod(client, periodId);
    if (period.status === 'locked') {
      throw new Error('Cannot recalculate payroll: Period is locked');
    }

    // 1. Fetch eligible employees
    let empQuery = client
      .from('employees')
      .select('id, labor_rate, overtime_rate, designation:designations(min_salary)')
      .eq('company_id', companyId)
      .eq('employment_status', 'ACTIVE');

    if (employeeIds && employeeIds.length > 0) {
      empQuery = empQuery.in('id', employeeIds);
    }

    const { data: employees, error: empErr } = await empQuery;
    if (empErr) throw new Error(`Failed to fetch employees: ${empErr.message}`);

    let totalGross = Decimal.zero();
    let totalDeductions = Decimal.zero();
    let totalEmployer = Decimal.zero();
    let totalNet = Decimal.zero();

    // 2. Iterate through each employee and calculate payslip
    for (const emp of employees || []) {
      // Get attendance count
      const { count: presentCount } = await client
        .from('attendance_days')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('employee_id', emp.id)
        .in('status', ['present', 'half_day'])
        .gte('attendance_date', period.period_start_date)
        .lte('attendance_date', period.period_end_date);

      // Get leave days
      const { data: leaves } = await client
        .from('leave_requests')
        .select('total_days, leave_type:leave_types(is_paid)')
        .eq('company_id', companyId)
        .eq('employee_id', emp.id)
        .eq('status', 'approved')
        .gte('start_date', period.period_start_date)
        .lte('end_date', period.period_end_date);

      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      for (const l of leaves || []) {
        const isPaid = (l.leave_type as any)?.is_paid !== false;
        if (isPaid) {
          paidLeaveDays += Number(l.total_days || 0);
        } else {
          unpaidLeaveDays += Number(l.total_days || 0);
        }
      }

      // Overtime
      const { data: otRecords } = await client
        .from('overtime_records')
        .select('overtime_hours')
        .eq('company_id', companyId)
        .eq('employee_id', emp.id)
        .eq('status', 'approved')
        .gte('overtime_date', period.period_start_date)
        .lte('overtime_date', period.period_end_date);

      const totalOt = (otRecords || []).reduce((acc, r) => acc + Number(r.overtime_hours || 0), 0);

      // Base salary resolution: labor_rate * 160 or designation min_salary or 50000 fallback
      const baseSalary =
        (emp.designation as any)?.min_salary ||
        (emp.labor_rate ? emp.labor_rate * 160 : 50000);

      const payslipResult = this.calculateEmployeePayslip({
        employeeId: emp.id,
        baseSalary,
        overtimeRate: emp.overtime_rate || 200,
        totalWorkingDays: period.total_working_days || 26,
        presentDays: presentCount || 22,
        paidLeaveDays,
        unpaidLeaveDays,
        overtimeHours: totalOt,
      });

      totalGross = totalGross.plus(new Decimal(payslipResult.grossPay));
      totalDeductions = totalDeductions.plus(new Decimal(payslipResult.totalDeductions));
      totalEmployer = totalEmployer.plus(new Decimal(payslipResult.employerContributions));
      totalNet = totalNet.plus(new Decimal(payslipResult.netPay));

      // Upsert payslip
      await client.from('payslips').upsert(
        {
          company_id: companyId,
          payroll_period_id: periodId,
          employee_id: emp.id,
          working_days: payslipResult.workingDays,
          present_days: payslipResult.presentDays,
          leave_days: payslipResult.leaveDays,
          unpaid_leave_days: payslipResult.unpaidLeaveDays,
          overtime_hours: payslipResult.overtimeHours,
          base_salary: payslipResult.baseSalary,
          gross_pay: payslipResult.grossPay,
          total_deductions: payslipResult.totalDeductions,
          employer_contributions: payslipResult.employerContributions,
          net_pay: payslipResult.netPay,
          earnings_breakdown: payslipResult.earningsBreakdown,
          deductions_breakdown: payslipResult.deductionsBreakdown,
          employer_breakdown: payslipResult.employerBreakdown,
          status: 'generated',
          is_immutable: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id, payroll_period_id, employee_id' }
      );
    }

    // 3. Update payroll period totals
    const { data: updatedPeriod, error: updateErr } = await client
      .from('payroll_periods')
      .update({
        total_gross_pay: totalGross.toNumber(),
        total_deductions: totalDeductions.toNumber(),
        total_employer_contributions: totalEmployer.toNumber(),
        total_net_pay: totalNet.toNumber(),
        status: 'processed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId)
      .select()
      .single();

    if (updateErr) throw new Error(`Failed to update period summary: ${updateErr.message}`);
    return updatedPeriod;
  }
}

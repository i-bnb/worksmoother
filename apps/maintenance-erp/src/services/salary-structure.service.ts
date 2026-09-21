import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal, DecimalLike } from '../lib/decimal.js';
import {
  SalaryComponentCreateDto,
  SalaryStructureCreateDto,
  SalaryStructureComponentDto,
  SalaryComponentType,
  ComponentCalculationType,
} from '../schemas/payroll.schema.js';

export interface ComponentBreakdownItem {
  componentId: string;
  code: string;
  name: string;
  type: SalaryComponentType;
  calculationType: ComponentCalculationType;
  rateOrAmount: number;
  calculatedAmount: number;
  isTaxable: boolean;
  isStatutory: boolean;
}

export interface SalaryBreakdownResult {
  baseSalary: number;
  earnings: ComponentBreakdownItem[];
  deductions: ComponentBreakdownItem[];
  employerContributions: ComponentBreakdownItem[];
  totalEarnings: number;
  grossPay: number;
  totalDeductions: number;
  totalEmployerContributions: number;
  netPay: number;
}

export class SalaryStructureService {
  /**
   * Pure calculation engine: Computes salary components, gross pay, deductions, and net pay.
   */
  static computeStructureBreakdown(
    baseSalaryInput: DecimalLike,
    components: Array<{
      componentId: string;
      code: string;
      name: string;
      type: SalaryComponentType;
      calculationType: ComponentCalculationType;
      amount?: number;
      percentage?: number;
      isTaxable?: boolean;
      isStatutory?: boolean;
    }>
  ): SalaryBreakdownResult {
    const baseSalary = new Decimal(baseSalaryInput).round(2);

    const earnings: ComponentBreakdownItem[] = [];
    const deductions: ComponentBreakdownItem[] = [];
    const employerContributions: ComponentBreakdownItem[] = [];

    let sumEarnings = Decimal.zero();
    let sumDeductions = Decimal.zero();
    let sumEmployer = Decimal.zero();

    for (const c of components) {
      let calcAmount = Decimal.zero();

      if (c.calculationType === 'percentage') {
        const pct = new Decimal(c.percentage || 0);
        calcAmount = baseSalary.times(pct).dividedBy(100).round(2);
      } else {
        calcAmount = new Decimal(c.amount || 0).round(2);
      }

      const item: ComponentBreakdownItem = {
        componentId: c.componentId,
        code: c.code,
        name: c.name,
        type: c.type,
        calculationType: c.calculationType,
        rateOrAmount: c.calculationType === 'percentage' ? (c.percentage || 0) : (c.amount || 0),
        calculatedAmount: calcAmount.toNumber(),
        isTaxable: Boolean(c.isTaxable),
        isStatutory: Boolean(c.isStatutory),
      };

      if (c.type === 'earning') {
        earnings.push(item);
        sumEarnings = sumEarnings.plus(calcAmount);
      } else if (c.type === 'deduction') {
        deductions.push(item);
        sumDeductions = sumDeductions.plus(calcAmount);
      } else if (c.type === 'employer_contribution') {
        employerContributions.push(item);
        sumEmployer = sumEmployer.plus(calcAmount);
      }
    }

    const grossPay = baseSalary.plus(sumEarnings).round(2);
    const netPay = grossPay.minus(sumDeductions).round(2);

    return {
      baseSalary: baseSalary.toNumber(),
      earnings,
      deductions,
      employerContributions,
      totalEarnings: sumEarnings.toNumber(),
      grossPay: grossPay.toNumber(),
      totalDeductions: sumDeductions.toNumber(),
      totalEmployerContributions: sumEmployer.toNumber(),
      netPay: netPay.toNumber(),
    };
  }

  /**
   * Creates a salary component.
   */
  static async createSalaryComponent(client: SupabaseClient, dto: SalaryComponentCreateDto) {
    const { data, error } = await client
      .from('salary_components')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        component_type: dto.componentType,
        calculation_type: dto.calculationType || 'flat',
        default_amount: dto.defaultAmount || 0,
        default_percentage: dto.defaultPercentage || 0,
        is_taxable: dto.isTaxable !== undefined ? dto.isTaxable : true,
        is_statutory: Boolean(dto.isStatutory),
        gl_account_id: dto.glAccountId || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create salary component: ${error.message}`);
    return data;
  }

  /**
   * Lists salary components for a company.
   */
  static async listSalaryComponents(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('salary_components')
      .select('*')
      .eq('company_id', companyId)
      .order('code', { ascending: true });

    if (error) throw new Error(`Failed to list salary components: ${error.message}`);
    return data;
  }

  /**
   * Creates a salary structure with constituent components.
   */
  static async createSalaryStructure(client: SupabaseClient, dto: SalaryStructureCreateDto) {
    const { data: structure, error: structErr } = await client
      .from('salary_structures')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (structErr || !structure) {
      throw new Error(`Failed to create salary structure: ${structErr?.message}`);
    }

    if (dto.components && dto.components.length > 0) {
      const componentRows = dto.components.map((c, idx) => ({
        company_id: dto.companyId,
        structure_id: structure.id,
        component_id: c.componentId,
        calculation_type: c.calculationType,
        amount: c.amount || 0,
        percentage: c.percentage || 0,
        base_component_id: c.baseComponentId || null,
        sort_order: c.sortOrder !== undefined ? c.sortOrder : idx,
      }));

      const { error: compErr } = await client
        .from('salary_structure_components')
        .insert(componentRows);

      if (compErr) {
        throw new Error(`Failed to attach structure components: ${compErr.message}`);
      }
    }

    return this.getSalaryStructure(client, structure.id);
  }

  /**
   * Retrieves salary structure with components.
   */
  static async getSalaryStructure(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('salary_structures')
      .select('*, components:salary_structure_components(*, component:salary_components(*))')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Salary structure not found: ${error.message}`);
    return data;
  }

  /**
   * Lists salary structures for a company.
   */
  static async listSalaryStructures(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('salary_structures')
      .select('*, components:salary_structure_components(count)')
      .eq('company_id', companyId)
      .order('code', { ascending: true });

    if (error) throw new Error(`Failed to list salary structures: ${error.message}`);
    return data;
  }
}

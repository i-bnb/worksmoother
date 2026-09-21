export type SalaryComponentType = 'earning' | 'deduction' | 'employer_contribution';
export type ComponentCalculationType = 'flat' | 'percentage';
export type PayrollPeriodStatus =
  | 'draft'
  | 'processing'
  | 'processed'
  | 'approved'
  | 'paid'
  | 'locked'
  | 'cancelled';

export interface SalaryComponentCreateDto {
  companyId: string;
  code: string;
  name: string;
  componentType: SalaryComponentType;
  calculationType?: ComponentCalculationType;
  defaultAmount?: number;
  defaultPercentage?: number;
  isTaxable?: boolean;
  isStatutory?: boolean;
  glAccountId?: string | null;
  isActive?: boolean;
}

export interface SalaryStructureComponentDto {
  componentId: string;
  calculationType: ComponentCalculationType;
  amount?: number;
  percentage?: number;
  baseComponentId?: string | null;
  sortOrder?: number;
}

export interface SalaryStructureCreateDto {
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  components?: SalaryStructureComponentDto[];
}

export interface PayrollPeriodCreateDto {
  companyId: string;
  code: string;
  name: string;
  periodStartDate: string; // YYYY-MM-DD
  periodEndDate: string;   // YYYY-MM-DD
  paymentDate?: string | null;
  totalWorkingDays?: number;
}

export interface PayrollCalculateDto {
  companyId: string;
  periodId: string;
  employeeIds?: string[];
}

export interface PostPayrollGlDto {
  companyId: string;
  periodId: string;
  userId: string;
  disbursementBankAccountId?: string | null;
}

export function validateSalaryComponentCreate(body: any): SalaryComponentCreateDto {
  if (!body) throw new Error('Salary component body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');

  const validTypes: SalaryComponentType[] = ['earning', 'deduction', 'employer_contribution'];
  if (!body.componentType || !validTypes.includes(body.componentType)) {
    throw new Error(`componentType must be one of: ${validTypes.join(', ')}`);
  }

  const validCalcTypes: ComponentCalculationType[] = ['flat', 'percentage'];
  if (body.calculationType && !validCalcTypes.includes(body.calculationType)) {
    throw new Error(`calculationType must be one of: ${validCalcTypes.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    componentType: body.componentType,
    calculationType: body.calculationType || 'flat',
    defaultAmount: body.defaultAmount !== undefined ? Number(body.defaultAmount) : 0,
    defaultPercentage: body.defaultPercentage !== undefined ? Number(body.defaultPercentage) : 0,
    isTaxable: body.isTaxable !== undefined ? Boolean(body.isTaxable) : true,
    isStatutory: Boolean(body.isStatutory),
    glAccountId: body.glAccountId || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateSalaryStructureCreate(body: any): SalaryStructureCreateDto {
  if (!body) throw new Error('Salary structure body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');

  const components: SalaryStructureComponentDto[] = [];
  if (Array.isArray(body.components)) {
    for (const c of body.components) {
      if (!c.componentId) throw new Error('Component componentId is required');
      components.push({
        componentId: c.componentId,
        calculationType: c.calculationType === 'percentage' ? 'percentage' : 'flat',
        amount: c.amount !== undefined ? Number(c.amount) : 0,
        percentage: c.percentage !== undefined ? Number(c.percentage) : 0,
        baseComponentId: c.baseComponentId || null,
        sortOrder: c.sortOrder !== undefined ? Number(c.sortOrder) : 0,
      });
    }
  }

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    description: body.description || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    components,
  };
}

export function validatePayrollPeriodCreate(body: any): PayrollPeriodCreateDto {
  if (!body) throw new Error('Payroll period body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code) throw new Error('code is required');
  if (!body.name) throw new Error('name is required');
  if (!body.periodStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.periodStartDate)) {
    throw new Error('periodStartDate is required and must be in YYYY-MM-DD format');
  }
  if (!body.periodEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.periodEndDate)) {
    throw new Error('periodEndDate is required and must be in YYYY-MM-DD format');
  }
  if (new Date(body.periodStartDate) > new Date(body.periodEndDate)) {
    throw new Error('periodStartDate must be on or before periodEndDate');
  }

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    periodStartDate: body.periodStartDate,
    periodEndDate: body.periodEndDate,
    paymentDate: body.paymentDate || null,
    totalWorkingDays: body.totalWorkingDays !== undefined ? Number(body.totalWorkingDays) : undefined,
  };
}

export function validatePayrollCalculate(body: any): PayrollCalculateDto {
  if (!body) throw new Error('Calculate request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.periodId) throw new Error('periodId is required');

  return {
    companyId: body.companyId,
    periodId: body.periodId,
    employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds : undefined,
  };
}

export function validatePostPayrollGl(body: any): PostPayrollGlDto {
  if (!body) throw new Error('Post GL request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.periodId) throw new Error('periodId is required');
  if (!body.userId) throw new Error('userId is required');

  return {
    companyId: body.companyId,
    periodId: body.periodId,
    userId: body.userId,
    disbursementBankAccountId: body.disbursementBankAccountId || null,
  };
}

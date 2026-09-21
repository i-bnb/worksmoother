export type EmploymentStatus =
  | 'ACTIVE'
  | 'ON_NOTICE'
  | 'ON_LEAVE'
  | 'SUSPENDED'
  | 'RESIGNED'
  | 'TERMINATED'
  | 'INACTIVE';

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'INTERN'
  | 'TEMPORARY'
  | 'CONSULTANT';

export interface EmployeeCreateDto {
  companyId: string;
  branchId?: string | null;
  userId?: string | null;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  workEmail: string;
  personalEmail?: string | null;
  phone?: string | null;
  emergencyContact?: {
    name?: string;
    relationship?: string;
    phone?: string;
  } | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  nationalId?: string | null;
  taxId?: string | null;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  employmentStatus?: EmploymentStatus;
  employmentType?: EmploymentType;
  joiningDate: string;
  confirmationDate?: string | null;
  probationEndDate?: string | null;
  noticePeriodDays?: number;
  departmentId?: string | null;
  designationId?: string | null;
  reportsToId?: string | null;
  location?: string | null;
  isTechnician?: boolean;
  laborRate?: number;
  overtimeRate?: number;
  serviceCapacity?: number;
  serviceRegions?: string[];
  bankDetails?: {
    bank_name?: string;
    account_number?: string;
    ifsc_or_routing?: string;
    account_type?: string;
  } | null;
  metadata?: Record<string, any> | null;
}

export interface EmployeeUpdateDto {
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
  workEmail?: string;
  personalEmail?: string | null;
  phone?: string | null;
  emergencyContact?: Record<string, any> | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  address?: Record<string, any> | null;
  employmentStatus?: EmploymentStatus;
  employmentType?: EmploymentType;
  joiningDate?: string;
  confirmationDate?: string | null;
  probationEndDate?: string | null;
  noticePeriodDays?: number;
  terminationDate?: string | null;
  terminationReason?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  reportsToId?: string | null;
  location?: string | null;
  isTechnician?: boolean;
  laborRate?: number;
  overtimeRate?: number;
  serviceCapacity?: number;
  serviceRegions?: string[];
  bankDetails?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
}

export interface TechnicianProfileUpdateDto {
  isTechnician: boolean;
  laborRate?: number;
  overtimeRate?: number;
  serviceCapacity?: number;
  serviceRegions?: string[];
}

export interface DepartmentCreateDto {
  companyId: string;
  code: string;
  name: string;
  parentDepartmentId?: string | null;
  managerId?: string | null;
  costCenterCode?: string | null;
  isActive?: boolean;
}

export interface DesignationCreateDto {
  companyId: string;
  code: string;
  title: string;
  grade?: string | null;
  level?: number | null;
  minSalary?: number;
  maxSalary?: number;
  isActive?: boolean;
}

export interface JobHistoryCreateDto {
  companyId: string;
  employeeId: string;
  effectiveDate: string;
  changeType: 'hire' | 'promotion' | 'transfer' | 'designation_change' | 'salary_revision' | 'status_change';
  fromDepartmentId?: string | null;
  toDepartmentId?: string | null;
  fromDesignationId?: string | null;
  toDesignationId?: string | null;
  fromReportsToId?: string | null;
  toReportsToId?: string | null;
  fromSalary?: number | null;
  toSalary?: number | null;
  reason?: string | null;
  approvedBy?: string | null;
}

export interface SkillCreateDto {
  companyId: string;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface EmployeeSkillAssignDto {
  companyId: string;
  employeeId: string;
  skillId: string;
  proficiencyLevel: number; // 1 to 5
  certified?: boolean;
  certificateNumber?: string | null;
  validUntil?: string | null;
  verifiedBy?: string | null;
}

export interface EmployeeDocumentCreateDto {
  companyId: string;
  employeeId: string;
  documentType: string;
  title: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  accessLevel?: 'public' | 'internal' | 'confidential' | 'restricted';
  metadata?: Record<string, any> | null;
}

export function validateEmployeeCreate(body: any): EmployeeCreateDto {
  if (!body) throw new Error('Employee request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.firstName || typeof body.firstName !== 'string') throw new Error('firstName is required');
  if (!body.lastName || typeof body.lastName !== 'string') throw new Error('lastName is required');
  if (!body.workEmail || !body.workEmail.includes('@')) throw new Error('Valid workEmail is required');
  if (!body.joiningDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.joiningDate)) {
    throw new Error('joiningDate is required and must be in YYYY-MM-DD format');
  }

  const validStatuses: EmploymentStatus[] = [
    'ACTIVE', 'ON_NOTICE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED', 'INACTIVE'
  ];
  if (body.employmentStatus && !validStatuses.includes(body.employmentStatus)) {
    throw new Error(`Invalid employmentStatus: ${body.employmentStatus}`);
  }

  const validTypes: EmploymentType[] = [
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY', 'CONSULTANT'
  ];
  if (body.employmentType && !validTypes.includes(body.employmentType)) {
    throw new Error(`Invalid employmentType: ${body.employmentType}`);
  }

  if (body.laborRate !== undefined && (typeof body.laborRate !== 'number' || body.laborRate < 0)) {
    throw new Error('laborRate must be a non-negative number');
  }
  if (body.overtimeRate !== undefined && (typeof body.overtimeRate !== 'number' || body.overtimeRate < 0)) {
    throw new Error('overtimeRate must be a non-negative number');
  }

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    userId: body.userId || null,
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    displayName: body.displayName || `${body.firstName.trim()} ${body.lastName.trim()}`,
    workEmail: body.workEmail.trim().toLowerCase(),
    personalEmail: body.personalEmail ? body.personalEmail.trim().toLowerCase() : null,
    phone: body.phone || null,
    emergencyContact: body.emergencyContact || null,
    dateOfBirth: body.dateOfBirth || null,
    gender: body.gender || null,
    maritalStatus: body.maritalStatus || null,
    nationality: body.nationality || null,
    nationalId: body.nationalId || null,
    taxId: body.taxId || null,
    address: body.address || null,
    employmentStatus: body.employmentStatus || 'ACTIVE',
    employmentType: body.employmentType || 'FULL_TIME',
    joiningDate: body.joiningDate,
    confirmationDate: body.confirmationDate || null,
    probationEndDate: body.probationEndDate || null,
    noticePeriodDays: body.noticePeriodDays !== undefined ? Number(body.noticePeriodDays) : 30,
    departmentId: body.departmentId || null,
    designationId: body.designationId || null,
    reportsToId: body.reportsToId || null,
    location: body.location || null,
    isTechnician: Boolean(body.isTechnician),
    laborRate: body.laborRate !== undefined ? Number(body.laborRate) : 0,
    overtimeRate: body.overtimeRate !== undefined ? Number(body.overtimeRate) : 0,
    serviceCapacity: body.serviceCapacity !== undefined ? Number(body.serviceCapacity) : 100,
    serviceRegions: Array.isArray(body.serviceRegions) ? body.serviceRegions : [],
    bankDetails: body.bankDetails || null,
    metadata: body.metadata || null,
  };
}

export function validateEmployeeUpdate(body: any): EmployeeUpdateDto {
  if (!body) throw new Error('Update body is required');
  if (body.workEmail && !body.workEmail.includes('@')) {
    throw new Error('Valid workEmail is required');
  }
  if (body.laborRate !== undefined && (typeof body.laborRate !== 'number' || body.laborRate < 0)) {
    throw new Error('laborRate must be a non-negative number');
  }
  if (body.overtimeRate !== undefined && (typeof body.overtimeRate !== 'number' || body.overtimeRate < 0)) {
    throw new Error('overtimeRate must be a non-negative number');
  }
  return body;
}

export function validateTechnicianProfileUpdate(body: any): TechnicianProfileUpdateDto {
  if (!body) throw new Error('Technician update body is required');
  if (body.laborRate !== undefined && (typeof body.laborRate !== 'number' || body.laborRate < 0)) {
    throw new Error('laborRate must be a non-negative number');
  }
  if (body.overtimeRate !== undefined && (typeof body.overtimeRate !== 'number' || body.overtimeRate < 0)) {
    throw new Error('overtimeRate must be a non-negative number');
  }
  return {
    isTechnician: Boolean(body.isTechnician),
    laborRate: body.laborRate !== undefined ? Number(body.laborRate) : 0,
    overtimeRate: body.overtimeRate !== undefined ? Number(body.overtimeRate) : 0,
    serviceCapacity: body.serviceCapacity !== undefined ? Number(body.serviceCapacity) : 100,
    serviceRegions: Array.isArray(body.serviceRegions) ? body.serviceRegions : [],
  };
}

export function validateDepartmentCreate(body: any): DepartmentCreateDto {
  if (!body) throw new Error('Department body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code || typeof body.code !== 'string') throw new Error('code is required');
  if (!body.name || typeof body.name !== 'string') throw new Error('name is required');

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    parentDepartmentId: body.parentDepartmentId || null,
    managerId: body.managerId || null,
    costCenterCode: body.costCenterCode || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateDesignationCreate(body: any): DesignationCreateDto {
  if (!body) throw new Error('Designation body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code || typeof body.code !== 'string') throw new Error('code is required');
  if (!body.title || typeof body.title !== 'string') throw new Error('title is required');

  if (body.minSalary !== undefined && (typeof body.minSalary !== 'number' || body.minSalary < 0)) {
    throw new Error('minSalary must be a non-negative number');
  }
  if (body.maxSalary !== undefined && (typeof body.maxSalary !== 'number' || body.maxSalary < 0)) {
    throw new Error('maxSalary must be a non-negative number');
  }
  if (
    body.minSalary !== undefined &&
    body.maxSalary !== undefined &&
    body.minSalary > body.maxSalary
  ) {
    throw new Error('minSalary cannot be greater than maxSalary');
  }

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    title: body.title.trim(),
    grade: body.grade || null,
    level: body.level !== undefined ? Number(body.level) : null,
    minSalary: body.minSalary !== undefined ? Number(body.minSalary) : 0,
    maxSalary: body.maxSalary !== undefined ? Number(body.maxSalary) : 0,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateJobHistoryCreate(body: any): JobHistoryCreateDto {
  if (!body) throw new Error('Job history body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) {
    throw new Error('effectiveDate is required and must be in YYYY-MM-DD format');
  }
  const validChangeTypes = [
    'hire', 'promotion', 'transfer', 'designation_change', 'salary_revision', 'status_change'
  ];
  if (!body.changeType || !validChangeTypes.includes(body.changeType)) {
    throw new Error(`changeType must be one of: ${validChangeTypes.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    effectiveDate: body.effectiveDate,
    changeType: body.changeType,
    fromDepartmentId: body.fromDepartmentId || null,
    toDepartmentId: body.toDepartmentId || null,
    fromDesignationId: body.fromDesignationId || null,
    toDesignationId: body.toDesignationId || null,
    fromReportsToId: body.fromReportsToId || null,
    toReportsToId: body.toReportsToId || null,
    fromSalary: body.fromSalary !== undefined ? Number(body.fromSalary) : null,
    toSalary: body.toSalary !== undefined ? Number(body.toSalary) : null,
    reason: body.reason || null,
    approvedBy: body.approvedBy || null,
  };
}

export function validateSkillCreate(body: any): SkillCreateDto {
  if (!body) throw new Error('Skill body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code || typeof body.code !== 'string') throw new Error('code is required');
  if (!body.name || typeof body.name !== 'string') throw new Error('name is required');

  return {
    companyId: body.companyId,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    category: body.category || null,
    description: body.description || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateEmployeeSkillAssign(body: any): EmployeeSkillAssignDto {
  if (!body) throw new Error('Employee skill assignment body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.skillId) throw new Error('skillId is required');
  const level = Number(body.proficiencyLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw new Error('proficiencyLevel must be an integer between 1 and 5');
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    skillId: body.skillId,
    proficiencyLevel: level,
    certified: Boolean(body.certified),
    certificateNumber: body.certificateNumber || null,
    validUntil: body.validUntil || null,
    verifiedBy: body.verifiedBy || null,
  };
}

export function validateEmployeeDocumentCreate(body: any): EmployeeDocumentCreateDto {
  if (!body) throw new Error('Employee document body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.employeeId) throw new Error('employeeId is required');
  if (!body.documentType) throw new Error('documentType is required');
  if (!body.title) throw new Error('title is required');
  if (!body.fileUrl) throw new Error('fileUrl is required');

  const validAccessLevels = ['public', 'internal', 'confidential', 'restricted'];
  if (body.accessLevel && !validAccessLevels.includes(body.accessLevel)) {
    throw new Error(`accessLevel must be one of: ${validAccessLevels.join(', ')}`);
  }

  return {
    companyId: body.companyId,
    employeeId: body.employeeId,
    documentType: body.documentType,
    title: body.title.trim(),
    fileUrl: body.fileUrl.trim(),
    fileSize: body.fileSize !== undefined ? Number(body.fileSize) : null,
    mimeType: body.mimeType || null,
    issueDate: body.issueDate || null,
    expiryDate: body.expiryDate || null,
    accessLevel: body.accessLevel || 'internal',
    metadata: body.metadata || null,
  };
}

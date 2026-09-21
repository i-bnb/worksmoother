export interface TerritoryCreateDto {
  companyId: string;
  branchId?: string | null;
  code: string;
  name: string;
  description?: string | null;
  areaDescription?: string | null;
  workingHours?: {
    shift_start?: string;
    shift_end?: string;
    working_days?: number[];
  };
  priorityRules?: {
    default_priority?: string;
    emergency_buffer_minutes?: number;
  };
  isActive?: boolean;
}

export interface TerritoryUpdateDto {
  code?: string;
  name?: string;
  description?: string | null;
  areaDescription?: string | null;
  workingHours?: Record<string, any>;
  priorityRules?: Record<string, any>;
  isActive?: boolean;
}

export interface TerritoryMemberAssignDto {
  companyId: string;
  territoryId: string;
  employeeId: string;
  isPrimary?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface TeamCreateDto {
  companyId: string;
  branchId?: string | null;
  code: string;
  name: string;
  leaderId?: string | null;
  territoryId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface TeamMemberAssignDto {
  companyId: string;
  teamId: string;
  employeeId: string;
  roleInTeam?: string;
  isActive?: boolean;
}

export function validateTerritoryCreate(body: any): TerritoryCreateDto {
  if (!body) throw new Error('Territory request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code || typeof body.code !== 'string') throw new Error('code is required');
  if (!body.name || typeof body.name !== 'string') throw new Error('name is required');

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    description: body.description || null,
    areaDescription: body.areaDescription || null,
    workingHours: body.workingHours || {
      shift_start: '08:00',
      shift_end: '18:00',
      working_days: [1, 2, 3, 4, 5],
    },
    priorityRules: body.priorityRules || {
      default_priority: 'medium',
      emergency_buffer_minutes: 30,
    },
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateTerritoryUpdate(body: any): TerritoryUpdateDto {
  if (!body) throw new Error('Update body is required');
  return {
    code: body.code ? body.code.trim().toUpperCase() : undefined,
    name: body.name ? body.name.trim() : undefined,
    description: body.description !== undefined ? body.description : undefined,
    areaDescription: body.areaDescription !== undefined ? body.areaDescription : undefined,
    workingHours: body.workingHours,
    priorityRules: body.priorityRules,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
  };
}

export function validateTerritoryMemberAssign(body: any): TerritoryMemberAssignDto {
  if (!body) throw new Error('Territory member assignment body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.territoryId) throw new Error('territoryId is required');
  if (!body.employeeId) throw new Error('employeeId is required');

  return {
    companyId: body.companyId,
    territoryId: body.territoryId,
    employeeId: body.employeeId,
    isPrimary: body.isPrimary !== undefined ? Boolean(body.isPrimary) : true,
    effectiveFrom: body.effectiveFrom || new Date().toISOString().split('T')[0],
    effectiveTo: body.effectiveTo || null,
  };
}

export function validateTeamCreate(body: any): TeamCreateDto {
  if (!body) throw new Error('Team request body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.code || typeof body.code !== 'string') throw new Error('code is required');
  if (!body.name || typeof body.name !== 'string') throw new Error('name is required');

  return {
    companyId: body.companyId,
    branchId: body.branchId || null,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    leaderId: body.leaderId || null,
    territoryId: body.territoryId || null,
    description: body.description || null,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

export function validateTeamMemberAssign(body: any): TeamMemberAssignDto {
  if (!body) throw new Error('Team member assignment body is required');
  if (!body.companyId) throw new Error('companyId is required');
  if (!body.teamId) throw new Error('teamId is required');
  if (!body.employeeId) throw new Error('employeeId is required');

  return {
    companyId: body.companyId,
    teamId: body.teamId,
    employeeId: body.employeeId,
    roleInTeam: body.roleInTeam || 'member',
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
}

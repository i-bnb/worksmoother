import { SupabaseClient } from '@supabase/supabase-js';
import {
  DepartmentCreateDto,
  DesignationCreateDto,
  JobHistoryCreateDto,
  SkillCreateDto,
  EmployeeSkillAssignDto,
} from '../schemas/employee.schema.js';

export interface DepartmentNode {
  id: string;
  code: string;
  name: string;
  parentDepartmentId: string | null;
  children: DepartmentNode[];
  [key: string]: any;
}

export class DepartmentService {
  /**
   * Pure algorithm to detect whether setting parent of deptId to newParentId introduces a cycle.
   */
  static detectCycle(
    departments: { id: string; parent_department_id?: string | null }[],
    deptId: string,
    newParentId: string | null | undefined
  ): boolean {
    if (!newParentId) return false;
    if (deptId === newParentId) return true;

    // Build parent map
    const parentMap = new Map<string, string | null>();
    for (const d of departments) {
      parentMap.set(d.id, d.parent_department_id || null);
    }
    parentMap.set(deptId, newParentId);

    // Follow parent pointers from newParentId
    let curr: string | null | undefined = newParentId;
    const visited = new Set<string>();

    while (curr) {
      if (curr === deptId) return true;
      if (visited.has(curr)) return true;
      visited.add(curr);
      curr = parentMap.get(curr);
    }

    return false;
  }

  /**
   * Pure algorithm to build a hierarchical tree from flat department list.
   */
  static buildDepartmentTree(
    departments: Array<{ id: string; code: string; name: string; parent_department_id?: string | null; [key: string]: any }>
  ): DepartmentNode[] {
    const nodeMap = new Map<string, DepartmentNode>();
    const roots: DepartmentNode[] = [];

    for (const d of departments) {
      nodeMap.set(d.id, {
        ...d,
        id: d.id,
        code: d.code,
        name: d.name,
        parentDepartmentId: d.parent_department_id || null,
        children: [],
      });
    }

    for (const d of departments) {
      const node = nodeMap.get(d.id)!;
      if (d.parent_department_id && nodeMap.has(d.parent_department_id)) {
        nodeMap.get(d.parent_department_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Creates a department after validating no cycle.
   */
  static async createDepartment(client: SupabaseClient, dto: DepartmentCreateDto) {
    if (dto.parentDepartmentId) {
      const { data: existing } = await client
        .from('departments')
        .select('id, parent_department_id')
        .eq('company_id', dto.companyId);

      if (existing && this.detectCycle(existing, 'new-id', dto.parentDepartmentId)) {
        throw new Error('Cyclic department hierarchy detected');
      }
    }

    const { data, error } = await client
      .from('departments')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        parent_department_id: dto.parentDepartmentId || null,
        manager_id: dto.managerId || null,
        cost_center_code: dto.costCenterCode || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select('*, manager:employees(id, display_name, work_email)')
      .single();

    if (error) throw new Error(`Failed to create department: ${error.message}`);
    return data;
  }

  /**
   * Updates department details with cyclic check.
   */
  static async updateDepartment(
    client: SupabaseClient,
    id: string,
    dto: Partial<DepartmentCreateDto>
  ) {
    if (dto.parentDepartmentId) {
      const { data: existing } = await client
        .from('departments')
        .select('id, parent_department_id')
        .eq('company_id', dto.companyId || (await this.getDepartment(client, id)).company_id);

      if (existing && this.detectCycle(existing, id, dto.parentDepartmentId)) {
        throw new Error('Cannot set parent department: introduces a cycle');
      }
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.code) updatePayload.code = dto.code;
    if (dto.name) updatePayload.name = dto.name;
    if (dto.parentDepartmentId !== undefined) updatePayload.parent_department_id = dto.parentDepartmentId;
    if (dto.managerId !== undefined) updatePayload.manager_id = dto.managerId;
    if (dto.costCenterCode !== undefined) updatePayload.cost_center_code = dto.costCenterCode;
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;

    const { data, error } = await client
      .from('departments')
      .update(updatePayload)
      .eq('id', id)
      .select('*, manager:employees(id, display_name, work_email)')
      .single();

    if (error) throw new Error(`Failed to update department: ${error.message}`);
    return data;
  }

  /**
   * Retrieves department by ID.
   */
  static async getDepartment(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('departments')
      .select('*, manager:employees(id, display_name, work_email), parent:departments!parent_department_id(id, name, code)')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Department not found: ${error.message}`);
    return data;
  }

  /**
   * Lists all departments for a company.
   */
  static async listDepartments(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('departments')
      .select('*, manager:employees(id, display_name, work_email)')
      .eq('company_id', companyId)
      .order('code', { ascending: true });

    if (error) throw new Error(`Failed to list departments: ${error.message}`);
    return data;
  }

  /**
   * Creates a designation.
   */
  static async createDesignation(client: SupabaseClient, dto: DesignationCreateDto) {
    const { data, error } = await client
      .from('designations')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        title: dto.title,
        grade: dto.grade || null,
        level: dto.level || null,
        min_salary: dto.minSalary || 0,
        max_salary: dto.maxSalary || 0,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create designation: ${error.message}`);
    return data;
  }

  /**
   * Lists designations for a company.
   */
  static async listDesignations(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('designations')
      .select('*')
      .eq('company_id', companyId)
      .order('level', { ascending: true, nullsFirst: false });

    if (error) throw new Error(`Failed to list designations: ${error.message}`);
    return data;
  }

  /**
   * Records an employee job history event (promotion, transfer, etc.).
   */
  static async recordJobHistory(client: SupabaseClient, dto: JobHistoryCreateDto) {
    const { data, error } = await client
      .from('employee_job_history')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        effective_date: dto.effectiveDate,
        change_type: dto.changeType,
        from_department_id: dto.fromDepartmentId || null,
        to_department_id: dto.toDepartmentId || null,
        from_designation_id: dto.fromDesignationId || null,
        to_designation_id: dto.toDesignationId || null,
        from_reports_to_id: dto.fromReportsToId || null,
        to_reports_to_id: dto.toReportsToId || null,
        from_salary: dto.fromSalary || null,
        to_salary: dto.toSalary || null,
        reason: dto.reason || null,
        approved_by: dto.approvedBy || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record job history: ${error.message}`);
    return data;
  }

  /**
   * Lists job history for an employee.
   */
  static async listJobHistory(client: SupabaseClient, employeeId: string) {
    const { data, error } = await client
      .from('employee_job_history')
      .select(`
        *,
        from_department:departments!from_department_id(id, name, code),
        to_department:departments!to_department_id(id, name, code),
        from_designation:designations!from_designation_id(id, title, code),
        to_designation:designations!to_designation_id(id, title, code)
      `)
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: false });

    if (error) throw new Error(`Failed to list job history: ${error.message}`);
    return data;
  }

  /**
   * Creates a skill.
   */
  static async createSkill(client: SupabaseClient, dto: SkillCreateDto) {
    const { data, error } = await client
      .from('skills')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        category: dto.category || null,
        description: dto.description || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create skill: ${error.message}`);
    return data;
  }

  /**
   * Lists skills for a company.
   */
  static async listSkills(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('skills')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (error) throw new Error(`Failed to list skills: ${error.message}`);
    return data;
  }

  /**
   * Assigns a skill to an employee with proficiency level.
   */
  static async assignSkill(client: SupabaseClient, dto: EmployeeSkillAssignDto) {
    const { data, error } = await client
      .from('employee_skills')
      .upsert(
        {
          company_id: dto.companyId,
          employee_id: dto.employeeId,
          skill_id: dto.skillId,
          proficiency_level: dto.proficiencyLevel,
          certified: Boolean(dto.certified),
          certificate_number: dto.certificateNumber || null,
          valid_until: dto.validUntil || null,
          verified_by: dto.verifiedBy || null,
          verified_at: dto.verifiedBy ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id, skill_id' }
      )
      .select('*, skill:skills(*)')
      .single();

    if (error) throw new Error(`Failed to assign skill: ${error.message}`);
    return data;
  }

  /**
   * Lists skills of an employee.
   */
  static async listEmployeeSkills(client: SupabaseClient, employeeId: string) {
    const { data, error } = await client
      .from('employee_skills')
      .select('*, skill:skills(*)')
      .eq('employee_id', employeeId)
      .order('proficiency_level', { ascending: false });

    if (error) throw new Error(`Failed to list employee skills: ${error.message}`);
    return data;
  }

  /**
   * Finds qualified technicians having a specific skill.
   */
  static async listTechniciansBySkill(
    client: SupabaseClient,
    companyId: string,
    skillId: string,
    minProficiency: number = 1
  ) {
    const { data, error } = await client
      .from('employee_skills')
      .select('*, employee:employees(*), skill:skills(*)')
      .eq('company_id', companyId)
      .eq('skill_id', skillId)
      .gte('proficiency_level', minProficiency);

    if (error) throw new Error(`Failed to find technicians by skill: ${error.message}`);
    return data;
  }
}

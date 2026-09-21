import { SupabaseClient } from '@supabase/supabase-js';
import { DepartmentService } from '../services/department.service.js';
import {
  validateDepartmentCreate,
  validateDesignationCreate,
  validateJobHistoryCreate,
  validateSkillCreate,
  validateEmployeeSkillAssign,
} from '../schemas/employee.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class DepartmentsApiController {
  static async createDepartment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateDepartmentCreate(req.body);
      const data = await DepartmentService.createDepartment(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async updateDepartment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Department ID is required' };
      const data = await DepartmentService.updateDepartment(client, id, req.body);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getDepartment(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Department ID is required' };
      const data = await DepartmentService.getDepartment(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async listDepartments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DepartmentService.listDepartments(client, companyId);
      if (req.query?.tree === 'true') {
        const tree = DepartmentService.buildDepartmentTree(data);
        return { status: 200, data: tree };
      }
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async createDesignation(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateDesignationCreate(req.body);
      const data = await DepartmentService.createDesignation(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listDesignations(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DepartmentService.listDesignations(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async recordJobHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateJobHistoryCreate(req.body);
      const data = await DepartmentService.recordJobHistory(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listJobHistory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const employeeId = req.params?.id;
      if (!employeeId) return { status: 400, error: 'Employee ID is required' };
      const data = await DepartmentService.listJobHistory(client, employeeId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async createSkill(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateSkillCreate(req.body);
      const data = await DepartmentService.createSkill(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listSkills(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await DepartmentService.listSkills(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async assignSkill(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateEmployeeSkillAssign(req.body);
      const data = await DepartmentService.assignSkill(client, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listEmployeeSkills(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const employeeId = req.params?.id;
      if (!employeeId) return { status: 400, error: 'Employee ID is required' };
      const data = await DepartmentService.listEmployeeSkills(client, employeeId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

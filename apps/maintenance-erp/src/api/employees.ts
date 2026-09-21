import { SupabaseClient } from '@supabase/supabase-js';
import { EmployeeService } from '../services/employee.service.js';
import {
  validateEmployeeCreate,
  validateEmployeeUpdate,
  validateTechnicianProfileUpdate,
  validateEmployeeDocumentCreate,
} from '../schemas/employee.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class EmployeesApiController {
  static async createEmployee(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateEmployeeCreate(req.body);
      const data = await EmployeeService.createEmployee(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getEmployee(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Employee ID is required' };
      const data = await EmployeeService.getEmployee(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async updateEmployee(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Employee ID is required' };
      const validated = validateEmployeeUpdate(req.body);
      const data = await EmployeeService.updateEmployee(client, id, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async updateStatus(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Employee ID is required' };
      const { status: nextStatus, reason, userId } = req.body || {};
      if (!nextStatus) return { status: 400, error: 'Status is required' };

      const data = await EmployeeService.updateStatus(client, id, nextStatus, reason, userId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async updateTechnicianProfile(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Employee ID is required' };
      const validated = validateTechnicianProfileUpdate(req.body);
      const data = await EmployeeService.updateTechnicianProfile(client, id, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listEmployees(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const data = await EmployeeService.listEmployees(client, companyId, {
        departmentId: req.query?.departmentId || req.query?.department_id,
        designationId: req.query?.designationId || req.query?.designation_id,
        status: req.query?.status as any,
        isTechnician: req.query?.isTechnician !== undefined ? req.query.isTechnician === 'true' : undefined,
        search: req.query?.search,
      });
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async addDocument(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateEmployeeDocumentCreate(req.body);
      const data = await EmployeeService.addDocument(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listDocuments(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const employeeId = req.params?.id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!employeeId || !companyId) {
        return { status: 400, error: 'employeeId and companyId are required' };
      }
      const data = await EmployeeService.listDocuments(client, employeeId, companyId, req.query?.accessLevel);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }
}

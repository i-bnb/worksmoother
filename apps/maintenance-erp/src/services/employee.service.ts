import { SupabaseClient } from '@supabase/supabase-js';
import {
  EmployeeCreateDto,
  EmployeeUpdateDto,
  TechnicianProfileUpdateDto,
  EmploymentStatus,
  EmployeeDocumentCreateDto,
} from '../schemas/employee.schema.js';

export class EmployeeService {
  /**
   * Permitted employment status state machine transitions.
   */
  static readonly VALID_STATUS_TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
    ACTIVE: ['ON_NOTICE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED', 'INACTIVE'],
    ON_NOTICE: ['RESIGNED', 'TERMINATED', 'ACTIVE'],
    ON_LEAVE: ['ACTIVE', 'ON_NOTICE', 'RESIGNED', 'TERMINATED'],
    SUSPENDED: ['ACTIVE', 'TERMINATED', 'INACTIVE'],
    RESIGNED: ['INACTIVE', 'ACTIVE'],
    TERMINATED: ['INACTIVE'],
    INACTIVE: ['ACTIVE'],
  };

  /**
   * Validates whether a status transition is permitted.
   */
  static isValidStatusTransition(current: EmploymentStatus, next: EmploymentStatus): boolean {
    if (current === next) return true;
    const allowed = this.VALID_STATUS_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  /**
   * Creates a new employee record.
   * If employee_code is not provided, RPC or default code generator is used.
   */
  static async createEmployee(client: SupabaseClient, dto: EmployeeCreateDto) {
    const payload = {
      company_id: dto.companyId,
      branch_id: dto.branchId || null,
      user_id: dto.userId || null,
      first_name: dto.firstName,
      last_name: dto.lastName,
      display_name: dto.displayName || `${dto.firstName} ${dto.lastName}`,
      work_email: dto.workEmail,
      personal_email: dto.personalEmail || null,
      phone: dto.phone || null,
      emergency_contact: dto.emergencyContact || {},
      date_of_birth: dto.dateOfBirth || null,
      gender: dto.gender || null,
      marital_status: dto.maritalStatus || null,
      nationality: dto.nationality || null,
      national_id: dto.nationalId || null,
      tax_id: dto.taxId || null,
      address: dto.address || {},
      employment_status: dto.employmentStatus || 'ACTIVE',
      employment_type: dto.employmentType || 'FULL_TIME',
      joining_date: dto.joiningDate,
      confirmation_date: dto.confirmationDate || null,
      probation_end_date: dto.probationEndDate || null,
      notice_period_days: dto.noticePeriodDays || 30,
      department_id: dto.departmentId || null,
      designation_id: dto.designationId || null,
      reports_to_id: dto.reportsToId || null,
      location: dto.location || null,
      is_technician: Boolean(dto.isTechnician),
      labor_rate: dto.laborRate || 0,
      overtime_rate: dto.overtimeRate || 0,
      service_capacity: dto.serviceCapacity || 100,
      service_regions: dto.serviceRegions || [],
      bank_details: dto.bankDetails || {},
      metadata: dto.metadata || {},
    };

    const { data, error } = await client
      .from('employees')
      .insert(payload)
      .select('*, department:departments(*), designation:designations(*)')
      .single();

    if (error) throw new Error(`Failed to create employee: ${error.message}`);
    return data;
  }

  /**
   * Fetches an employee by ID.
   */
  static async getEmployee(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('employees')
      .select('*, department:departments(*), designation:designations(*), manager:employees!reports_to_id(id, display_name, work_email)')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Employee not found: ${error.message}`);
    return data;
  }

  /**
   * Updates general employee information.
   */
  static async updateEmployee(client: SupabaseClient, id: string, dto: EmployeeUpdateDto) {
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.firstName !== undefined) updatePayload.first_name = dto.firstName;
    if (dto.lastName !== undefined) updatePayload.last_name = dto.lastName;
    if (dto.displayName !== undefined) updatePayload.display_name = dto.displayName;
    if (dto.workEmail !== undefined) updatePayload.work_email = dto.workEmail;
    if (dto.personalEmail !== undefined) updatePayload.personal_email = dto.personalEmail;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.emergencyContact !== undefined) updatePayload.emergency_contact = dto.emergencyContact;
    if (dto.dateOfBirth !== undefined) updatePayload.date_of_birth = dto.dateOfBirth;
    if (dto.gender !== undefined) updatePayload.gender = dto.gender;
    if (dto.maritalStatus !== undefined) updatePayload.marital_status = dto.maritalStatus;
    if (dto.address !== undefined) updatePayload.address = dto.address;
    if (dto.employmentType !== undefined) updatePayload.employment_type = dto.employmentType;
    if (dto.joiningDate !== undefined) updatePayload.joining_date = dto.joiningDate;
    if (dto.confirmationDate !== undefined) updatePayload.confirmation_date = dto.confirmationDate;
    if (dto.probationEndDate !== undefined) updatePayload.probation_end_date = dto.probationEndDate;
    if (dto.noticePeriodDays !== undefined) updatePayload.notice_period_days = dto.noticePeriodDays;
    if (dto.terminationDate !== undefined) updatePayload.termination_date = dto.terminationDate;
    if (dto.terminationReason !== undefined) updatePayload.termination_reason = dto.terminationReason;
    if (dto.departmentId !== undefined) updatePayload.department_id = dto.departmentId;
    if (dto.designationId !== undefined) updatePayload.designation_id = dto.designationId;
    if (dto.reportsToId !== undefined) updatePayload.reports_to_id = dto.reportsToId;
    if (dto.location !== undefined) updatePayload.location = dto.location;
    if (dto.isTechnician !== undefined) updatePayload.is_technician = dto.isTechnician;
    if (dto.laborRate !== undefined) updatePayload.labor_rate = dto.laborRate;
    if (dto.overtimeRate !== undefined) updatePayload.overtime_rate = dto.overtimeRate;
    if (dto.serviceCapacity !== undefined) updatePayload.service_capacity = dto.serviceCapacity;
    if (dto.serviceRegions !== undefined) updatePayload.service_regions = dto.serviceRegions;
    if (dto.bankDetails !== undefined) updatePayload.bank_details = dto.bankDetails;
    if (dto.metadata !== undefined) updatePayload.metadata = dto.metadata;

    const { data, error } = await client
      .from('employees')
      .update(updatePayload)
      .eq('id', id)
      .select('*, department:departments(*), designation:designations(*)')
      .single();

    if (error) throw new Error(`Failed to update employee: ${error.message}`);
    return data;
  }

  /**
   * Transitions an employee's employment status with state machine enforcement.
   */
  static async updateStatus(
    client: SupabaseClient,
    id: string,
    nextStatus: EmploymentStatus,
    reason?: string,
    userId?: string
  ) {
    const current = await this.getEmployee(client, id);
    if (!this.isValidStatusTransition(current.employment_status, nextStatus)) {
      throw new Error(
        `Invalid status transition from ${current.employment_status} to ${nextStatus}`
      );
    }

    const updates: Record<string, any> = {
      employment_status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'TERMINATED' || nextStatus === 'RESIGNED') {
      updates.termination_date = new Date().toISOString().split('T')[0];
      if (reason) updates.termination_reason = reason;
    }

    const { data, error } = await client
      .from('employees')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update employee status: ${error.message}`);

    // Create job history record
    await client.from('employee_job_history').insert({
      company_id: current.company_id,
      employee_id: id,
      effective_date: new Date().toISOString().split('T')[0],
      change_type: 'status_change',
      reason: reason || `Status changed to ${nextStatus}`,
      approved_by: userId || null,
    });

    return data;
  }

  /**
   * Updates technician-specific operational attributes.
   */
  static async updateTechnicianProfile(
    client: SupabaseClient,
    id: string,
    dto: TechnicianProfileUpdateDto
  ) {
    const { data, error } = await client
      .from('employees')
      .update({
        is_technician: dto.isTechnician,
        labor_rate: dto.laborRate !== undefined ? dto.laborRate : 0,
        overtime_rate: dto.overtimeRate !== undefined ? dto.overtimeRate : 0,
        service_capacity: dto.serviceCapacity !== undefined ? dto.serviceCapacity : 100,
        service_regions: dto.serviceRegions || [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update technician profile: ${error.message}`);
    return data;
  }

  /**
   * Lists employees with filtering and search.
   */
  static async listEmployees(
    client: SupabaseClient,
    companyId: string,
    filters?: {
      departmentId?: string;
      designationId?: string;
      status?: EmploymentStatus;
      isTechnician?: boolean;
      search?: string;
    }
  ) {
    let query = client
      .from('employees')
      .select('*, department:departments(id, name, code), designation:designations(id, title, code)')
      .eq('company_id', companyId);

    if (filters?.departmentId) query = query.eq('department_id', filters.departmentId);
    if (filters?.designationId) query = query.eq('designation_id', filters.designationId);
    if (filters?.status) query = query.eq('employment_status', filters.status);
    if (filters?.isTechnician !== undefined) query = query.eq('is_technician', filters.isTechnician);
    if (filters?.search) {
      query = query.or(
        `display_name.ilike.%${filters.search}%,work_email.ilike.%${filters.search}%,employee_code.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list employees: ${error.message}`);
    return data;
  }

  /**
   * Adds an HR document reference for an employee.
   */
  static async addDocument(client: SupabaseClient, dto: EmployeeDocumentCreateDto) {
    const { data, error } = await client
      .from('employee_documents')
      .insert({
        company_id: dto.companyId,
        employee_id: dto.employeeId,
        document_type: dto.documentType,
        title: dto.title,
        file_url: dto.fileUrl,
        file_size: dto.fileSize || null,
        mime_type: dto.mimeType || null,
        issue_date: dto.issueDate || null,
        expiry_date: dto.expiryDate || null,
        access_level: dto.accessLevel || 'internal',
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add employee document: ${error.message}`);
    return data;
  }

  /**
   * Lists confidential documents for an employee.
   */
  static async listDocuments(
    client: SupabaseClient,
    employeeId: string,
    companyId: string,
    accessLevel?: string
  ) {
    let query = client
      .from('employee_documents')
      .select('*')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId);

    if (accessLevel) query = query.eq('access_level', accessLevel);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list employee documents: ${error.message}`);
    return data;
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import {
  TerritoryCreateDto,
  TerritoryUpdateDto,
  TerritoryMemberAssignDto,
  TeamCreateDto,
  TeamMemberAssignDto,
} from '../schemas/service-territory.schema.js';

export class ServiceTerritoryService {
  /**
   * Pure check to determine if technician has coverage in a specific territory.
   */
  static isTechnicianInTerritory(
    assignedTerritoryIds: string[],
    targetTerritoryId: string
  ): boolean {
    if (!targetTerritoryId) return true;
    return assignedTerritoryIds.includes(targetTerritoryId);
  }

  /**
   * Creates a service territory.
   */
  static async createTerritory(client: SupabaseClient, dto: TerritoryCreateDto) {
    const { data, error } = await client
      .from('service_territories')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        code: dto.code,
        name: dto.name,
        description: dto.description || null,
        area_description: dto.areaDescription || null,
        working_hours: dto.workingHours || {},
        priority_rules: dto.priorityRules || {},
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create service territory: ${error.message}`);
    return data;
  }

  /**
   * Retrieves single territory by ID.
   */
  static async getTerritory(client: SupabaseClient, id: string) {
    const { data, error } = await client
      .from('service_territories')
      .select('*, members:service_territory_members(*, employee:employees(id, display_name, work_email))')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Territory not found: ${error.message}`);
    return data;
  }

  /**
   * Lists service territories for a company.
   */
  static async listTerritories(client: SupabaseClient, companyId: string, isActiveOnly = true) {
    let query = client
      .from('service_territories')
      .select('*, member_count:service_territory_members(count)')
      .eq('company_id', companyId);

    if (isActiveOnly) query = query.eq('is_active', true);

    const { data, error } = await query.order('code', { ascending: true });
    if (error) throw new Error(`Failed to list service territories: ${error.message}`);
    return data;
  }

  /**
   * Assigns a technician to a service territory.
   */
  static async assignMember(client: SupabaseClient, dto: TerritoryMemberAssignDto) {
    const { data, error } = await client
      .from('service_territory_members')
      .upsert(
        {
          company_id: dto.companyId,
          territory_id: dto.territoryId,
          employee_id: dto.employeeId,
          is_primary: dto.isPrimary !== undefined ? dto.isPrimary : true,
          effective_from: dto.effectiveFrom || new Date().toISOString().split('T')[0],
          effective_to: dto.effectiveTo || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'territory_id, employee_id' }
      )
      .select('*, employee:employees(id, display_name, work_email)')
      .single();

    if (error) throw new Error(`Failed to assign technician to territory: ${error.message}`);
    return data;
  }

  /**
   * Lists territories assigned to a specific technician.
   */
  static async getTechnicianTerritories(
    client: SupabaseClient,
    companyId: string,
    employeeId: string
  ): Promise<string[]> {
    const { data, error } = await client
      .from('service_territory_members')
      .select('territory_id')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId);

    if (error) throw new Error(`Failed to fetch technician territories: ${error.message}`);
    return (data || []).map((m: any) => m.territory_id);
  }

  /**
   * Creates a service team.
   */
  static async createTeam(client: SupabaseClient, dto: TeamCreateDto) {
    const { data, error } = await client
      .from('service_teams')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        code: dto.code,
        name: dto.name,
        leader_id: dto.leaderId || null,
        territory_id: dto.territoryId || null,
        description: dto.description || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      })
      .select('*, leader:employees!leader_id(id, display_name), territory:service_territories(id, name, code)')
      .single();

    if (error) throw new Error(`Failed to create service team: ${error.message}`);
    return data;
  }

  /**
   * Lists teams for a company.
   */
  static async listTeams(client: SupabaseClient, companyId: string) {
    const { data, error } = await client
      .from('service_teams')
      .select('*, leader:employees!leader_id(id, display_name), territory:service_territories(id, name, code), members:service_team_members(count)')
      .eq('company_id', companyId)
      .order('code', { ascending: true });

    if (error) throw new Error(`Failed to list service teams: ${error.message}`);
    return data;
  }

  /**
   * Assigns an employee to a service team.
   */
  static async assignTeamMember(client: SupabaseClient, dto: TeamMemberAssignDto) {
    const { data, error } = await client
      .from('service_team_members')
      .upsert(
        {
          company_id: dto.companyId,
          team_id: dto.teamId,
          employee_id: dto.employeeId,
          role_in_team: dto.roleInTeam || 'member',
          is_active: dto.isActive !== undefined ? dto.isActive : true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id, employee_id' }
      )
      .select('*, employee:employees(id, display_name)')
      .single();

    if (error) throw new Error(`Failed to assign team member: ${error.message}`);
    return data;
  }
}

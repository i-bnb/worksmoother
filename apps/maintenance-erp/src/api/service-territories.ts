import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceTerritoryService } from '../services/service-territory.service.js';
import {
  validateTerritoryCreate,
  validateTerritoryMemberAssign,
  validateTeamCreate,
  validateTeamMemberAssign,
} from '../schemas/service-territory.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class ServiceTerritoriesApiController {
  static async createTerritory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateTerritoryCreate(req.body);
      const data = await ServiceTerritoryService.createTerritory(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async getTerritory(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Territory ID is required' };
      const data = await ServiceTerritoryService.getTerritory(client, id);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 404, error: err.message };
    }
  }

  static async listTerritories(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await ServiceTerritoryService.listTerritories(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async assignMember(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateTerritoryMemberAssign(req.body);
      const data = await ServiceTerritoryService.assignMember(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async createTeam(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateTeamCreate(req.body);
      const data = await ServiceTerritoryService.createTeam(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  static async listTeams(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };
      const data = await ServiceTerritoryService.listTeams(client, companyId);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 500, error: err.message };
    }
  }

  static async assignTeamMember(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateTeamMemberAssign(req.body);
      const data = await ServiceTerritoryService.assignTeamMember(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

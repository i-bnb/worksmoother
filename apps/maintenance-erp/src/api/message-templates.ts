import { SupabaseClient } from '@supabase/supabase-js';
import { TemplateEngineService } from '../services/template-engine.service.js';
import {
  validateMessageTemplateCreate,
  validateMessageTemplateUpdate,
} from '../schemas/message-template.schema.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class MessageTemplatesApiController {
  /**
   * GET /api/message-templates
   */
  static async listTemplates(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const channel = req.query?.channel;
      const data = await TemplateEngineService.listTemplates(client, companyId, channel);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/message-templates
   */
  static async createTemplate(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const validated = validateMessageTemplateCreate(req.body);
      const data = await TemplateEngineService.createTemplate(client, validated);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/message-templates/:id
   */
  static async getTemplate(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Template ID is required' };

      const data = await TemplateEngineService.getTemplate(client, id);
      if (!data) return { status: 404, error: 'Message template not found' };

      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/message-templates/:id
   */
  static async updateTemplate(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const id = req.params?.id;
      if (!id) return { status: 400, error: 'Template ID is required' };

      const validated = validateMessageTemplateUpdate(req.body);
      const data = await TemplateEngineService.updateTemplate(client, id, validated);
      return { status: 200, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

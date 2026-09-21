/**
 * =============================================================================
 * Suppliers REST API Controller
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { SupplierService } from '../services/supplier.service.js';
import { ProcurementReportingService } from '../services/procurement-reporting.service.js';
import { ApiRequest, ApiResponse } from './quotations.js';

export class SuppliersApiController {
  /**
   * POST /api/suppliers
   */
  static async createSupplier(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const result = await SupplierService.createSupplier(client, req.body, userId);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers
   */
  static async listSuppliers(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const filters = {
        status: req.query?.status,
        supplierType: req.query?.supplierType || req.query?.supplier_type,
        category: req.query?.category,
        search: req.query?.search,
      };

      const result = await SupplierService.listSuppliers(client, companyId, filters);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers/:id
   */
  static async getSupplierById(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.query?.companyId || req.query?.company_id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await SupplierService.getSupplierDetail(client, companyId, supplierId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PUT /api/suppliers/:id
   */
  static async updateSupplier(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id || req.query?.companyId;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await SupplierService.updateSupplier(client, companyId, supplierId, req.body);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * PATCH /api/suppliers/:id/status
   */
  static async updateSupplierStatus(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id || req.query?.companyId;
      const { newStatus, status, reason } = req.body || {};
      const targetStatus = newStatus || status;

      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };
      if (!targetStatus) return { status: 400, error: 'status is required' };

      const result = await SupplierService.changeSupplierStatus(
        client,
        companyId,
        supplierId,
        { status: targetStatus, reason: reason || 'Status updated via API' },
        userId
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/suppliers/:id/contacts
   */
  static async addContact(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await SupplierService.addContact(client, companyId, supplierId, req.body);
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers/:id/contacts
   */
  static async listContacts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };

      const { data, error } = await client
        .from('supplier_contacts')
        .select('*')
        .eq('supplier_id', supplierId);

      if (error) throw new Error(error.message);
      return { status: 200, data: data || [] };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/suppliers/:id/addresses
   */
  static async addAddress(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const { data, error } = await client
        .from('supplier_addresses')
        .insert({
          company_id: companyId,
          supplier_id: supplierId,
          address_type: req.body.addressType || req.body.address_type || 'billing',
          address_line1: req.body.addressLine1 || req.body.address_line1 || req.body.address,
          address_line2: req.body.addressLine2 || req.body.address_line2 || null,
          city: req.body.city || null,
          state: req.body.state || null,
          country: req.body.country || 'AE',
          postal_code: req.body.postalCode || req.body.postal_code || null,
          is_primary: Boolean(req.body.isPrimary || req.body.is_primary),
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/suppliers/:id/products
   */
  static async addSupplierProduct(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const result = await SupplierService.mapProduct(client, {
        companyId,
        supplierId,
        itemId: req.body.itemId || req.body.item_id,
        supplierSku: req.body.supplierSku || req.body.supplier_sku,
        supplierDescription: req.body.supplierDescription || req.body.supplier_description,
        unit: req.body.unit || 'pcs',
        standardPurchasePrice: req.body.standardPurchasePrice || req.body.standard_purchase_price,
        lastPurchasePrice: req.body.lastPurchasePrice || req.body.last_purchase_price,
        minOrderQuantity: req.body.minOrderQuantity || req.body.min_order_quantity,
        leadTimeDays: req.body.leadTimeDays || req.body.lead_time_days,
        isPreferred: req.body.isPreferred || req.body.is_preferred,
      });
      return { status: 201, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers/:id/products
   */
  static async listSupplierProducts(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };

      const { data, error } = await client
        .from('supplier_products')
        .select('*, items(name, item_code)')
        .eq('supplier_id', supplierId);

      if (error) throw new Error(error.message);
      return { status: 200, data: data || [] };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * POST /api/suppliers/:id/documents
   */
  static async uploadDocument(client: SupabaseClient, req: ApiRequest, userId?: string): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const companyId = req.body?.companyId || req.body?.company_id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!companyId) return { status: 400, error: 'companyId is required' };

      const { data, error } = await client
        .from('supplier_documents')
        .insert({
          company_id: companyId,
          supplier_id: supplierId,
          document_type: req.body.documentType || req.body.document_type || 'other',
          document_name: req.body.documentName || req.body.document_name,
          file_url: req.body.fileUrl || req.body.file_url,
          file_size_bytes: req.body.fileSizeBytes || req.body.file_size_bytes || null,
          expiry_date: req.body.expiryDate || req.body.expiry_date || null,
          uploaded_by: userId || null,
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      return { status: 201, data };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers/:id/statement
   */
  static async getStatement(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      const fromDate = req.query?.fromDate || req.query?.from_date;
      const toDate = req.query?.toDate || req.query?.to_date;

      if (!supplierId) return { status: 400, error: 'supplierId is required' };
      if (!fromDate || !toDate) return { status: 400, error: 'fromDate and toDate are required' };

      const result = await ProcurementReportingService.getSupplierStatement(
        client,
        supplierId,
        fromDate,
        toDate
      );
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }

  /**
   * GET /api/suppliers/:id/performance
   */
  static async getPerformance(client: SupabaseClient, req: ApiRequest): Promise<ApiResponse> {
    try {
      const supplierId = req.params?.id;
      if (!supplierId) return { status: 400, error: 'supplierId is required' };

      const result = await ProcurementReportingService.getSupplierPerformanceMetrics(client, supplierId);
      return { status: 200, data: result };
    } catch (err: any) {
      return { status: 400, error: err.message };
    }
  }
}

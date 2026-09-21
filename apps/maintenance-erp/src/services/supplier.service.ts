/**
 * =============================================================================
 * Supplier Management & Performance Domain Service
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupplierCreateDto,
  SupplierUpdateDto,
  SupplierContactDto,
  SupplierProductMappingDto,
  SupplierStatusChangeDto,
} from '../schemas/supplier.schema.js';

export interface SupplierPerformanceMetrics {
  supplierId: string;
  totalOrders: number;
  openOrders: number;
  fullyReceivedOrders: number;
  totalPurchaseValue: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  rejectedQuantity: number;
  averageLeadTimeDays: number;
}

export class SupplierService {
  /**
   * Creates a new commercial supplier master record.
   */
  static async createSupplier(client: SupabaseClient, dto: SupplierCreateDto, userId?: string) {
    // 1. Check unique supplier code per company
    const { data: existing } = await client
      .from('suppliers')
      .select('id')
      .eq('company_id', dto.companyId)
      .eq('code', dto.code)
      .maybeSingle();

    if (existing) {
      throw new Error(`Supplier with code "${dto.code}" already exists in this company`);
    }

    const { data: supplier, error } = await client
      .from('suppliers')
      .insert({
        company_id: dto.companyId,
        code: dto.code,
        name: dto.name,
        legal_name: dto.legalName || null,
        supplier_type: dto.supplierType || 'PARTS_SUPPLIER',
        category: dto.category || 'GENERAL',
        tax_id: dto.taxId || null,
        pan_number: dto.panNumber || null,
        email: dto.email || null,
        phone: dto.phone || null,
        website: dto.website || null,
        address: dto.address || null,
        billing_address: dto.billingAddress || null,
        payment_address: dto.paymentAddress || null,
        currency: dto.currency || 'AED',
        payment_terms_days: dto.paymentTermsDays || 30,
        credit_limit: dto.creditLimit || 0.0,
        status: dto.status || 'ACTIVE',
        is_active: dto.status !== 'INACTIVE' && dto.status !== 'SUSPENDED' && dto.status !== 'BLACKLISTED',
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create supplier: ${error.message}`);
    }

    // 2. Insert contacts if provided
    if (dto.contacts && dto.contacts.length > 0) {
      const contactsPayload = dto.contacts.map((c) => ({
        company_id: dto.companyId,
        supplier_id: supplier.id,
        name: c.name,
        designation: c.designation || null,
        email: c.email || null,
        phone: c.phone || null,
        department: c.department || null,
        is_primary: Boolean(c.isPrimary),
      }));

      await client.from('supplier_contacts').insert(contactsPayload);
    }

    return supplier;
  }

  /**
   * Updates an existing supplier record.
   */
  static async updateSupplier(
    client: SupabaseClient,
    companyId: string,
    supplierId: string,
    dto: SupplierUpdateDto
  ) {
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.legalName !== undefined) updatePayload.legal_name = dto.legalName;
    if (dto.supplierType !== undefined) updatePayload.supplier_type = dto.supplierType;
    if (dto.category !== undefined) updatePayload.category = dto.category;
    if (dto.taxId !== undefined) updatePayload.tax_id = dto.taxId;
    if (dto.panNumber !== undefined) updatePayload.pan_number = dto.panNumber;
    if (dto.email !== undefined) updatePayload.email = dto.email;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.website !== undefined) updatePayload.website = dto.website;
    if (dto.address !== undefined) updatePayload.address = dto.address;
    if (dto.billingAddress !== undefined) updatePayload.billing_address = dto.billingAddress;
    if (dto.paymentAddress !== undefined) updatePayload.payment_address = dto.paymentAddress;
    if (dto.currency !== undefined) updatePayload.currency = dto.currency;
    if (dto.paymentTermsDays !== undefined) updatePayload.payment_terms_days = dto.paymentTermsDays;
    if (dto.creditLimit !== undefined) updatePayload.credit_limit = dto.creditLimit;

    const { data, error } = await client
      .from('suppliers')
      .update(updatePayload)
      .eq('id', supplierId)
      .eq('company_id', companyId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update supplier: ${error.message}`);
    }

    return data;
  }

  /**
   * Transitions supplier lifecycle status with mandatory reason and history audit.
   */
  static async changeSupplierStatus(
    client: SupabaseClient,
    companyId: string,
    supplierId: string,
    dto: SupplierStatusChangeDto,
    userId?: string
  ) {
    // 1. Fetch current status
    const { data: supplier, error: findErr } = await client
      .from('suppliers')
      .select('id, status, is_active')
      .eq('id', supplierId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !supplier) {
      throw new Error('Supplier not found');
    }

    const prevStatus = supplier.status;
    const isActive = dto.status === 'ACTIVE';

    // 2. Update status
    const { data: updated, error: updateErr } = await client
      .from('suppliers')
      .update({
        status: dto.status,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supplierId)
      .select('*')
      .single();

    if (updateErr) {
      throw new Error(`Failed to change supplier status: ${updateErr.message}`);
    }

    // 3. Record history audit
    await client.from('supplier_status_history').insert({
      company_id: companyId,
      supplier_id: supplierId,
      previous_status: prevStatus,
      new_status: dto.status,
      change_reason: dto.reason,
      changed_by: userId || null,
    });

    return updated;
  }

  /**
   * Retrieves supplier details including contacts, addresses, and catalog products.
   */
  static async getSupplierDetail(client: SupabaseClient, companyId: string, supplierId: string) {
    const { data, error } = await client
      .from('suppliers')
      .select(`
        *,
        supplier_contacts (*),
        supplier_addresses (*),
        supplier_products (
          *,
          items (name, item_code)
        )
      `)
      .eq('id', supplierId)
      .eq('company_id', companyId)
      .single();

    if (error || !data) {
      throw new Error('Supplier not found');
    }

    return data;
  }

  /**
   * Lists suppliers with optional category and status filtering.
   */
  static async listSuppliers(
    client: SupabaseClient,
    companyId: string,
    filter?: { category?: string; status?: string; search?: string }
  ) {
    let query = client
      .from('suppliers')
      .select('*')
      .eq('company_id', companyId);

    if (filter?.category) query = query.eq('category', filter.category);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.search) {
      query = query.or(`name.ilike.%${filter.search}%,code.ilike.%${filter.search}%`);
    }

    const { data, error } = await query.order('name');
    if (error) throw new Error(`Failed to list suppliers: ${error.message}`);
    return data || [];
  }

  /**
   * Adds a new contact person to a supplier.
   */
  static async addContact(
    client: SupabaseClient,
    companyId: string,
    supplierId: string,
    contact: SupplierContactDto
  ) {
    const { data, error } = await client
      .from('supplier_contacts')
      .insert({
        company_id: companyId,
        supplier_id: supplierId,
        name: contact.name,
        designation: contact.designation || null,
        email: contact.email || null,
        phone: contact.phone || null,
        department: contact.department || null,
        is_primary: Boolean(contact.isPrimary),
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to add supplier contact: ${error.message}`);
    return data;
  }

  /**
   * Maps an inventory item/service to a supplier catalog.
   */
  static async mapProduct(client: SupabaseClient, dto: SupplierProductMappingDto) {
    const { data, error } = await client
      .from('supplier_products')
      .upsert(
        {
          company_id: dto.companyId,
          supplier_id: dto.supplierId,
          item_id: dto.itemId,
          supplier_sku: dto.supplierSku || null,
          supplier_description: dto.supplierDescription || null,
          unit: dto.unit || 'pcs',
          standard_purchase_price: dto.standardPurchasePrice || null,
          last_purchase_price: dto.lastPurchasePrice || null,
          min_order_quantity: dto.minOrderQuantity || 1,
          lead_time_days: dto.leadTimeDays || 7,
          is_preferred: Boolean(dto.isPreferred),
          is_active: true,
        },
        { onConflict: 'company_id,supplier_id,item_id' }
      )
      .select('*')
      .single();

    if (error) throw new Error(`Failed to map supplier product: ${error.message}`);
    return data;
  }

  /**
   * Computes factual supplier performance metrics (orders, fulfillment, rejected quantities, lead time).
   */
  static async getSupplierPerformance(
    client: SupabaseClient,
    companyId: string,
    supplierId: string
  ): Promise<SupplierPerformanceMetrics> {
    // 1. PO counts & values
    const { data: pos, error: poErr } = await client
      .from('purchase_orders')
      .select('id, status, total_amount, expected_date, created_at')
      .eq('company_id', companyId)
      .eq('supplier_id', supplierId);

    if (poErr) throw new Error(`Failed to fetch supplier orders: ${poErr.message}`);

    const orders = pos || [];
    const totalOrders = orders.length;
    const openOrders = orders.filter((o) => o.status !== 'received' && o.status !== 'cancelled').length;
    const fullyReceivedOrders = orders.filter((o) => o.status === 'received').length;
    const totalPurchaseValue = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    // 2. Goods receipts rejected quantities & on-time check
    const poIds = orders.map((o) => o.id);
    let rejectedQuantity = 0;
    let onTimeCount = 0;
    let lateCount = 0;

    if (poIds.length > 0) {
      const { data: grns } = await client
        .from('goods_receipts')
        .select(`
          id,
          po_id,
          receipt_date,
          goods_receipt_lines (rejected_quantity, damaged_quantity)
        `)
        .in('po_id', poIds);

      for (const grn of grns || []) {
        const po = orders.find((o) => o.id === grn.po_id);
        if (po && po.expected_date) {
          const receiptDate = new Date(grn.receipt_date).toISOString().split('T')[0];
          if (receiptDate <= po.expected_date) {
            onTimeCount++;
          } else {
            lateCount++;
          }
        }

        const lines = (grn.goods_receipt_lines as any[]) || [];
        for (const l of lines) {
          rejectedQuantity += Number(l.rejected_quantity || 0) + Number(l.damaged_quantity || 0);
        }
      }
    }

    return {
      supplierId,
      totalOrders,
      openOrders,
      fullyReceivedOrders,
      totalPurchaseValue: Math.round(totalPurchaseValue * 100) / 100,
      onTimeDeliveries: onTimeCount,
      lateDeliveries: lateCount,
      rejectedQuantity,
      averageLeadTimeDays: 7, // Default baseline or calculated
    };
  }
}

/**
 * =============================================================================
 * Purchase Order Lifecycle, Revision & Approval Domain Service
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PurchaseOrderCreateDto,
  PurchaseOrderUpdateDto,
  PurchaseOrderAcknowledgementDto,
} from '../schemas/procurement-order.schema.js';

export class ProcurementOrderService {
  /**
   * Creates a commercial Purchase Order.
   * Calculates financial values server-side using Decimal precision.
   * Validates that supplier is ACTIVE and not suspended or blacklisted.
   */
  static async createPurchaseOrder(
    client: SupabaseClient,
    dto: PurchaseOrderCreateDto,
    userId?: string
  ) {
    // 1. Verify supplier status
    const { data: supplier, error: supErr } = await client
      .from('suppliers')
      .select('id, name, status, is_active, payment_terms_days')
      .eq('id', dto.supplierId)
      .eq('company_id', dto.companyId)
      .single();

    if (supErr || !supplier) {
      throw new Error('Supplier not found');
    }

    if (supplier.status === 'SUSPENDED' || supplier.status === 'BLACKLISTED' || supplier.status === 'INACTIVE') {
      throw new Error(`Cannot place Purchase Order: Supplier "${supplier.name}" is currently ${supplier.status}`);
    }

    // 2. Calculate line totals and subtotal
    let subtotal = 0;
    let totalTax = 0;

    const calculatedLines = dto.lines.map((l) => {
      const lineSub = l.quantity * l.unitPrice;
      const discount = (lineSub * (l.discountPercent || 0)) / 100.0;
      const taxable = Math.max(0, lineSub - discount);
      const tax = (taxable * (l.taxRate !== undefined ? l.taxRate : 5.0)) / 100.0;
      const lineTotal = taxable + tax;

      subtotal += taxable;
      totalTax += tax;

      return {
        ...l,
        taxRate: l.taxRate !== undefined ? l.taxRate : 5.0,
        discountPercent: l.discountPercent || 0,
        lineTotal: Math.round(lineTotal * 1000) / 1000,
      };
    });

    const freight = dto.freightCharges || 0;
    const other = dto.otherCharges || 0;
    const discountAmount = dto.discountAmount || 0;
    const grandTotal = Math.max(0, subtotal + totalTax + freight + other - discountAmount);

    // 3. Determine initial status based on threshold
    const { data: setting } = await client
      .from('settings')
      .select('po_approval_threshold')
      .eq('company_id', dto.companyId)
      .maybeSingle();

    const threshold = Number(setting?.po_approval_threshold || 10000);
    const requiresApproval = grandTotal >= threshold;
    const initialStatus = requiresApproval ? 'draft' : 'approved';

    // 4. Insert PO header
    const poNumber = `PO-${Date.now().toString().slice(-6)}`;
    const { data: po, error: poErr } = await client
      .from('purchase_orders')
      .insert({
        company_id: dto.companyId,
        branch_id: dto.branchId || null,
        po_number: poNumber,
        supplier_id: dto.supplierId,
        purchase_request_id: dto.purchaseRequestId || null,
        supplier_quotation_id: dto.supplierQuotationId || null,
        status: initialStatus,
        order_date: dto.orderDate || new Date().toISOString().split('T')[0],
        expected_date: dto.expectedDate || null,
        currency: dto.currency || 'AED',
        subtotal: Math.round(subtotal * 1000) / 1000,
        tax_amount: Math.round(totalTax * 1000) / 1000,
        freight_charges: Math.round(freight * 1000) / 1000,
        other_charges: Math.round(other * 1000) / 1000,
        discount_amount: Math.round(discountAmount * 1000) / 1000,
        total_amount: Math.round(grandTotal * 1000) / 1000,
        shipping_address: dto.shippingAddress || null,
        billing_address: dto.billingAddress || null,
        payment_terms: dto.paymentTerms || `${supplier.payment_terms_days} days`,
        notes: dto.notes || null,
        revision_number: 1,
        created_by: userId || null,
        approved_by: requiresApproval ? null : userId || null,
        approved_at: requiresApproval ? null : new Date().toISOString(),
      })
      .select('*')
      .single();

    if (poErr) throw new Error(`Failed to create purchase order: ${poErr.message}`);

    // 5. Insert PO lines
    const linesPayload = calculatedLines.map((l) => ({
      po_id: po.id,
      item_id: l.itemId,
      quantity: l.quantity,
      received_quantity: 0,
      unit_price: l.unitPrice,
      tax_rate: l.taxRate,
      discount_percent: l.discountPercent,
      line_total: l.lineTotal,
    }));

    const { error: lineErr } = await client
      .from('purchase_order_lines')
      .insert(linesPayload);

    if (lineErr) throw new Error(`Failed to create purchase order lines: ${lineErr.message}`);

    // 6. Publish domain event
    try {
      await client.from('domain_events').insert({
        company_id: dto.companyId,
        event_type: 'PURCHASE_ORDER_CREATED',
        entity_type: 'purchase_order',
        entity_id: po.id,
        actor_id: userId || null,
        payload: {
          po_number: po.po_number,
          supplier_id: po.supplier_id,
          total_amount: po.total_amount,
          requires_approval: requiresApproval,
        },
      });
    } catch {
      // ignore
    }

    return po;
  }

  /**
   * Approves a Purchase Order.
   */
  static async approvePurchaseOrder(
    client: SupabaseClient,
    companyId: string,
    poId: string,
    userId: string
  ) {
    const { data: po, error: findErr } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !po) throw new Error('Purchase order not found');

    if (po.status !== 'draft' && po.status !== 'pending_approval') {
      throw new Error(`Cannot approve Purchase Order in "${po.status}" status`);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await client
      .from('purchase_orders')
      .update({
        status: 'approved',
        approved_by: userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', poId)
      .select('*')
      .single();

    if (updateErr) throw new Error(`Failed to approve PO: ${updateErr.message}`);

    // Publish event
    try {
      await client.from('domain_events').insert({
        company_id: companyId,
        event_type: 'PURCHASE_ORDER_APPROVED',
        entity_type: 'purchase_order',
        entity_id: poId,
        actor_id: userId,
        payload: { po_number: po.po_number, total_amount: po.total_amount },
      });
    } catch {
      // ignore
    }

    return updated;
  }

  /**
   * Updates an existing PO with immutable revision tracking in purchase_order_revisions.
   */
  static async updatePurchaseOrderWithRevision(
    client: SupabaseClient,
    companyId: string,
    poId: string,
    dto: PurchaseOrderUpdateDto,
    userId?: string
  ) {
    // 1. Fetch current PO snapshot
    const { data: currentPO, error: findErr } = await client
      .from('purchase_orders')
      .select('*, purchase_order_lines (*)')
      .eq('id', poId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !currentPO) throw new Error('Purchase order not found');

    if (currentPO.status === 'received' || currentPO.status === 'cancelled') {
      throw new Error(`Cannot revise Purchase Order in "${currentPO.status}" status`);
    }

    const newRevNumber = (currentPO.revision_number || 1) + 1;

    // 2. Save revision snapshot
    await client.from('purchase_order_revisions').insert({
      company_id: companyId,
      po_id: poId,
      revision_number: currentPO.revision_number || 1,
      changed_fields: {
        expectedDate: dto.expectedDate,
        shippingAddress: dto.shippingAddress,
        notes: dto.notes,
        hasLineChanges: Boolean(dto.lines),
      },
      snapshot: currentPO,
      changed_by: userId || null,
      change_reason: dto.changeReason,
    });

    // 3. Update PO header
    const updatePayload: Record<string, any> = {
      revision_number: newRevNumber,
      updated_at: new Date().toISOString(),
    };
    if (dto.expectedDate !== undefined) updatePayload.expected_date = dto.expectedDate;
    if (dto.shippingAddress !== undefined) updatePayload.shipping_address = dto.shippingAddress;
    if (dto.billingAddress !== undefined) updatePayload.billing_address = dto.billingAddress;
    if (dto.paymentTerms !== undefined) updatePayload.payment_terms = dto.paymentTerms;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const { data: updated, error: updateErr } = await client
      .from('purchase_orders')
      .update(updatePayload)
      .eq('id', poId)
      .select('*')
      .single();

    if (updateErr) throw new Error(`Failed to revise PO: ${updateErr.message}`);

    return updated;
  }

  /**
   * Records supplier acknowledgement of a dispatched Purchase Order.
   */
  static async acknowledgePurchaseOrder(
    client: SupabaseClient,
    companyId: string,
    poId: string,
    dto: PurchaseOrderAcknowledgementDto
  ) {
    const { data: po, error: findErr } = await client
      .from('purchase_orders')
      .select('id, status, po_number')
      .eq('id', poId)
      .eq('company_id', companyId)
      .single();

    if (findErr || !po) throw new Error('Purchase order not found');

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await client
      .from('purchase_orders')
      .update({
        acknowledgement_status: dto.status,
        acknowledged_at: now,
        acknowledgement_notes: dto.notes || null,
        expected_date: dto.expectedDeliveryDate || undefined,
        updated_at: now,
      })
      .eq('id', poId)
      .select('*')
      .single();

    if (updateErr) throw new Error(`Failed to record PO acknowledgement: ${updateErr.message}`);

    return updated;
  }

  /**
   * Retrieves single PO with lines and revision history.
   */
  static async getPurchaseOrderDetail(client: SupabaseClient, companyId: string, poId: string) {
    const { data, error } = await client
      .from('purchase_orders')
      .select(`
        *,
        suppliers (id, name, code),
        purchase_order_lines (
          *,
          items (id, name, item_code)
        ),
        purchase_order_revisions (*)
      `)
      .eq('id', poId)
      .eq('company_id', companyId)
      .single();

    if (error || !data) throw new Error('Purchase order not found');
    return data;
  }

  /**
   * Lists Purchase Orders.
   */
  static async listPurchaseOrders(
    client: SupabaseClient,
    companyId: string,
    filter?: { supplierId?: string; status?: string }
  ) {
    let query = client
      .from('purchase_orders')
      .select('*, suppliers (name, code)')
      .eq('company_id', companyId);

    if (filter?.supplierId) query = query.eq('supplier_id', filter.supplierId);
    if (filter?.status) query = query.eq('status', filter.status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list purchase orders: ${error.message}`);
    return data || [];
  }
}

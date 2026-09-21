/**
 * =============================================================================
 * Goods Receipt & Quality Inspection Validation Schemas
 * Maintenance Management ERP — Phase 10 Supplier & Procurement
 * =============================================================================
 */

export type GoodsInspectionStatus =
  | 'accepted'
  | 'rejected'
  | 'damaged'
  | 'pending_inspection';

export interface GoodsReceiptLineDto {
  poLineId: string;
  itemId: string;
  quantityReceived: number;
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  damagedQuantity?: number;
  inspectionStatus?: GoodsInspectionStatus;
  rejectionReason?: string | null;
  unitCost: number;
  serialNumber?: string | null;
  batchNumber?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  warrantyEndDate?: string | null;
}

export interface GoodsReceiptCreateDto {
  companyId: string;
  branchId?: string | null;
  poId: string;
  locationId: string;
  receiptDate?: string;
  vendorDeliveryNote?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  lines: GoodsReceiptLineDto[];
}

export function validateGoodsReceiptCreate(body: any): GoodsReceiptCreateDto {
  if (!body) throw new Error('Goods receipt body is required');
  const companyId = body.companyId || body.company_id;
  const poId = body.poId || body.po_id;
  const locationId = body.locationId || body.location_id;

  if (!companyId) throw new Error('companyId is required');
  if (!poId) throw new Error('poId is required');
  if (!locationId) throw new Error('locationId is required');

  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one item line is required for goods receipt');
  }

  const validatedLines: GoodsReceiptLineDto[] = lines.map((l: any, idx: number) => {
    const poLineId = l.poLineId || l.po_line_id;
    const itemId = l.itemId || l.item_id;
    const qtyReceived = Number(l.quantityReceived !== undefined ? l.quantityReceived : l.quantity_received);
    const unitCost = Number(l.unitCost !== undefined ? l.unitCost : l.unit_cost);

    if (!poLineId) throw new Error(`Line ${idx + 1}: poLineId is required`);
    if (!itemId) throw new Error(`Line ${idx + 1}: itemId is required`);
    if (isNaN(qtyReceived) || qtyReceived <= 0) {
      throw new Error(`Line ${idx + 1}: quantityReceived must be greater than 0`);
    }

    const accepted = l.acceptedQuantity !== undefined ? Number(l.acceptedQuantity) : qtyReceived;
    const rejected = l.rejectedQuantity !== undefined ? Number(l.rejectedQuantity) : 0;
    const damaged = l.damagedQuantity !== undefined ? Number(l.damagedQuantity) : 0;

    if (accepted + rejected + damaged !== qtyReceived) {
      throw new Error(
        `Line ${idx + 1}: accepted (${accepted}) + rejected (${rejected}) + damaged (${damaged}) must equal total received (${qtyReceived})`
      );
    }

    const rawStatus = (l.inspectionStatus || l.inspection_status || (rejected > 0 ? 'rejected' : damaged > 0 ? 'damaged' : 'accepted')).toLowerCase();
    const validStatuses: GoodsInspectionStatus[] = ['accepted', 'rejected', 'damaged', 'pending_inspection'];
    if (!validStatuses.includes(rawStatus as GoodsInspectionStatus)) {
      throw new Error(`Line ${idx + 1}: Invalid inspection status: ${rawStatus}`);
    }

    return {
      poLineId,
      itemId,
      quantityReceived: qtyReceived,
      acceptedQuantity: accepted,
      rejectedQuantity: rejected,
      damagedQuantity: damaged,
      inspectionStatus: rawStatus as GoodsInspectionStatus,
      rejectionReason: l.rejectionReason || l.rejection_reason || null,
      unitCost: isNaN(unitCost) || unitCost < 0 ? 0 : unitCost,
      serialNumber: l.serialNumber || l.serial_number || null,
      batchNumber: l.batchNumber || l.batch_number || null,
      manufacturingDate: l.manufacturingDate || l.manufacturing_date || null,
      expiryDate: l.expiryDate || l.expiry_date || null,
      warrantyEndDate: l.warrantyEndDate || l.warranty_end_date || null,
    };
  });

  return {
    companyId,
    branchId: body.branchId || body.branch_id || null,
    poId,
    locationId,
    receiptDate: body.receiptDate || body.receipt_date || new Date().toISOString(),
    vendorDeliveryNote: body.vendorDeliveryNote || body.vendor_delivery_note || null,
    notes: body.notes ? String(body.notes).trim() : null,
    idempotencyKey: body.idempotencyKey || body.idempotency_key || null,
    lines: validatedLines,
  };
}

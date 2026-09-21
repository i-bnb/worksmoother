import { SupabaseClient } from '@supabase/supabase-js';
import { Decimal } from '../lib/decimal.js';
import {
  ThreeWayMatchRequestDto,
  validateThreeWayMatchRequest,
} from '../schemas/accounts-payable.schema.js';
import { EventDispatcherService } from './event-dispatcher.service.js';

export interface MatchingLineComparison {
  billLineId: string;
  itemId: string | null;
  description: string;
  billedQuantity: number;
  receivedQuantity: number;
  poQuantity: number;
  billedUnitPrice: number;
  poUnitPrice: number;
  priceVariancePercent: number;
  quantityVariancePercent: number;
  status: 'matched' | 'price_variance' | 'quantity_variance' | 'exception';
  notes?: string;
}

export interface ThreeWayMatchResult {
  billId: string;
  matchingStatus: 'matched' | 'price_variance' | 'quantity_variance' | 'missing_receipt' | 'missing_po' | 'exception';
  priceTolerancePercent: number;
  quantityTolerancePercent: number;
  variances: any[];
  lines: MatchingLineComparison[];
  matchedAt: string;
  matchedBy?: string | null;
}

export class ThreeWayMatchingService {
  /**
   * Performs 3-way matching between Supplier Bill, Purchase Order, and Goods Receipt.
   */
  static async matchSupplierBill(
    client: SupabaseClient,
    rawDto: ThreeWayMatchRequestDto,
    userId?: string
  ): Promise<ThreeWayMatchResult> {
    const dto = validateThreeWayMatchRequest(rawDto);
    const now = new Date().toISOString();
    const priceTol = new Decimal(dto.priceTolerancePercent ?? 1.0);
    const qtyTol = new Decimal(dto.quantityTolerancePercent ?? 2.0);

    // 1. Fetch the Supplier Bill
    const { data: bill, error: billErr } = await client
      .from('supplier_bills')
      .select('*, lines:supplier_bill_lines(*)')
      .eq('id', dto.billId)
      .single();

    if (billErr || !bill) {
      throw new Error(`Supplier bill not found: ${billErr?.message || dto.billId}`);
    }

    // 2. Check for Linked Purchase Order
    if (!bill.po_id) {
      await client
        .from('supplier_bills')
        .update({
          matching_status: 'missing_po',
          matching_variance: [{ issue: 'Bill has no Purchase Order linked' }],
          matched_at: now,
          matched_by: userId || null,
        })
        .eq('id', bill.id);

      return {
        billId: bill.id,
        matchingStatus: 'missing_po',
        priceTolerancePercent: priceTol.toNumber(),
        quantityTolerancePercent: qtyTol.toNumber(),
        variances: [{ issue: 'Bill has no Purchase Order linked' }],
        lines: [],
        matchedAt: now,
        matchedBy: userId,
      };
    }

    // Fetch PO and PO Lines
    const { data: po } = await client
      .from('purchase_orders')
      .select('*, lines:purchase_order_lines(*)')
      .eq('id', bill.po_id)
      .single();

    const poLines = po?.lines || [];

    // 3. Check for Linked Goods Receipt (or any GRN for this PO)
    let grnId = bill.goods_receipt_id;
    if (!grnId) {
      const { data: grns } = await client
        .from('goods_receipts')
        .select('id')
        .eq('po_id', bill.po_id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (grns && grns.length > 0) {
        grnId = grns[0].id;
      }
    }

    if (!grnId) {
      await client
        .from('supplier_bills')
        .update({
          matching_status: 'missing_receipt',
          matching_variance: [{ issue: 'No Goods Receipt found for Purchase Order' }],
          matched_at: now,
          matched_by: userId || null,
        })
        .eq('id', bill.id);

      return {
        billId: bill.id,
        matchingStatus: 'missing_receipt',
        priceTolerancePercent: priceTol.toNumber(),
        quantityTolerancePercent: qtyTol.toNumber(),
        variances: [{ issue: 'No Goods Receipt found for Purchase Order' }],
        lines: [],
        matchedAt: now,
        matchedBy: userId,
      };
    }

    // Fetch GRN lines (including accepted_quantity)
    const { data: grnLines } = await client
      .from('goods_receipt_lines')
      .select('*')
      .eq('receipt_id', grnId);

    // 4. Compare Lines: Bill Lines vs PO Lines vs GRN Lines
    const billLines = bill.lines || [];
    const lineComparisons: MatchingLineComparison[] = [];
    const variances: any[] = [];
    let hasPriceVariance = false;
    let hasQtyVariance = false;
    let hasException = false;

    for (const bLine of billLines) {
      // Find corresponding PO line
      const matchedPoLine = poLines.find(
        (pl: any) =>
          (bLine.item_id && pl.item_id === bLine.item_id) ||
          pl.id === bLine.po_line_id ||
          pl.description === bLine.description
      );

      if (!matchedPoLine) {
        hasException = true;
        const varObj = {
          bill_line_id: bLine.id,
          issue: 'Item not in Purchase Order',
          item_id: bLine.item_id,
        };
        variances.push(varObj);
        lineComparisons.push({
          billLineId: bLine.id,
          itemId: bLine.item_id,
          description: bLine.description,
          billedQuantity: Number(bLine.quantity),
          receivedQuantity: 0,
          poQuantity: 0,
          billedUnitPrice: Number(bLine.unit_price),
          poUnitPrice: 0,
          priceVariancePercent: 100,
          quantityVariancePercent: 100,
          status: 'exception',
          notes: 'Item not found in PO',
        });
        continue;
      }

      // Sum accepted quantity from GRN lines for this PO line
      const acceptedGrnQty = (grnLines || [])
        .filter((gl: any) => gl.po_line_id === matchedPoLine.id || gl.item_id === matchedPoLine.item_id)
        .reduce((sum: Decimal, gl: any) => {
          const acc = gl.accepted_quantity !== undefined ? gl.accepted_quantity : gl.received_quantity;
          return sum.plus(new Decimal(acc || 0));
        }, new Decimal(0));

      const billedQtyDec = new Decimal(bLine.quantity || 0);
      const poPriceDec = new Decimal(matchedPoLine.unit_price || 0);
      const billedPriceDec = new Decimal(bLine.unit_price || 0);

      // Quantity variance calculation
      let qtyDiffPct = new Decimal(0);
      let lineQtyVariance = false;
      if (acceptedGrnQty.greaterThan(0)) {
        const qtyDiff = billedQtyDec.minus(acceptedGrnQty).abs();
        qtyDiffPct = qtyDiff.dividedBy(acceptedGrnQty).times(100);
        if (qtyDiffPct.greaterThan(qtyTol)) {
          lineQtyVariance = true;
          hasQtyVariance = true;
          variances.push({
            bill_line_id: bLine.id,
            issue: 'Quantity variance',
            billed_qty: billedQtyDec.toNumber(),
            received_qty: acceptedGrnQty.toNumber(),
            diff_pct: qtyDiffPct.toDecimalPlaces(2).toNumber(),
          });
        }
      } else if (billedQtyDec.greaterThan(0)) {
        lineQtyVariance = true;
        hasQtyVariance = true;
        variances.push({
          bill_line_id: bLine.id,
          issue: 'Quantity variance (zero accepted GRN qty)',
          billed_qty: billedQtyDec.toNumber(),
          received_qty: 0,
          diff_pct: 100,
        });
      }

      // Price variance calculation
      let priceDiffPct = new Decimal(0);
      let linePriceVariance = false;
      if (poPriceDec.greaterThan(0)) {
        const priceDiff = billedPriceDec.minus(poPriceDec).abs();
        priceDiffPct = priceDiff.dividedBy(poPriceDec).times(100);
        if (priceDiffPct.greaterThan(priceTol)) {
          linePriceVariance = true;
          hasPriceVariance = true;
          variances.push({
            bill_line_id: bLine.id,
            issue: 'Price variance',
            billed_unit_price: billedPriceDec.toNumber(),
            po_unit_price: poPriceDec.toNumber(),
            diff_pct: priceDiffPct.toDecimalPlaces(2).toNumber(),
          });
        }
      }

      let lineStatus: 'matched' | 'price_variance' | 'quantity_variance' | 'exception' = 'matched';
      if (linePriceVariance && lineQtyVariance) {
        lineStatus = 'exception';
      } else if (linePriceVariance) {
        lineStatus = 'price_variance';
      } else if (lineQtyVariance) {
        lineStatus = 'quantity_variance';
      }

      lineComparisons.push({
        billLineId: bLine.id,
        itemId: bLine.item_id,
        description: bLine.description,
        billedQuantity: billedQtyDec.toNumber(),
        receivedQuantity: acceptedGrnQty.toNumber(),
        poQuantity: Number(matchedPoLine.quantity || 0),
        billedUnitPrice: billedPriceDec.toNumber(),
        poUnitPrice: poPriceDec.toNumber(),
        priceVariancePercent: priceDiffPct.toDecimalPlaces(2).toNumber(),
        quantityVariancePercent: qtyDiffPct.toDecimalPlaces(2).toNumber(),
        status: lineStatus,
      });
    }

    // 5. Determine Overall Matching Status
    let overallStatus: 'matched' | 'price_variance' | 'quantity_variance' | 'exception' = 'matched';
    if (hasException || (hasPriceVariance && hasQtyVariance)) {
      overallStatus = 'exception';
    } else if (hasPriceVariance) {
      overallStatus = 'price_variance';
    } else if (hasQtyVariance) {
      overallStatus = 'quantity_variance';
    } else {
      overallStatus = 'matched';
    }

    // 6. Update Supplier Bill in Database
    const { error: updateErr } = await client
      .from('supplier_bills')
      .update({
        matching_status: overallStatus,
        matching_variance: variances,
        matched_at: now,
        matched_by: userId || null,
        goods_receipt_id: grnId,
      })
      .eq('id', bill.id);

    if (updateErr) {
      throw new Error(`Failed to update bill matching status: ${updateErr.message}`);
    }

    // 7. Dispatch Domain Event
    await EventDispatcherService.publishEvent(client, {
      companyId: bill.company_id,
      eventType: overallStatus === 'matched' ? 'BILL_MATCHED' : 'BILL_MATCH_EXCEPTION',
      entityType: 'supplier_bill',
      entityId: bill.id,
      actorId: userId,
      payload: {
        billId: bill.id,
        supplierId: bill.supplier_id,
        poId: bill.po_id,
        goodsReceiptId: grnId,
        matchingStatus: overallStatus,
        variancesCount: variances.length,
      },
    }).catch(() => {
      // non-fatal
    });

    return {
      billId: bill.id,
      matchingStatus: overallStatus,
      priceTolerancePercent: priceTol.toNumber(),
      quantityTolerancePercent: qtyTol.toNumber(),
      variances,
      lines: lineComparisons,
      matchedAt: now,
      matchedBy: userId,
    };
  }

  /**
   * Retrieves full 3-way matching details and audit breakdown for a bill.
   */
  static async getMatchingDetails(client: SupabaseClient, billId: string) {
    const { data: bill, error: bErr } = await client
      .from('supplier_bills')
      .select(`
        *,
        supplier:suppliers(id, name, code),
        po:purchase_orders(id, po_number, order_date, grand_total),
        grn:goods_receipts(id, receipt_number, receipt_date),
        lines:supplier_bill_lines(*)
      `)
      .eq('id', billId)
      .single();

    if (bErr || !bill) {
      throw new Error(`Supplier bill not found: ${bErr?.message || billId}`);
    }

    let poLines = [];
    if (bill.po_id) {
      const { data: pl } = await client
        .from('purchase_order_lines')
        .select('*')
        .eq('po_id', bill.po_id);
      poLines = pl || [];
    }

    let grnLines = [];
    if (bill.goods_receipt_id) {
      const { data: gl } = await client
        .from('goods_receipt_lines')
        .select('*')
        .eq('receipt_id', bill.goods_receipt_id);
      grnLines = gl || [];
    }

    return {
      bill,
      poLines,
      grnLines,
      matchingStatus: bill.matching_status,
      matchingVariance: bill.matching_variance,
      matchedAt: bill.matched_at,
      matchedBy: bill.matched_by,
    };
  }

  /**
   * Manually overrides matching status with authorized justification.
   */
  static async overrideMatchingStatus(
    client: SupabaseClient,
    billId: string,
    overrideStatus: 'matched' | 'exception',
    reason: string,
    userId?: string
  ) {
    if (!reason || reason.trim().length === 0) {
      throw new Error('An explicit justification reason is required for manual matching override');
    }

    const { data: bill, error: bErr } = await client
      .from('supplier_bills')
      .select('id, matching_status, matching_variance')
      .eq('id', billId)
      .single();

    if (bErr || !bill) {
      throw new Error(`Supplier bill not found: ${bErr?.message || billId}`);
    }

    const currentVariances = Array.isArray(bill.matching_variance) ? bill.matching_variance : [];
    const updatedVariances = [
      ...currentVariances,
      {
        override: true,
        overridden_by: userId || null,
        overridden_at: new Date().toISOString(),
        previous_status: bill.matching_status,
        new_status: overrideStatus,
        reason: reason.trim(),
      },
    ];

    const { data: updated, error: uErr } = await client
      .from('supplier_bills')
      .update({
        matching_status: overrideStatus,
        matching_variance: updatedVariances,
        matched_at: new Date().toISOString(),
        matched_by: userId || null,
      })
      .eq('id', billId)
      .select()
      .single();

    if (uErr) {
      throw new Error(`Failed to override matching status: ${uErr.message}`);
    }

    return updated;
  }
}

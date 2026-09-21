import { Decimal, DecimalLike } from '../lib/decimal.js';
import { TaxCalculationService, TaxBreakdownResult } from './tax.service.js';

export interface InvoiceLineInput {
  lineType?: 'service' | 'part' | 'material' | 'labour';
  itemId?: string | null;
  description: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  discountAmount?: DecimalLike;
  taxRate?: DecimalLike;
  isInclusive?: boolean;
  isExempt?: boolean;
  quotationLineId?: string | null;
  workOrderLineId?: string | null;
  jobMaterialMovementId?: string | null;
  hsnSacCode?: string | null;
}

export interface CalculatedInvoiceLine {
  lineType: string;
  itemId?: string | null;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxRate: number;
  taxAmount: Decimal;
  lineTotal: Decimal;
  quotationLineId?: string | null;
  workOrderLineId?: string | null;
  jobMaterialMovementId?: string | null;
  cgstRate: number;
  cgstAmount: Decimal;
  sgstRate: number;
  sgstAmount: Decimal;
  igstRate: number;
  igstAmount: Decimal;
  hsnSacCode?: string | null;
}

export interface InvoiceCalculationOptions {
  lines: InvoiceLineInput[];
  discountAmount?: DecimalLike;
  additionalCharges?: DecimalLike;
  roundingAdjustment?: DecimalLike;
  amountPaid?: DecimalLike;
  amountCredited?: DecimalLike;
  supplierState?: string | null;
  customerState?: string | null;
}

export interface CalculatedInvoice {
  lines: CalculatedInvoiceLine[];
  subtotal: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  additionalCharges: Decimal;
  roundingAdjustment: Decimal;
  grandTotal: Decimal;
  amountPaid: Decimal;
  amountCredited: Decimal;
  balanceDue: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
}

export class InvoiceCalculationService {
  /**
   * Recalculates all invoice lines and header totals with arbitrary-precision Decimal arithmetic.
   */
  static calculate(options: InvoiceCalculationOptions): CalculatedInvoice {
    if (!options.lines || options.lines.length === 0) {
      throw new Error('Invoice must contain at least one billable line item');
    }

    let sumSubtotal = Decimal.zero();
    let sumLineDiscount = Decimal.zero();
    let sumTaxable = Decimal.zero();
    let sumTax = Decimal.zero();
    let sumCgst = Decimal.zero();
    let sumSgst = Decimal.zero();
    let sumIgst = Decimal.zero();

    const calculatedLines: CalculatedInvoiceLine[] = options.lines.map((line) => {
      const qty = new Decimal(line.quantity).round(4);
      const price = new Decimal(line.unitPrice).round(3);

      if (qty.isNegative() || qty.isZero()) {
        throw new Error(`Invoice line quantity must be positive: ${qty.toFixed(4)}`);
      }
      if (price.isNegative()) {
        throw new Error(`Invoice line unit price cannot be negative: ${price.toFixed(3)}`);
      }

      const lineSubtotal = qty.times(price).round(3);
      const lineDisc = new Decimal(line.discountAmount || 0).round(3);

      if (lineDisc.greaterThan(lineSubtotal)) {
        throw new Error(`Discount ${lineDisc.toFixed(3)} exceeds line subtotal ${lineSubtotal.toFixed(3)}`);
      }

      const lineTaxable = lineSubtotal.minus(lineDisc).round(3);

      const taxResult: TaxBreakdownResult = TaxCalculationService.calculateIndiaGst({
        amount: lineTaxable,
        taxRate: line.taxRate,
        supplierState: options.supplierState,
        customerState: options.customerState,
        isInclusive: line.isInclusive,
        isExempt: line.isExempt,
      });

      const lineTotal = lineTaxable.plus(taxResult.taxAmount).round(3);

      sumSubtotal = sumSubtotal.plus(lineSubtotal);
      sumLineDiscount = sumLineDiscount.plus(lineDisc);
      sumTaxable = sumTaxable.plus(lineTaxable);
      sumTax = sumTax.plus(taxResult.taxAmount);
      sumCgst = sumCgst.plus(taxResult.cgstAmount);
      sumSgst = sumSgst.plus(taxResult.sgstAmount);
      sumIgst = sumIgst.plus(taxResult.igstAmount);

      return {
        lineType: line.lineType || 'service',
        itemId: line.itemId || null,
        description: line.description,
        quantity: qty,
        unitPrice: price,
        discountAmount: lineDisc,
        taxableAmount: lineTaxable,
        taxRate: taxResult.taxRate,
        taxAmount: taxResult.taxAmount,
        lineTotal,
        quotationLineId: line.quotationLineId || null,
        workOrderLineId: line.workOrderLineId || null,
        jobMaterialMovementId: line.jobMaterialMovementId || null,
        cgstRate: taxResult.cgstRate,
        cgstAmount: taxResult.cgstAmount,
        sgstRate: taxResult.sgstRate,
        sgstAmount: taxResult.sgstAmount,
        igstRate: taxResult.igstRate,
        igstAmount: taxResult.igstAmount,
        hsnSacCode: line.hsnSacCode || null,
      };
    });

    const headerDiscount = new Decimal(options.discountAmount || 0).round(3);
    const finalTaxable = sumTaxable.minus(headerDiscount).round(3);
    const addCharges = new Decimal(options.additionalCharges || 0).round(3);
    const roundingAdj = new Decimal(options.roundingAdjustment || 0).round(3);

    const grandTotal = finalTaxable.plus(sumTax).plus(addCharges).plus(roundingAdj).round(3);

    if (grandTotal.isNegative()) {
      throw new Error(`Invoice grand total cannot be negative: ${grandTotal.toFixed(3)}`);
    }

    const paid = new Decimal(options.amountPaid || 0).round(3);
    const credited = new Decimal(options.amountCredited || 0).round(3);

    if (paid.plus(credited).greaterThan(grandTotal)) {
      throw new Error(
        `Total paid and credited (${paid.plus(credited).toFixed(3)}) cannot exceed grand total (${grandTotal.toFixed(3)})`
      );
    }

    const balanceDue = grandTotal.minus(paid).minus(credited).round(3);

    return {
      lines: calculatedLines,
      subtotal: sumSubtotal.round(3),
      discountAmount: sumLineDiscount.plus(headerDiscount).round(3),
      taxableAmount: finalTaxable.round(3),
      taxAmount: sumTax.round(3),
      additionalCharges: addCharges.round(3),
      roundingAdjustment: roundingAdj.round(3),
      grandTotal: grandTotal.round(3),
      amountPaid: paid.round(3),
      amountCredited: credited.round(3),
      balanceDue: balanceDue.round(3),
      cgstTotal: sumCgst.round(3),
      sgstTotal: sumSgst.round(3),
      igstTotal: sumIgst.round(3),
    };
  }
}

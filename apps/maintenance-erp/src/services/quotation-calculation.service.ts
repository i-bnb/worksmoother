import { Decimal, DecimalLike } from '../lib/decimal.js';
import { TaxCalculationService, TaxBreakdownResult } from './tax.service.js';

export interface QuotationLineInput {
  lineType?: 'service' | 'part' | 'material' | 'labour';
  itemId?: string | null;
  description: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  discountPercent?: DecimalLike;
  discountAmount?: DecimalLike;
  taxRate?: DecimalLike;
  isInclusive?: boolean;
  isExempt?: boolean;
  hsnSacCode?: string | null;
}

export interface CalculatedQuotationLine {
  lineType: string;
  itemId?: string | null;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  discountPercent: number;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxRate: number;
  taxAmount: Decimal;
  lineTotal: Decimal;
  cgstRate: number;
  cgstAmount: Decimal;
  sgstRate: number;
  sgstAmount: Decimal;
  igstRate: number;
  igstAmount: Decimal;
  hsnSacCode?: string | null;
}

export interface QuotationCalculationOptions {
  lines: QuotationLineInput[];
  headerDiscountPercent?: DecimalLike;
  headerDiscountAmount?: DecimalLike;
  additionalCharges?: DecimalLike;
  supplierState?: string | null;
  customerState?: string | null;
}

export interface CalculatedQuotation {
  lines: CalculatedQuotationLine[];
  subtotal: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  additionalCharges: Decimal;
  grandTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
}

export class QuotationCalculationService {
  /**
   * Recalculates all quotation lines and header totals with arbitrary-precision Decimal arithmetic.
   */
  static calculate(options: QuotationCalculationOptions): CalculatedQuotation {
    if (!options.lines || options.lines.length === 0) {
      throw new Error('Quotation must contain at least one line item');
    }

    let sumSubtotal = Decimal.zero();
    let sumLineDiscount = Decimal.zero();
    let sumTaxable = Decimal.zero();
    let sumTax = Decimal.zero();
    let sumCgst = Decimal.zero();
    let sumSgst = Decimal.zero();
    let sumIgst = Decimal.zero();

    const calculatedLines: CalculatedQuotationLine[] = options.lines.map((line) => {
      const qty = new Decimal(line.quantity).round(4);
      const price = new Decimal(line.unitPrice).round(3);

      if (qty.isNegative() || qty.isZero()) {
        throw new Error(`Quantity must be strictly positive: ${qty.toFixed(4)}`);
      }
      if (price.isNegative()) {
        throw new Error(`Unit price cannot be negative: ${price.toFixed(3)}`);
      }

      const lineSubtotal = qty.times(price).round(3);

      // Line discount calculation
      let lineDiscAmount = Decimal.zero();
      let discPercent = 0;

      if (line.discountAmount !== undefined && Number(line.discountAmount) > 0) {
        lineDiscAmount = new Decimal(line.discountAmount).round(3);
        if (lineSubtotal.greaterThan(0)) {
          discPercent = lineDiscAmount.dividedBy(lineSubtotal).times(100).toNumber();
        }
      } else if (line.discountPercent !== undefined && Number(line.discountPercent) > 0) {
        discPercent = Number(line.discountPercent);
        if (discPercent > 100) {
          throw new Error(`Discount percent cannot exceed 100%: ${discPercent}`);
        }
        lineDiscAmount = lineSubtotal.times(new Decimal(discPercent).dividedBy(100)).round(3);
      }

      if (lineDiscAmount.greaterThan(lineSubtotal)) {
        throw new Error(`Discount ${lineDiscAmount.toFixed(3)} cannot exceed line subtotal ${lineSubtotal.toFixed(3)}`);
      }

      const lineTaxable = lineSubtotal.minus(lineDiscAmount).round(3);

      // Tax determination via TaxCalculationService
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
      sumLineDiscount = sumLineDiscount.plus(lineDiscAmount);
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
        discountPercent: discPercent,
        discountAmount: lineDiscAmount,
        taxableAmount: lineTaxable,
        taxRate: taxResult.taxRate,
        taxAmount: taxResult.taxAmount,
        lineTotal,
        cgstRate: taxResult.cgstRate,
        cgstAmount: taxResult.cgstAmount,
        sgstRate: taxResult.sgstRate,
        sgstAmount: taxResult.sgstAmount,
        igstRate: taxResult.igstRate,
        igstAmount: taxResult.igstAmount,
        hsnSacCode: line.hsnSacCode || null,
      };
    });

    // Header level discounts and charges
    let headerDiscount = Decimal.zero();
    if (options.headerDiscountAmount !== undefined && Number(options.headerDiscountAmount) > 0) {
      headerDiscount = new Decimal(options.headerDiscountAmount).round(3);
    } else if (options.headerDiscountPercent !== undefined && Number(options.headerDiscountPercent) > 0) {
      const hPercent = new Decimal(options.headerDiscountPercent);
      headerDiscount = sumSubtotal.times(hPercent.dividedBy(100)).round(3);
    }

    const totalDiscount = sumLineDiscount.plus(headerDiscount).round(3);
    const finalTaxable = sumTaxable.minus(headerDiscount).round(3);
    const addCharges = new Decimal(options.additionalCharges || 0).round(3);

    const grandTotal = finalTaxable.plus(sumTax).plus(addCharges).round(3);

    if (grandTotal.isNegative()) {
      throw new Error(`Quotation grand total cannot be negative: ${grandTotal.toFixed(3)}`);
    }

    return {
      lines: calculatedLines,
      subtotal: sumSubtotal.round(3),
      discountAmount: totalDiscount.round(3),
      taxableAmount: finalTaxable.round(3),
      taxAmount: sumTax.round(3),
      additionalCharges: addCharges.round(3),
      grandTotal: grandTotal.round(3),
      cgstTotal: sumCgst.round(3),
      sgstTotal: sumSgst.round(3),
      igstTotal: sumIgst.round(3),
    };
  }
}

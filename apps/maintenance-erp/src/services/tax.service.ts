import { Decimal, DecimalLike } from '../lib/decimal.js';

export interface TaxCalculationParams {
  amount: DecimalLike;
  taxRate?: DecimalLike; // Standard GST percentage e.g. 18.0
  supplierState?: string | null;
  customerState?: string | null;
  isInclusive?: boolean;
  isExempt?: boolean;
}

export interface TaxBreakdownResult {
  taxableAmount: Decimal;
  taxAmount: Decimal;
  grossAmount: Decimal;
  taxRate: number;
  cgstRate: number;
  cgstAmount: Decimal;
  sgstRate: number;
  sgstAmount: Decimal;
  igstRate: number;
  igstAmount: Decimal;
  isIntraState: boolean;
  isExempt: boolean;
}

export class TaxCalculationService {
  /**
   * Determine India GST taxes (CGST, SGST, IGST) based on Place of Supply (POS).
   */
  static calculateIndiaGst(params: TaxCalculationParams): TaxBreakdownResult {
    const amt = new Decimal(params.amount).round(3);
    const isExempt = Boolean(params.isExempt);
    const isInclusive = Boolean(params.isInclusive);
    const rateNum = isExempt ? 0 : (params.taxRate !== undefined ? Number(params.taxRate) : 18.0);
    const rateDec = new Decimal(rateNum);

    if (isExempt || rateNum === 0) {
      return {
        taxableAmount: amt,
        taxAmount: Decimal.zero(),
        grossAmount: amt,
        taxRate: 0,
        cgstRate: 0,
        cgstAmount: Decimal.zero(),
        sgstRate: 0,
        sgstAmount: Decimal.zero(),
        igstRate: 0,
        igstAmount: Decimal.zero(),
        isIntraState: false,
        isExempt: true,
      };
    }

    let taxable: Decimal;
    let totalTax: Decimal;

    if (isInclusive) {
      // Amount includes tax: Taxable = Amount / (1 + Rate / 100)
      const divisor = new Decimal(1).plus(rateDec.dividedBy(100));
      taxable = amt.dividedBy(divisor).round(3);
      totalTax = amt.minus(taxable).round(3);
    } else {
      // Amount excludes tax: Tax = Amount * (Rate / 100)
      taxable = amt;
      totalTax = amt.times(rateDec.dividedBy(100)).round(3);
    }

    // Determine Intra-state vs Inter-state
    const supState = (params.supplierState || '').trim().toLowerCase();
    const custState = (params.customerState || '').trim().toLowerCase();
    const isIntraState = Boolean(supState && custState && supState === custState);

    if (isIntraState) {
      // Split evenly into CGST and SGST
      const halfRate = rateNum / 2;
      const cgstAmt = totalTax.dividedBy(2).round(3);
      const sgstAmt = totalTax.minus(cgstAmt).round(3); // ensures exact sum

      return {
        taxableAmount: taxable,
        taxAmount: totalTax,
        grossAmount: taxable.plus(totalTax).round(3),
        taxRate: rateNum,
        cgstRate: halfRate,
        cgstAmount: cgstAmt,
        sgstRate: halfRate,
        sgstAmount: sgstAmt,
        igstRate: 0,
        igstAmount: Decimal.zero(),
        isIntraState: true,
        isExempt: false,
      };
    } else {
      // Inter-state: full rate applied as IGST
      return {
        taxableAmount: taxable,
        taxAmount: totalTax,
        grossAmount: taxable.plus(totalTax).round(3),
        taxRate: rateNum,
        cgstRate: 0,
        cgstAmount: Decimal.zero(),
        sgstRate: 0,
        sgstAmount: Decimal.zero(),
        igstRate: rateNum,
        igstAmount: totalTax,
        isIntraState: false,
        isExempt: false,
      };
    }
  }
}

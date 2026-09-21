/**
 * =============================================================================
 * Unit & Domain Test: Monetary Decimal Precision & India GST Tax Engine
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Customer Payments
 * =============================================================================
 * Verifies:
 *   1. Arbitrary-precision Decimal arithmetic avoids IEEE-754 floating point drift
 *   2. India GST calculation correctly determines intra-state (CGST + SGST) vs inter-state (IGST)
 *   3. Tax-exempt items and zero-tax transactions are handled without error
 *   4. QuotationCalculationService validates inputs and computes exact header/line totals
 *   5. Negative quantities, negative prices, and excessive discounts are rejected
 *   6. InvoiceCalculationService maintains the fundamental balanceDue invariant
 */

import { describe, it, expect } from 'vitest';
import { Decimal } from '../../src/lib/decimal.js';
import { TaxCalculationService } from '../../src/services/tax.service.js';
import { QuotationCalculationService } from '../../src/services/quotation-calculation.service.js';
import { InvoiceCalculationService } from '../../src/services/invoice-calculation.service.js';

describe('Phase 2B: Monetary Decimal Precision & India GST Engine', () => {
  describe('Arbitrary-Precision Decimal Operations', () => {
    it('avoids classic IEEE 754 floating-point inaccuracies (0.1 + 0.2 === 0.3)', () => {
      const a = new Decimal('0.1');
      const b = new Decimal('0.2');
      const sum = a.plus(b);

      expect(sum.toFixed(3)).toBe('0.300');
      expect(sum.toNumber()).toBe(0.3);
      expect(0.1 + 0.2).not.toBe(0.3); // Proves native floats fail this test
    });

    it('performs precise multiplication and half-up financial rounding', () => {
      // 12.345 * 2.5 = 30.8625 -> rounded to 3 decimals = 30.863
      const price = new Decimal('12.345');
      const qty = new Decimal('2.5');
      const total = price.times(qty).round(3);

      expect(total.toFixed(3)).toBe('30.863');
    });

    it('handles division by zero with safe error', () => {
      const a = new Decimal('100.000');
      expect(() => a.dividedBy(0)).toThrow('Division by zero');
    });
  });

  describe('India GST Calculation Engine', () => {
    it('computes intra-state GST (CGST + SGST) when supplier and customer states match', () => {
      // Taxable: 10,000 INR, 18% GST in Maharashtra -> CGST 9% (900), SGST 9% (900), IGST 0
      const result = TaxCalculationService.calculateIndiaGst({
        amount: 10000,
        taxRate: 18.0,
        supplierState: 'Maharashtra',
        customerState: 'Maharashtra',
      });

      expect(result.isIntraState).toBe(true);
      expect(result.isExempt).toBe(false);
      expect(result.taxRate).toBe(18.0);
      expect(result.cgstRate).toBe(9.0);
      expect(result.sgstRate).toBe(9.0);
      expect(result.igstRate).toBe(0.0);
      expect(result.cgstAmount.toFixed(3)).toBe('900.000');
      expect(result.sgstAmount.toFixed(3)).toBe('900.000');
      expect(result.igstAmount.toFixed(3)).toBe('0.000');
      expect(result.taxAmount.toFixed(3)).toBe('1800.000');
      expect(result.grossAmount.toFixed(3)).toBe('11800.000');
    });

    it('computes inter-state GST (IGST) when supplier and customer states differ', () => {
      // Supplier in Karnataka, Customer in Tamil Nadu -> IGST 18% (1800)
      const result = TaxCalculationService.calculateIndiaGst({
        amount: 10000,
        taxRate: 18.0,
        supplierState: 'Karnataka',
        customerState: 'Tamil Nadu',
      });

      expect(result.isIntraState).toBe(false);
      expect(result.cgstRate).toBe(0);
      expect(result.sgstRate).toBe(0);
      expect(result.igstRate).toBe(18.0);
      expect(result.cgstAmount.toFixed(3)).toBe('0.000');
      expect(result.sgstAmount.toFixed(3)).toBe('0.000');
      expect(result.igstAmount.toFixed(3)).toBe('1800.000');
      expect(result.taxAmount.toFixed(3)).toBe('1800.000');
      expect(result.grossAmount.toFixed(3)).toBe('11800.000');
    });

    it('handles tax-exempt transactions with zero tax liability', () => {
      const result = TaxCalculationService.calculateIndiaGst({
        amount: 5000,
        taxRate: 18.0,
        supplierState: 'Delhi',
        customerState: 'Delhi',
        isExempt: true,
      });

      expect(result.isExempt).toBe(true);
      expect(result.taxAmount.toFixed(3)).toBe('0.000');
      expect(result.grossAmount.toFixed(3)).toBe('5000.000');
    });

    it('handles tax-inclusive calculations correctly', () => {
      // Gross amount: 11,800 INR with 18% inclusive tax -> Taxable: 10,000, Tax: 1,800
      const result = TaxCalculationService.calculateIndiaGst({
        amount: 11800,
        taxRate: 18.0,
        supplierState: 'Gujarat',
        customerState: 'Gujarat',
        isInclusive: true,
      });

      expect(result.taxableAmount.toFixed(3)).toBe('10000.000');
      expect(result.taxAmount.toFixed(3)).toBe('1800.000');
      expect(result.cgstAmount.toFixed(3)).toBe('900.000');
      expect(result.sgstAmount.toFixed(3)).toBe('900.000');
    });
  });

  describe('QuotationCalculationService', () => {
    it('calculates complex multi-line quotation with mixed lines, discounts, and charges', () => {
      const calc = QuotationCalculationService.calculate({
        supplierState: 'Maharashtra',
        customerState: 'Maharashtra',
        lines: [
          {
            lineType: 'service',
            description: 'Annual Chiller Overhaul Labor',
            quantity: 1,
            unitPrice: 5000,
            discountPercent: 10, // 5000 - 500 = 4500. 18% GST = 810 (CGST 405, SGST 405). Total = 5310
            taxRate: 18.0,
          },
          {
            lineType: 'part',
            description: 'Compressor Valve Gasket Set',
            quantity: 2,
            unitPrice: 1500, // 3000. 18% GST = 540 (CGST 270, SGST 270). Total = 3540
            taxRate: 18.0,
          },
        ],
        additionalCharges: 250, // Transport fee
      });

      expect(calc.subtotal.toFixed(3)).toBe('8000.000');
      expect(calc.discountAmount.toFixed(3)).toBe('500.000');
      expect(calc.taxableAmount.toFixed(3)).toBe('7500.000');
      expect(calc.taxAmount.toFixed(3)).toBe('1350.000');
      expect(calc.cgstTotal.toFixed(3)).toBe('675.000');
      expect(calc.sgstTotal.toFixed(3)).toBe('675.000');
      expect(calc.igstTotal.toFixed(3)).toBe('0.000');
      expect(calc.additionalCharges.toFixed(3)).toBe('250.000');
      expect(calc.grandTotal.toFixed(3)).toBe('9100.000');
    });

    it('rejects empty quotation lines', () => {
      expect(() => QuotationCalculationService.calculate({ lines: [] })).toThrow(
        'Quotation must contain at least one line item'
      );
    });

    it('rejects negative or zero line quantities', () => {
      expect(() =>
        QuotationCalculationService.calculate({
          lines: [
            {
              description: 'Service',
              quantity: 0,
              unitPrice: 100,
            },
          ],
        })
      ).toThrow('Quantity must be strictly positive');
    });

    it('rejects negative line unit prices', () => {
      expect(() =>
        QuotationCalculationService.calculate({
          lines: [
            {
              description: 'Service',
              quantity: 1,
              unitPrice: -50,
            },
          ],
        })
      ).toThrow('Unit price cannot be negative');
    });

    it('rejects discount percentages greater than 100%', () => {
      expect(() =>
        QuotationCalculationService.calculate({
          lines: [
            {
              description: 'Service',
              quantity: 1,
              unitPrice: 100,
              discountPercent: 120,
            },
          ],
        })
      ).toThrow('Discount percent cannot exceed 100%');
    });
  });

  describe('InvoiceCalculationService', () => {
    it('calculates invoice totals, partial payments, and live balance due', () => {
      const calc = InvoiceCalculationService.calculate({
        supplierState: 'Karnataka',
        customerState: 'Karnataka',
        lines: [
          {
            description: 'Emergency Electrical Repair',
            quantity: 3,
            unitPrice: 2000, // 6000. 18% GST = 1080. Total = 7080
            taxRate: 18.0,
          },
        ],
        amountPaid: 3000,
        amountCredited: 500,
      });

      expect(calc.grandTotal.toFixed(3)).toBe('7080.000');
      expect(calc.amountPaid.toFixed(3)).toBe('3000.000');
      expect(calc.amountCredited.toFixed(3)).toBe('500.000');
      // Balance = 7080 - 3000 - 500 = 3580
      expect(calc.balanceDue.toFixed(3)).toBe('3580.000');
    });

    it('rejects overpayments where amountPaid + amountCredited exceeds grandTotal', () => {
      expect(() =>
        InvoiceCalculationService.calculate({
          lines: [
            {
              description: 'HVAC Filter',
              quantity: 1,
              unitPrice: 1000,
              taxRate: 0,
            },
          ],
          amountPaid: 1200,
        })
      ).toThrow('cannot exceed grand total');
    });
  });
});

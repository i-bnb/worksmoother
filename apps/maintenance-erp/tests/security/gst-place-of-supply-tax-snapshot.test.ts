/**
 * =============================================================================
 * Phase 11 - Test Suite 9: GST Place of Supply & Immutable Tax Snapshot
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { TaxProfileService } from '../../src/services/tax-profile.service.js';
import {
  validateTaxProfileCreate,
  extractPanFromGstin,
} from '../../src/schemas/tax-profile.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 11: GST Place of Supply & Tax Snapshot', () => {
  const VALID_MAHARASHTRA_GSTIN = '27ABCDE1234F1Z5';
  const VALID_KARNATAKA_GSTIN = '29ABCDE1234F1Z3';

  it('validates 15-character Indian GSTIN and extracts PAN correctly', () => {
    const pan = extractPanFromGstin(VALID_MAHARASHTRA_GSTIN);
    expect(pan).toBe('ABCDE1234F');

    // Invalid format test
    expect(() =>
      validateTaxProfileCreate({
        companyId: DEMO_COMPANY_A,
        entityType: 'customer',
        entityId: 'cust-gst-1',
        legalName: 'Test Corp',
        gstin: 'INVALID_GSTIN_123',
        stateCode: '27',
      })
    ).toThrow('Invalid GSTIN format');

    // State code mismatch test
    expect(() =>
      validateTaxProfileCreate({
        companyId: DEMO_COMPANY_A,
        entityType: 'customer',
        entityId: 'cust-gst-2',
        legalName: 'Test Corp',
        gstin: VALID_MAHARASHTRA_GSTIN, // State prefix 27
        stateCode: '29',                 // Supplied 29
      })
    ).toThrow('does not match GSTIN state prefix');
  });

  it('resolves intra-state supply with 50/50 CGST and SGST split', () => {
    const result = TaxProfileService.resolvePlaceOfSupply({
      supplierStateCode: '27', // Maharashtra
      customerStateCode: '27', // Maharashtra
      placeOfSupplyStateCode: '27',
      taxableAmount: 10000.0,
      gstRate: 18.0,
    });

    expect(result.taxType).toBe('INTRA_STATE');
    expect(result.cgstRate).toBe(9.0);
    expect(result.sgstRate).toBe(9.0);
    expect(result.igstRate).toBe(0.0);
    expect(result.cgstAmount).toBe(900.0);
    expect(result.sgstAmount).toBe(900.0);
    expect(result.igstAmount).toBe(0.0);
    expect(result.totalTax).toBe(1800.0);
    expect(result.grandTotal).toBe(11800.0);
  });

  it('resolves inter-state supply with 100% IGST', () => {
    const result = TaxProfileService.resolvePlaceOfSupply({
      supplierStateCode: '27', // Maharashtra
      customerStateCode: '29', // Karnataka
      placeOfSupplyStateCode: '29',
      taxableAmount: 20000.0,
      gstRate: 18.0,
    });

    expect(result.taxType).toBe('INTER_STATE');
    expect(result.cgstRate).toBe(0.0);
    expect(result.sgstRate).toBe(0.0);
    expect(result.igstRate).toBe(18.0);
    expect(result.cgstAmount).toBe(0.0);
    expect(result.sgstAmount).toBe(0.0);
    expect(result.igstAmount).toBe(3600.0);
    expect(result.totalTax).toBe(3600.0);
    expect(result.grandTotal).toBe(23600.0);
  });

  it('resolves export supply as zero-rated', () => {
    const result = TaxProfileService.resolvePlaceOfSupply({
      supplierStateCode: '27',
      customerStateCode: '97',
      isExport: true,
      taxableAmount: 50000.0,
      gstRate: 18.0,
    });

    expect(result.taxType).toBe('EXPORT');
    expect(result.totalTax).toBe(0.0);
    expect(result.grandTotal).toBe(50000.0);
  });

  it('generates immutable tax snapshot with audit metadata', () => {
    const snapshot = TaxProfileService.generateTaxSnapshot({
      supplier: {
        gstin: VALID_MAHARASHTRA_GSTIN,
        stateCode: '27',
        legalName: 'Doctor Care Services Pvt Ltd',
      },
      recipient: {
        gstin: VALID_KARNATAKA_GSTIN,
        stateCode: '29',
        legalName: 'Bengaluru Medical Center',
        registrationType: 'regular',
      },
      taxableAmount: 100000.0,
      gstRate: 18.0,
    });

    expect(snapshot.version).toBe('1.0');
    expect(snapshot.taxType).toBe('INTER_STATE');
    expect(snapshot.supplier.stateName).toBe('Maharashtra');
    expect(snapshot.recipient.stateName).toBe('Karnataka');
    expect(snapshot.igstAmount).toBe(18000.0);
    expect(snapshot.totalTax).toBe(18000.0);
    expect(snapshot.grandTotal).toBe(118000.0);
  });
});

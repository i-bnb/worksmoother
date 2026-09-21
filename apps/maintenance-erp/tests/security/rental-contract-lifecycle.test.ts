/**
 * =============================================================================
 * Test Suite 2: Rental Contract Lifecycle & State Machine
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  RentalContractService,
  RentalContractStatus,
} from '../../src/services/rental-contract.service.js';
import { validateRentalContractCreate } from '../../src/schemas/rental-contract.schema.js';

describe('Phase 5: Rental Contract Lifecycle & State Machine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('rental_contracts').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Contract Schema Validation', () => {
    it('accepts valid rental contract creation payload', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        customerId: '11111111-2222-3333-4444-555555555555',
        startDate: '2026-06-01',
        expectedReturnDate: '2026-06-30',
        billingFrequency: 'monthly',
        lines: [
          {
            rentalAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            unitRate: 150.0,
            quantity: 1,
            taxRate: 5.0,
            depositAmount: 1000.0,
          },
        ],
      };

      const validated = validateRentalContractCreate(payload);
      expect(validated.companyId).toBe(DEMO_COMPANY_A);
      expect(validated.lines.length).toBe(1);
      expect(validated.lines[0].unitRate).toBe(150.0);
    });

    it('rejects contract creation with inverted dates (startDate > expectedReturnDate)', () => {
      expect(() =>
        validateRentalContractCreate({
          companyId: DEMO_COMPANY_A,
          customerId: '11111111-2222-3333-4444-555555555555',
          startDate: '2026-06-30',
          expectedReturnDate: '2026-06-01',
          lines: [{ rentalAssetId: 'ast-1', unitRate: 100 }],
        })
      ).toThrow(/startDate must be on or before expectedReturnDate/i);
    });

    it('rejects contract creation without any asset lines', () => {
      expect(() =>
        validateRentalContractCreate({
          companyId: DEMO_COMPANY_A,
          customerId: '11111111-2222-3333-4444-555555555555',
          startDate: '2026-06-01',
          expectedReturnDate: '2026-06-30',
          lines: [],
        })
      ).toThrow(/must have at least one line/i);
    });
  });

  describe('State Machine Transitions', () => {
    it('allows valid progressive lifecycle transitions', () => {
      expect(RentalContractService.validateContractTransition('draft', 'quoted')).toBe(true);
      expect(RentalContractService.validateContractTransition('quoted', 'reserved')).toBe(true);
      expect(RentalContractService.validateContractTransition('reserved', 'active')).toBe(true);
      expect(RentalContractService.validateContractTransition('active', 'extension_requested')).toBe(true);
      expect(RentalContractService.validateContractTransition('extension_requested', 'active')).toBe(true);
      expect(RentalContractService.validateContractTransition('active', 'return_pending')).toBe(true);
      expect(RentalContractService.validateContractTransition('return_pending', 'returned')).toBe(true);
      expect(RentalContractService.validateContractTransition('returned', 'completed')).toBe(true);
    });

    it('rejects invalid or backwards transitions', () => {
      expect(RentalContractService.validateContractTransition('draft', 'completed')).toBe(false);
      expect(RentalContractService.validateContractTransition('completed', 'active')).toBe(false);
      expect(RentalContractService.validateContractTransition('cancelled', 'draft')).toBe(false);
    });
  });

  describe('Contract Totals & Deposit Calculation', () => {
    it('accurately calculates subtotal, tax, and total deposits using Decimal', () => {
      const lines = [
        {
          rentalAssetId: 'ast-1',
          startDate: '2026-06-01',
          endDate: '2026-06-10',
          unitRate: 100.0,
          quantity: 2,
          taxRate: 5.0,
          depositAmount: 500.0,
        },
        {
          rentalAssetId: 'ast-2',
          startDate: '2026-06-01',
          endDate: '2026-06-10',
          unitRate: 350.0,
          quantity: 1,
          taxRate: 5.0,
          depositAmount: 1000.0,
        },
      ];

      const totals = RentalContractService.calculateTotals(lines);
      // line 1: 2 * 100 = 200, tax = 10 -> total 210, dep = 500
      // line 2: 1 * 350 = 350, tax = 17.5 -> total 367.5, dep = 1000
      // subtotal: 550, tax: 27.5, grand: 577.5, deposit: 1500
      expect(totals.subtotal).toBe(550.0);
      expect(totals.taxAmount).toBe(27.5);
      expect(totals.grandTotal).toBe(577.5);
      expect(totals.totalDeposit).toBe(1500.0);
    });
  });
});

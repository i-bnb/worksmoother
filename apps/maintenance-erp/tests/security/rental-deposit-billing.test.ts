/**
 * =============================================================================
 * Test Suite 6: Rental Security Deposits Escrow & Pricing Optimization Billing
 * Maintenance Management ERP — Phase 5 Equipment Rental
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { RentalDepositService } from '../../src/services/rental-deposit.service.js';
import { RentalBillingService } from '../../src/services/rental-billing.service.js';
import { validateRentalDepositAction } from '../../src/schemas/rental-operation.schema.js';

describe('Phase 5: Rental Deposits & Billing Optimization', () => {
  describe('Deposit Escrow Balance Lifecycle', () => {
    it('handles deposit receipt correctly', () => {
      const res = RentalDepositService.calculateDepositBalance(0, 'receipt', 1500.0);
      expect(res.newHeld).toBe(1500.0);
      expect(res.newStatus).toBe('held');
    });

    it('handles partial and full deposit refunds correctly', () => {
      // Partial refund of 500 from 1500 held -> 1000 remaining held
      const partial = RentalDepositService.calculateDepositBalance(1500.0, 'refund', 500.0);
      expect(partial.newHeld).toBe(1000.0);
      expect(partial.newRefundedDelta).toBe(500.0);
      expect(partial.newStatus).toBe('partially_refunded');

      // Full refund of remaining 1000 -> 0 held
      const full = RentalDepositService.calculateDepositBalance(1000.0, 'refund', 1000.0);
      expect(full.newHeld).toBe(0.0);
      expect(full.newRefundedDelta).toBe(1000.0);
      expect(full.newStatus).toBe('fully_refunded');
    });

    it('handles damage deduction and rent adjustments against held deposit', () => {
      const res = RentalDepositService.calculateDepositBalance(2000.0, 'damage_deduction', 800.0);
      expect(res.newHeld).toBe(1200.0);
      expect(res.newAdjustedDelta).toBe(800.0);
      expect(res.newStatus).toBe('adjusted');
    });

    it('rejects deposit deduction exceeding currently held balance', () => {
      expect(() =>
        RentalDepositService.calculateDepositBalance(500.0, 'refund', 600.0)
      ).toThrow(/exceeds currently held deposit balance/i);

      expect(() =>
        RentalDepositService.calculateDepositBalance(300.0, 'damage_deduction', 500.0)
      ).toThrow(/exceeds currently held deposit balance/i);
    });

    it('validates deposit action payload via schema', () => {
      const payload = {
        contractId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: 'receipt' as const,
        amount: 2500.0,
        paymentMethod: 'bank_transfer',
        paymentReference: 'WIRE-2026-9988',
      };

      const validated = validateRentalDepositAction(payload);
      expect(validated.amount).toBe(2500.0);
      expect(validated.action).toBe('receipt');

      expect(() =>
        validateRentalDepositAction({
          contractId: 'c-1',
          action: 'invalid_action',
          amount: 100,
        })
      ).toThrow(/action must be one of/i);
    });
  });

  describe('Pricing Optimization Engine', () => {
    it('optimizes rate structure choosing weekly when cheaper than daily', () => {
      // 10 days rental
      // Daily: $100/day -> 10 * 100 = $1000
      // Weekly: $450/week -> 1 week ($450) + 3 days ($300) = $750
      // Monthly: $1500/month
      // Optimized should choose weekly ($750)
      const opt = RentalBillingService.calculateOptimalRentalCost(10, 100.0, 450.0, 1500.0);

      expect(opt.dailyCost).toBe(1000.0);
      expect(opt.weeklyCost).toBe(750.0);
      expect(opt.optimizedCost).toBe(750.0);
      expect(opt.bestRateStructure).toBe('weekly');
    });

    it('optimizes rate structure choosing monthly when cheaper than daily and weekly', () => {
      // 28 days rental
      // Daily: $100/day -> 28 * 100 = $2800
      // Weekly: $500/week -> 4 weeks = $2000
      // Monthly: $1600/month
      // Optimized should choose monthly ($1600)
      const opt = RentalBillingService.calculateOptimalRentalCost(28, 100.0, 500.0, 1600.0);

      expect(opt.dailyCost).toBe(2800.0);
      expect(opt.weeklyCost).toBe(2000.0);
      expect(opt.monthlyCost).toBe(1600.0);
      expect(opt.optimizedCost).toBe(1600.0);
      expect(opt.bestRateStructure).toBe('monthly');
    });

    it('chooses daily when duration is short', () => {
      // 3 days rental
      // Daily: $100/day -> $300
      // Weekly: $500/week
      // Monthly: $1500/month
      const opt = RentalBillingService.calculateOptimalRentalCost(3, 100.0, 500.0, 1500.0);

      expect(opt.optimizedCost).toBe(300.0);
      expect(opt.bestRateStructure).toBe('daily');
    });
  });
});

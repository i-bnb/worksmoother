/**
 * =============================================================================
 * Test Suite 8: Customer AMC, Rental & Service Feedback
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerFeedbackService } from '../../src/services/customer-feedback.service.js';
import { CustomerContractsRentalService } from '../../src/services/customer-contracts-rental.service.js';
import {
  validateCustomerFeedbackCreate,
  validateAmcRenewalRequest,
  validateRentalReturnOrExtension,
} from '../../src/schemas/customer-feedback.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 9: Customer AMC, Rental & Service Feedback', () => {
  const CUSTOMER_ID = 'cust-fb-101';
  const WORK_ORDER_ID = 'wo-fb-202';

  describe('Post-Service Feedback Validation & Submission', () => {
    it('validates a complete 5-star rating with sub-ratings and comments', () => {
      const dto = validateCustomerFeedbackCreate({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        workOrderId: WORK_ORDER_ID,
        rating: 5,
        timelinessRating: 5,
        technicianRating: 5,
        qualityRating: 5,
        comments: 'Prompt arrival and excellent fix of chiller noise.',
      });

      expect(dto.rating).toBe(5);
      expect(dto.timelinessRating).toBe(5);
      expect(dto.comments).toBe('Prompt arrival and excellent fix of chiller noise.');
    });

    it('rejects ratings outside 1-5 integer bounds', () => {
      expect(() => {
        validateCustomerFeedbackCreate({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          workOrderId: WORK_ORDER_ID,
          rating: 6,
        });
      }).toThrow(/Rating must be an integer between 1 and 5/);

      expect(() => {
        validateCustomerFeedbackCreate({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          workOrderId: WORK_ORDER_ID,
          rating: 0,
        });
      }).toThrow(/Rating must be an integer between 1 and 5/);
    });

    it('rejects feedback submission if work order is not completed', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'work_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: WORK_ORDER_ID,
                        status: 'in_progress', // Not completed!
                        work_order_number: 'WO-001',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      await expect(
        CustomerFeedbackService.submitFeedback(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          workOrderId: WORK_ORDER_ID,
          rating: 4,
        })
      ).rejects.toThrow(/Feedback can only be submitted for completed work orders/);
    });

    it('enforces one feedback per completed work order', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'work_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: WORK_ORDER_ID,
                        status: 'completed',
                        work_order_number: 'WO-001',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'service_feedback') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'existing-feedback-id' }, // Already exists!
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      await expect(
        CustomerFeedbackService.submitFeedback(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          workOrderId: WORK_ORDER_ID,
          rating: 5,
        })
      ).rejects.toThrow(/Feedback has already been submitted for this work order/);
    });
  });

  describe('AMC Renewal & Rental Self-Service', () => {
    it('validates and submits AMC contract renewal request', () => {
      const renewalDto = validateAmcRenewalRequest({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        contractId: 'amc-1234',
        notes: 'Please renew for another 12 months with same terms',
      });

      expect(renewalDto.contractId).toBe('amc-1234');
      expect(renewalDto.notes).toBe('Please renew for another 12 months with same terms');
    });

    it('validates rental return and extension requests accurately', () => {
      const extendDto = validateRentalReturnOrExtension({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        rentalContractId: 'rc-101',
        action: 'extend',
        requestedEndDate: '2026-05-01',
      });

      expect(extendDto.action).toBe('extend');
      expect(extendDto.requestedEndDate).toBe('2026-05-01');

      const returnDto = validateRentalReturnOrExtension({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        rentalContractId: 'rc-101',
        action: 'return_pickup',
        pickupAddress: 'Site 4 Loading Dock',
      });

      expect(returnDto.action).toBe('return_pickup');
      expect(returnDto.pickupAddress).toBe('Site 4 Loading Dock');
    });

    it('rejects rental extension if requestedEndDate is missing', () => {
      expect(() => {
        validateRentalReturnOrExtension({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          rentalContractId: 'rc-101',
          action: 'extend',
          // missing requestedEndDate
        });
      }).toThrow(/requestedEndDate is required/);
    });
  });
});

/**
 * =============================================================================
 * Test Suite 4: Customer Service Request Creation & Validation
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerServiceRequestService } from '../../src/services/customer-service-request.service.js';
import {
  validateCustomerServiceRequestCreate,
  validateCustomerServiceRequestCancel,
} from '../../src/schemas/customer-service-request.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 9: Customer Service Request Creation & Validation', () => {
  const CUSTOMER_ID = 'cust-1234-5678';
  const VALID_SITE_ID = 'site-1234-5678';
  const VALID_ASSET_ID = 'asset-1234-5678';

  describe('Service Request Schema Validation', () => {
    it('validates a complete service request with attachments and time slot', () => {
      const dto = validateCustomerServiceRequestCreate({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        siteId: VALID_SITE_ID,
        assetId: VALID_ASSET_ID,
        title: 'Chiller Leakage',
        description: 'Water pool observed beneath Chiller 2',
        priority: 'high',
        preferredDate: '2026-03-25',
        preferredTimeSlot: 'morning',
        attachmentUrls: ['https://storage.provider.com/photos/chiller1.jpg'],
      });

      expect(dto.title).toBe('Chiller Leakage');
      expect(dto.priority).toBe('high');
      expect(dto.preferredTimeSlot).toBe('morning');
      expect(dto.attachmentUrls?.length).toBe(1);
    });

    it('rejects attachment payload with more than 5 files', () => {
      expect(() => {
        validateCustomerServiceRequestCreate({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          siteId: VALID_SITE_ID,
          title: 'Too many files',
          description: 'Testing file limit',
          attachmentUrls: [
            'https://example.com/1.jpg',
            'https://example.com/2.jpg',
            'https://example.com/3.jpg',
            'https://example.com/4.jpg',
            'https://example.com/5.jpg',
            'https://example.com/6.jpg', // 6th file
          ],
        });
      }).toThrow(/Maximum 5 attachments are allowed/);
    });

    it('rejects invalid attachment URLs', () => {
      expect(() => {
        validateCustomerServiceRequestCreate({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          siteId: VALID_SITE_ID,
          title: 'Invalid URL',
          description: 'Testing bad URL',
          attachmentUrls: ['javascript:alert(1)'],
        });
      }).toThrow(/Invalid attachment URL/);
    });
  });

  describe('Service Request Creation & Ownership Guards', () => {
    it('strictly checks that site belongs to customer', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_sites') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: null, // Site not found for this customer
                      error: { message: 'Not found' },
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
        CustomerServiceRequestService.createServiceRequest(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          siteId: 'foreign-site-id',
          title: 'Test',
          description: 'Test',
          priority: 'medium',
        })
      ).rejects.toThrow(/Selected site is invalid or does not belong to your account/);
    });

    it('strictly checks that asset belongs to customer', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'customer_sites') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: VALID_SITE_ID, name: 'Site A' },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'customer_assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: null, // Asset not found for this customer
                      error: { message: 'Not found' },
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
        CustomerServiceRequestService.createServiceRequest(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          siteId: VALID_SITE_ID,
          assetId: 'foreign-asset-id',
          title: 'Test',
          description: 'Test',
          priority: 'medium',
        })
      ).rejects.toThrow(/Selected asset is invalid or does not belong to your account/);
    });
  });

  describe('Customer Cancellation Lifecycle', () => {
    it('allows cancellation when request is in "new" status', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'service_requests') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'req-1',
                        company_id: DEMO_COMPANY_A,
                        status: 'new',
                        request_number: 'REQ-001',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: updateMock,
            };
          }
          if (table === 'domain_events') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      } as any;

      await expect(
        CustomerServiceRequestService.cancelServiceRequest(
          mockClient,
          CUSTOMER_ID,
          'req-1',
          'Issue resolved internally'
        )
      ).resolves.not.toThrow();

      expect(updateMock).toHaveBeenCalled();
    });

    it('rejects cancellation when request is already converted or in-progress', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'service_requests') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'req-2',
                        company_id: DEMO_COMPANY_A,
                        status: 'converted',
                        request_number: 'REQ-002',
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
        CustomerServiceRequestService.cancelServiceRequest(
          mockClient,
          CUSTOMER_ID,
          'req-2',
          'Too late to cancel'
        )
      ).rejects.toThrow(/Cannot cancel request in 'converted' status/);
    });
  });
});

/**
 * =============================================================================
 * Test Suite 6: Customer Invoicing & Payment Intent Webhooks
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerPaymentService } from '../../src/services/customer-payment.service.js';
import {
  validatePaymentIntentCreate,
  validatePaymentIntentWebhook,
} from '../../src/schemas/customer-payment.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 9: Customer Invoicing & Payment Intent Webhooks', () => {
  const CUSTOMER_ID = 'cust-pay-123';
  const INVOICE_ID = 'inv-pay-456';

  describe('Payment Intent Creation Security', () => {
    it('calculates intent amount strictly from invoice amount_due and ignores any client-supplied amount', async () => {
      const insertMock = vi.fn().mockImplementation((payload: any) => ({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'pi-1',
              amount: payload.amount,
              currency: payload.currency,
              status: 'created',
              provider_intent_id: payload.provider_intent_id,
              provider_client_secret: payload.provider_client_secret,
            },
            error: null,
          }),
        }),
      }));

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'invoices') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: INVOICE_ID,
                        invoice_number: 'INV-2026-001',
                        invoice_date: '2026-03-01',
                        due_date: '2026-04-01',
                        currency: 'AED',
                        subtotal: 5000,
                        discount_amount: 0,
                        tax_amount: 250,
                        grand_total: 5250,
                        amount_paid: 1000,
                        amount_due: 4250, // True outstanding balance
                        status: 'partially_paid',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'payment_intents') {
            return {
              insert: insertMock,
            };
          }
          return {};
        }),
      } as any;

      const validated = validatePaymentIntentCreate({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        invoiceId: INVOICE_ID,
        provider: 'stripe',
        // Attacker attempts to tamper with amount to 1 AED:
        amount: 1,
      });

      const intent = await CustomerPaymentService.createPaymentIntent(mockClient, validated);

      // Must be the true balance 4250, NOT 1
      expect(intent.amount).toBe(4250);
      expect(intent.currency).toBe('AED');
      expect(intent.providerIntentId).toMatch(/^pi_/);
    });

    it('rejects payment intent creation for an already paid invoice', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'invoices') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: INVOICE_ID,
                        status: 'paid',
                        amount_due: 0,
                        grand_total: 1000,
                        amount_paid: 1000,
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
        CustomerPaymentService.createPaymentIntent(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          invoiceId: INVOICE_ID,
        })
      ).rejects.toThrow(/This invoice has already been fully paid/);
    });
  });

  describe('Payment Gateway Webhook Processing & Idempotency', () => {
    it('processes successful webhook by updating invoice payment and status', async () => {
      const updateInvoiceMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'payment_intents') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'intent-uuid-1',
                      company_id: DEMO_COMPANY_A,
                      customer_id: CUSTOMER_ID,
                      invoice_id: INVOICE_ID,
                      amount: 2500,
                      status: 'created',
                    },
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === 'invoices') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: INVOICE_ID,
                      grand_total: 2500,
                      amount_paid: 0,
                    },
                    error: null,
                  }),
                }),
              }),
              update: updateInvoiceMock,
            };
          }
          if (table === 'domain_events') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      } as any;

      const webhookDto = validatePaymentIntentWebhook({
        providerIntentId: 'pi_test_success_123',
        status: 'succeeded',
      });

      const result = await CustomerPaymentService.processPaymentWebhook(mockClient, webhookDto);

      expect(result.success).toBe(true);
      expect(result.status).toBe('succeeded');
      expect(updateInvoiceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_paid: 2500,
          status: 'paid',
        })
      );
    });

    it('handles idempotent duplicate webhooks gracefully without double-crediting', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'payment_intents') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'intent-uuid-1',
                      invoice_id: INVOICE_ID,
                      status: 'succeeded', // Already succeeded!
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as any;

      const result = await CustomerPaymentService.processPaymentWebhook(mockClient, {
        event: 'payment_intent.succeeded',
        providerIntentId: 'pi_test_dup',
        status: 'succeeded',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('already_processed');
    });
  });
});

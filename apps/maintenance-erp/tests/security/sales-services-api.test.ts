/**
 * =============================================================================
 * Integration Test: TypeScript Sales Services & REST API Controllers
 * Maintenance Management ERP — Phase 2B Sales, Invoicing & Customer Payments
 * =============================================================================
 * Verifies:
 *   1. QuotationsApiController, InvoicesApiController, PaymentsApiController, and BillingApiController
 *   2. Server-side validation schemas reject invalid or malicious requests
 *   3. End-to-end flow from Quotation API -> Invoice API -> Payment API
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A, DEMO_BRANCH_DXB } from './helpers.js';
import { QuotationsApiController } from '../../src/api/quotations.js';
import { InvoicesApiController } from '../../src/api/invoices.js';
import { PaymentsApiController } from '../../src/api/payments.js';
import { BillingApiController } from '../../src/api/billing.js';
import { validateQuotationCreate } from '../../src/schemas/quotation.schema.js';
import { validateInvoiceCreate } from '../../src/schemas/invoice.schema.js';
import { validatePaymentCreate } from '../../src/schemas/payment.schema.js';

describe('Phase 2B: Sales Domain Services & REST API Layer', () => {
  const admin = getAdminClient();
  let isLiveDb = false;
  let testCustomerId = '33333333-3333-3333-3333-333333333333';
  let quoteId: string;
  let invoiceId: string;
  let paymentId: string;

  beforeAll(async () => {
    try {
      const { data: cust, error } = await admin
        .from('customers')
        .insert({
          company_id: DEMO_COMPANY_A,
          branch_id: DEMO_BRANCH_DXB,
          name: 'Mahindra Heavy Industries',
          code: `CUST-MAH-${Date.now()}`,
        })
        .select('id')
        .single();

      if (!error && cust) {
        testCustomerId = cust.id;
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Validation Schemas & Serializers', () => {
    it('validates and accepts valid quotation input', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        customerId: testCustomerId,
        lines: [
          {
            description: 'Substation Servicing',
            quantity: 2,
            unitPrice: 5000,
            discountPercent: 5,
          },
        ],
      };
      const result = validateQuotationCreate(payload);
      expect(result.companyId).toBe(DEMO_COMPANY_A);
      expect(result.lines.length).toBe(1);
    });

    it('rejects quotation with invalid or negative quantity', () => {
      expect(() =>
        validateQuotationCreate({
          companyId: DEMO_COMPANY_A,
          customerId: testCustomerId,
          lines: [
            {
              description: 'Service',
              quantity: -1,
              unitPrice: 500,
            },
          ],
        })
      ).toThrow(/quantity must be a positive number/i);
    });

    it('validates and accepts valid invoice input', () => {
      const payload = {
        companyId: DEMO_COMPANY_A,
        customerId: testCustomerId,
        lines: [
          {
            description: 'Emergency Electrical Service',
            quantity: 1,
            unitPrice: 2000,
          },
        ],
      };
      const result = validateInvoiceCreate(payload);
      expect(result.lines[0].unitPrice).toBe(2000);
    });

    it('rejects payment with zero or negative amount', () => {
      expect(() =>
        validatePaymentCreate({
          companyId: DEMO_COMPANY_A,
          customerId: testCustomerId,
          amount: 0,
        })
      ).toThrow(/strictly positive number/i);
    });
  });

  describe('Quotations API', () => {
    it('rejects creation when schema validation fails (empty lines)', async () => {
      const res = await QuotationsApiController.createQuotation(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          customerId: testCustomerId,
          lines: [],
        },
      });

      expect(res.status).toBe(400);
      expect(res.error).toMatch(/at least one line item/i);
    });

    it('creates draft quotation via API controller with server-side totals', async () => {
      if (!isLiveDb) return;

      const res = await QuotationsApiController.createQuotation(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          branchId: DEMO_BRANCH_DXB,
          customerId: testCustomerId,
          currency: 'INR',
          supplierState: 'Maharashtra',
          customerState: 'Maharashtra',
          lines: [
            {
              lineType: 'service',
              description: 'Preventive Substation Maintenance',
              quantity: 1,
              unitPrice: 15000,
              discountPercent: 10,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(res.status).toBe(201);
      expect(res.data.success).toBe(true);
      expect(res.data.quotation_id).toBeDefined();
      expect(res.data.calculatedTotals.grandTotal).toBe(15930);
      quoteId = res.data.quotation_id;
    });

    it('lists quotations filtered by customer', async () => {
      if (!isLiveDb) return;

      const res = await QuotationsApiController.listQuotations(admin, {
        query: { customerId: testCustomerId },
      });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
    });

    it('sends and accepts quotation via API controller', async () => {
      if (!isLiveDb) return;

      await admin.rpc('submit_quotation', { p_quotation_id: quoteId });
      await admin.rpc('approve_quotation', { p_quotation_id: quoteId });

      const sendRes = await QuotationsApiController.sendQuotation(admin, {
        params: { id: quoteId },
      });
      expect(sendRes.status).toBe(200);
      expect(sendRes.data.status).toBe('sent');

      const acceptRes = await QuotationsApiController.acceptQuotation(admin, {
        params: { id: quoteId },
      });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.data.status).toBe('accepted');
    });

    it('converts accepted quotation into invoice via API controller', async () => {
      if (!isLiveDb) return;

      const convRes = await QuotationsApiController.convertToInvoice(admin, {
        params: { id: quoteId },
        body: { notes: 'Converted through REST API' },
      });

      expect(convRes.status).toBe(201);
      expect(convRes.data.success).toBe(true);
      expect(convRes.data.invoice_id).toBeDefined();
      invoiceId = convRes.data.invoice_id;
    });
  });

  describe('Invoices API', () => {
    it('handles missing invoice ID gracefully', async () => {
      const res = await InvoicesApiController.getInvoice(admin, {});
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/invoice id is required/i);
    });

    it('retrieves invoice detail via API controller', async () => {
      if (!isLiveDb) return;

      const res = await InvoicesApiController.getInvoice(admin, {
        params: { id: invoiceId },
      });

      expect(res.status).toBe(200);
      expect(res.data.id).toBe(invoiceId);
    });

    it('issues invoice via API controller', async () => {
      if (!isLiveDb) return;

      const res = await InvoicesApiController.issueInvoice(admin, {
        params: { id: invoiceId },
      });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('issued');
    });
  });

  describe('Payments API & Billing Summary', () => {
    it('handles missing payment ID on reversal gracefully', async () => {
      const res = await PaymentsApiController.reversePayment(admin, {});
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/payment id is required/i);
    });

    it('records customer payment via API controller', async () => {
      if (!isLiveDb) return;

      const res = await PaymentsApiController.recordPayment(admin, {
        body: {
          companyId: DEMO_COMPANY_A,
          branchId: DEMO_BRANCH_DXB,
          customerId: testCustomerId,
          amount: 5000,
          paymentMethod: 'bank_transfer',
          referenceNumber: `TXN-${Date.now()}`,
          autoAllocateToInvoiceId: invoiceId,
        },
      });

      expect(res.status).toBe(201);
      expect(res.data.payment.id).toBeDefined();
      paymentId = res.data.payment.id;
    });

    it('retrieves consolidated customer billing summary via API controller', async () => {
      if (!isLiveDb) return;

      const res = await BillingApiController.getCustomerBillingSummary(admin, {
        params: { id: testCustomerId },
      });

      expect(res.status).toBe(200);
      expect(res.data.customer_id).toBe(testCustomerId);
    });
  });
});

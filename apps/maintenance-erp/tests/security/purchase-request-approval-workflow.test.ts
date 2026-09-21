/**
 * =============================================================================
 * Phase 10 - Test Suite 2: Purchase Request Approval Workflow & Self-Approval Guard
 * Maintenance Management ERP
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { PurchaseRequestService } from '../../src/services/purchase-request.service.js';
import { validatePurchaseRequestCreate } from '../../src/schemas/procurement-request.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 10: Purchase Request Approval Workflow & Self-Approval Guard', () => {
  const REQUEST_ID = 'pr-uuid-101';
  const REQUESTER_USER_ID = 'user-tech-88';
  const MANAGER_USER_ID = 'user-mgr-01';

  it('creates a purchase request linked to a work order and calculates estimated total', async () => {
    const rawDto = {
      companyId: DEMO_COMPANY_A,
      workOrderId: 'wo-hvac-77',
      priority: 'high',
      items: [
        {
          itemId: 'item-filter-01',
          description: 'HEPA Air Filter',
          quantity: 4,
          unit: 'pcs',
          estimatedUnitPrice: 50.0,
        },
        {
          itemId: 'item-belt-02',
          description: 'Blower Fan Belt',
          quantity: 2,
          unit: 'pcs',
          estimatedUnitPrice: 30.0,
        },
      ],
    };

    const validated = validatePurchaseRequestCreate(rawDto);
    expect(validated.priority).toBe('high');
    expect(validated.items).toHaveLength(2);

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_requests') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              expect(payload.estimated_total).toBe(260.0); // (4*50) + (2*30) = 200 + 60
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: REQUEST_ID,
                      ...payload,
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'purchase_request_items') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const pr = await PurchaseRequestService.createPurchaseRequest(
      mockClient,
      validated,
      REQUESTER_USER_ID
    );

    expect(pr.id).toBe(REQUEST_ID);
    expect(pr.estimated_total).toBe(260.0);
    expect(pr.requested_by).toBe(REQUESTER_USER_ID);
  });

  it('submits a draft purchase request for approval', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: REQUEST_ID, status: 'draft' },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: REQUEST_ID, status: 'submitted' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const submitted = await PurchaseRequestService.submitPurchaseRequest(
      mockClient,
      DEMO_COMPANY_A,
      REQUEST_ID,
      REQUESTER_USER_ID
    );

    expect(submitted.status).toBe('submitted');
  });

  it('enforces organizational policy guard: prevents self-approval of requisition', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: REQUEST_ID,
                  request_number: 'PR-10001',
                  requested_by: REQUESTER_USER_ID,
                  status: 'submitted',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      PurchaseRequestService.approvePurchaseRequest(
        mockClient,
        DEMO_COMPANY_A,
        REQUEST_ID,
        { decision: 'approved', comment: 'Self approving my parts' },
        REQUESTER_USER_ID // Same user attempting approval!
      )
    ).rejects.toThrow('Policy violation: Users are not permitted to approve their own purchase requests');
  });

  it('allows an authorized manager to approve the purchase request', async () => {
    let approvalLogged = false;

    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'purchase_requests') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: REQUEST_ID,
                      request_number: 'PR-10001',
                      requested_by: REQUESTER_USER_ID,
                      status: 'submitted',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => ({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: REQUEST_ID,
                      status: payload.status,
                      approved_by: payload.approved_by,
                    },
                    error: null,
                  }),
                }),
              }),
            })),
          };
        }
        if (table === 'purchase_request_approvals') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              approvalLogged = true;
              expect(payload.approver_id).toBe(MANAGER_USER_ID);
              expect(payload.decision).toBe('approved');
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }
        if (table === 'domain_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      }),
    } as any;

    const approved = await PurchaseRequestService.approvePurchaseRequest(
      mockClient,
      DEMO_COMPANY_A,
      REQUEST_ID,
      { decision: 'approved', comment: 'Approved for urgent work order' },
      MANAGER_USER_ID
    );

    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(MANAGER_USER_ID);
    expect(approvalLogged).toBe(true);
  });
});

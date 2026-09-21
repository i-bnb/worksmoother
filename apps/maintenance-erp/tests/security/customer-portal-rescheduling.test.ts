/**
 * =============================================================================
 * Test Suite 7: Customer Rescheduling & Appointment Change Requests
 * Maintenance Management ERP — Phase 9 Customer Portal
 * =============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomerAppointmentService } from '../../src/services/customer-appointment.service.js';
import { validateAppointmentRescheduleRequest } from '../../src/schemas/customer-feedback.schema.js';
import { DEMO_COMPANY_A } from './helpers.js';

describe('Phase 9: Customer Rescheduling & Appointment Change Requests', () => {
  const CUSTOMER_ID = 'cust-appt-777';
  const APPOINTMENT_ID = 'appt-888-999';

  describe('Rescheduling Schema Validation', () => {
    it('validates a reschedule request payload with time slot', () => {
      const dto = validateAppointmentRescheduleRequest({
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        appointmentId: APPOINTMENT_ID,
        requestedDate: '2026-04-10T14:00:00Z',
        preferredTimeSlot: 'afternoon',
        reason: 'Office power shutdown on original date',
      });

      expect(dto.preferredTimeSlot).toBe('afternoon');
      expect(dto.reason).toBe('Office power shutdown on original date');
    });

    it('rejects reschedule request without reason', () => {
      expect(() => {
        validateAppointmentRescheduleRequest({
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          appointmentId: APPOINTMENT_ID,
          requestedDate: '2026-04-10T14:00:00Z',
          reason: '   ',
        });
      }).toThrow(/A reason for rescheduling is required/);
    });
  });

  describe('Appointment Reschedule Execution & Guards', () => {
    it('successfully submits change request for customer appointment', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'change-req-1', status: 'pending' },
            error: null,
          }),
        }),
      });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'service_appointments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: APPOINTMENT_ID,
                        company_id: DEMO_COMPANY_A,
                        customer_id: CUSTOMER_ID,
                        work_order_id: 'wo-1',
                        status: 'scheduled',
                        appointment_number: 'APT-2026-001',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'appointment_change_requests') {
            return {
              insert: insertMock,
            };
          }
          if (table === 'domain_events') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      } as any;

      const res = await CustomerAppointmentService.requestReschedule(mockClient, {
        companyId: DEMO_COMPANY_A,
        customerId: CUSTOMER_ID,
        appointmentId: APPOINTMENT_ID,
        requestedDate: '2026-04-10T14:00:00Z',
        reason: 'Office power shutdown',
      });

      expect(res.status).toBe('pending');
      expect(insertMock).toHaveBeenCalled();
    });

    it('strictly denies rescheduling when appointment does not belong to customer', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'service_appointments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: null, // Foreign appointment
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
        CustomerAppointmentService.requestReschedule(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          appointmentId: 'foreign-appt-id',
          requestedDate: '2026-04-10T14:00:00Z',
          reason: 'Attempting to change another customer appt',
        })
      ).rejects.toThrow(/Service appointment not found or does not belong to your account/);
    });

    it('rejects rescheduling an already completed appointment', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'service_appointments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: APPOINTMENT_ID,
                        status: 'completed', // Already completed
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
        CustomerAppointmentService.requestReschedule(mockClient, {
          companyId: DEMO_COMPANY_A,
          customerId: CUSTOMER_ID,
          appointmentId: APPOINTMENT_ID,
          requestedDate: '2026-04-10T14:00:00Z',
          reason: 'Cannot reschedule completed job',
        })
      ).rejects.toThrow(/Cannot reschedule an appointment that is already completed/);
    });
  });
});

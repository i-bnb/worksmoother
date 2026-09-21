/**
 * =============================================================================
 * Test Suite 7: AMC & Rental Maintenance Dispatch Integration
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateAppointmentCreate } from '../../src/schemas/service-appointment.schema.js';
import { ServiceAppointmentService } from '../../src/services/service-appointment.service.js';
import { LaborCostService, TimesheetLaborInput } from '../../src/services/labor-cost.service.js';
import { SkillMatchingService, RequiredSkillRequirement, TechnicianSkillProfile } from '../../src/services/skill-matching.service.js';

describe('Phase 7: AMC & Rental Maintenance Dispatch Integration', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('contracts').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('AMC Contract Recurring Maintenance Dispatch Flow', () => {
    it('creates a service appointment linked to an AMC contract preventive work order', () => {
      const amcWorkOrder = {
        id: 'wo-amc-pm-001',
        contractId: 'cnt-amc-2026-001',
        customerId: 'cust-mall-of-emirates',
        siteId: 'site-moe-central-plant',
        assetId: 'ast-chiller-york-01',
        priority: 'medium' as const,
        slaDeadline: '2026-03-25T17:00:00.000Z',
      };

      const appointmentDto = validateAppointmentCreate({
        companyId: DEMO_COMPANY_A,
        workOrderId: amcWorkOrder.id,
        customerId: amcWorkOrder.customerId,
        siteId: amcWorkOrder.siteId,
        assetId: amcWorkOrder.assetId,
        appointmentDate: '2026-03-25',
        startTime: '2026-03-25T08:00:00.000Z',
        endTime: '2026-03-25T12:00:00.000Z',
        estimatedDurationMinutes: 240, // 4 hours PM service
        travelBufferMinutes: 45,
        priority: amcWorkOrder.priority,
        slaDeadline: amcWorkOrder.slaDeadline,
        notes: 'Quarterly AMC Preventive Service — Chiller oil & filter change, leak inspection',
      });

      expect(appointmentDto.workOrderId).toBe('wo-amc-pm-001');
      expect(appointmentDto.customerId).toBe('cust-mall-of-emirates');
      expect(appointmentDto.assetId).toBe('ast-chiller-york-01');
      expect(appointmentDto.estimatedDurationMinutes).toBe(240);
    });

    it('validates specialized technician qualification for AMC chiller overhaul', () => {
      const amcRequiredSkills: RequiredSkillRequirement[] = [
        {
          skillId: 'skl-chiller-centrifugal',
          skillCode: 'CHILLER_CENTRIFUGAL',
          skillName: 'Centrifugal Chiller Overhaul & Commissioning',
          minProficiencyLevel: 4,
          isMandatory: true,
          certificationRequired: true,
        },
      ];

      const technicianProfiles: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-chiller-centrifugal',
          proficiencyLevel: 4,
          certified: true,
          validUntil: '2027-01-01',
        },
      ];

      const match = SkillMatchingService.evaluateSkillMatch(
        amcRequiredSkills,
        technicianProfiles,
        '2026-03-25'
      );

      expect(match.isQualified).toBe(true);
      expect(match.score).toBe(100);
      expect(match.missingMandatorySkills).toHaveLength(0);
    });
  });

  describe('Equipment Rental Breakdown Maintenance Dispatch Flow', () => {
    it('creates an emergency service appointment for on-site rental equipment breakdown', () => {
      const rentalBreakdownJob = {
        workOrderId: 'wo-rental-bd-550',
        customerId: 'cust-construction-corp',
        siteId: 'site-creek-harbour-plot-9',
        assetId: 'ast-gen-caterpillar-500kva',
        priority: 'critical' as const,
        slaDeadline: '2026-03-18T14:00:00.000Z', // 2 hour SLA
      };

      const appointmentDto = validateAppointmentCreate({
        companyId: DEMO_COMPANY_A,
        workOrderId: rentalBreakdownJob.workOrderId,
        customerId: rentalBreakdownJob.customerId,
        siteId: rentalBreakdownJob.siteId,
        assetId: rentalBreakdownJob.assetId,
        appointmentDate: '2026-03-18',
        startTime: '2026-03-18T12:00:00.000Z',
        endTime: '2026-03-18T13:30:00.000Z',
        estimatedDurationMinutes: 90,
        travelBufferMinutes: 20,
        priority: 'critical',
        slaDeadline: rentalBreakdownJob.slaDeadline,
        notes: 'URGENT: Rental Generator power loss shutting down site crane',
      });

      expect(appointmentDto.priority).toBe('critical');
      expect(appointmentDto.travelBufferMinutes).toBe(20);
    });

    it('advances rental emergency appointment through dispatch and arrival states', () => {
      // unscheduled -> scheduled -> dispatched -> en_route -> arrived -> in_progress
      expect(ServiceAppointmentService.isValidTransition('unscheduled', 'scheduled')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('scheduled', 'dispatched')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('dispatched', 'en_route')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('en_route', 'arrived')).toBe(true);
      expect(ServiceAppointmentService.isValidTransition('arrived', 'in_progress')).toBe(true);
    });
  });

  describe('Labor Costing Integration with Field Service Execution', () => {
    it('computes accurate regular and overtime labor costs for completed work order visits', () => {
      const timesheets: TimesheetLaborInput[] = [
        {
          technicianId: 'emp-tech-lead',
          technicianName: 'Zayd Al-Hashimi',
          durationHours: 4.0, // 4 hours regular
          laborRate: 90.0,
          isOvertime: false,
        },
        {
          technicianId: 'emp-tech-lead',
          technicianName: 'Zayd Al-Hashimi',
          durationHours: 2.0, // 2 hours emergency overtime
          laborRate: 90.0,
          overtimeRate: 135.0, // 1.5x
          isOvertime: true,
        },
      ];

      const laborResult = LaborCostService.calculateLaborCost(timesheets);

      // Regular: 4 * 90 = 360
      expect(laborResult.regularHours).toBe(4.0);
      expect(laborResult.regularCost).toBe(360.0);

      // Overtime: 2 * 135 = 270
      expect(laborResult.overtimeHours).toBe(2.0);
      expect(laborResult.overtimeCost).toBe(270.0);

      // Total: 360 + 270 = 630
      expect(laborResult.totalLaborCost).toBe(630.0);
      expect(laborResult.lineBreakdown).toHaveLength(2);
    });
  });

  describe('Live Database Contract Integration', () => {
    it('queries existing AMC contracts if live DB is available', async () => {
      if (!isLiveDb) return;

      const { data: contracts } = await admin
        .from('contracts')
        .select('id, contract_number, customer_id')
        .eq('company_id', DEMO_COMPANY_A)
        .limit(3);

      expect(Array.isArray(contracts)).toBe(true);
    });
  });
});

/**
 * =============================================================================
 * Test Suite 3: Technician Capacity & Workload Engine
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import {
  TechnicianCapacityService,
  AppointmentSlotDuration,
} from '../../src/services/technician-capacity.service.js';

describe('Phase 7: Technician Capacity & Workload Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('employees').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Capacity Calculation Logic', () => {
    it('returns full shift capacity when no appointments are scheduled', () => {
      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        appointments: [],
      });

      expect(result.totalShiftHours).toBe(8.0);
      expect(result.scheduledJobHours).toBe(0);
      expect(result.travelBufferHours).toBe(0);
      expect(result.reservedHours).toBe(0);
      expect(result.availableCapacityHours).toBe(8.0);
      expect(result.activeJobsCount).toBe(0);
      expect(result.utilizationPercentage).toBe(0);
      expect(result.isOnLeave).toBe(false);
    });

    it('correctly calculates scheduled hours, travel buffer, and remaining available capacity', () => {
      const appointments: AppointmentSlotDuration[] = [
        {
          durationMinutes: 120, // 2.0 hours
          travelBufferMinutes: 30, // 0.5 hours
        },
      ];

      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        appointments,
      });

      expect(result.totalShiftHours).toBe(8.0);
      expect(result.scheduledJobHours).toBe(2.0);
      expect(result.travelBufferHours).toBe(0.5);
      expect(result.availableCapacityHours).toBe(5.5);
      expect(result.activeJobsCount).toBe(1);
      // (120 + 30) / 480 = 150 / 480 = 31.25% -> 31.3%
      expect(result.utilizationPercentage).toBe(31.3);
      expect(result.isOnLeave).toBe(false);
    });

    it('correctly aggregates multiple appointments and calculates utilization', () => {
      const appointments: AppointmentSlotDuration[] = [
        { durationMinutes: 120, travelBufferMinutes: 30 }, // 2.5 hrs
        { durationMinutes: 90, travelBufferMinutes: 30 },  // 2.0 hrs
        { durationMinutes: 120, travelBufferMinutes: 30 }, // 2.5 hrs
      ];
      // Total jobs: 330 mins (5.5 hrs), Total buffer: 90 mins (1.5 hrs), Total used: 420 mins (7.0 hrs)
      // Available: 480 - 420 = 60 mins (1.0 hr)
      // Utilization: 420 / 480 = 87.5%

      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        appointments,
      });

      expect(result.scheduledJobHours).toBe(5.5);
      expect(result.travelBufferHours).toBe(1.5);
      expect(result.availableCapacityHours).toBe(1.0);
      expect(result.activeJobsCount).toBe(3);
      expect(result.utilizationPercentage).toBe(87.5);
    });

    it('clamps available capacity to 0 and caps utilization at 100% when overbooked', () => {
      const appointments: AppointmentSlotDuration[] = [
        { durationMinutes: 300, travelBufferMinutes: 60 }, // 360 mins
        { durationMinutes: 240, travelBufferMinutes: 60 }, // 300 mins => Total 660 mins > 480 mins
      ];

      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        appointments,
      });

      expect(result.availableCapacityHours).toBe(0);
      expect(result.utilizationPercentage).toBe(100);
      expect(result.scheduledJobHours).toBe(9.0);
    });

    it('accounts for explicit reserved buffer time', () => {
      const appointments: AppointmentSlotDuration[] = [
        { durationMinutes: 180, travelBufferMinutes: 30 }, // 210 mins
      ];

      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        appointments,
        reservedMinutes: 60, // 1 hour reserved for admin/training
      });

      // Total used = 210 + 60 = 270 mins (4.5 hrs)
      // Available = 480 - 270 = 210 mins (3.5 hrs)
      expect(result.reservedHours).toBe(1.0);
      expect(result.availableCapacityHours).toBe(3.5);
      // Utilization = 270 / 480 = 56.25% -> 56.3%
      expect(result.utilizationPercentage).toBe(56.3);
    });

    it('returns zero available capacity and zero active jobs when technician is on approved leave', () => {
      const result = TechnicianCapacityService.calculateCapacity({
        shiftWorkingHours: 8.0,
        isOnLeave: true,
        appointments: [{ durationMinutes: 120, travelBufferMinutes: 30 }],
      });

      expect(result.isOnLeave).toBe(true);
      expect(result.availableCapacityHours).toBe(0);
      expect(result.activeJobsCount).toBe(0);
      expect(result.scheduledJobHours).toBe(0);
      expect(result.travelBufferHours).toBe(0);
      expect(result.utilizationPercentage).toBe(0);
    });
  });

  describe('Live Database Capacity Evaluation', () => {
    it('queries daily and weekly capacity for active technician if live DB is available', async () => {
      if (!isLiveDb) return;

      const { data: tech } = await admin
        .from('employees')
        .select('id')
        .eq('company_id', DEMO_COMPANY_A)
        .eq('is_technician', true)
        .limit(1)
        .maybeSingle();

      if (!tech) return;

      const daily = await TechnicianCapacityService.getDailyCapacity(
        admin,
        DEMO_COMPANY_A,
        tech.id,
        '2026-03-16'
      );

      expect(daily).toBeDefined();
      expect(daily.totalShiftHours).toBe(8.0);
      expect(typeof daily.availableCapacityHours).toBe('number');
      expect(typeof daily.utilizationPercentage).toBe('number');

      const weekly = await TechnicianCapacityService.getWeeklyCapacity(
        admin,
        DEMO_COMPANY_A,
        tech.id,
        '2026-03-16'
      );

      expect(weekly).toBeDefined();
      expect(weekly.technicianId).toBe(tech.id);
      expect(typeof weekly.totalAvailableHours).toBe('number');
      expect(Object.keys(weekly.days)).toHaveLength(7);
    });
  });
});

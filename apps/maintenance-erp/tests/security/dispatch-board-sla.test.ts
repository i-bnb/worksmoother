/**
 * =============================================================================
 * Test Suite 4: Dispatch Board & SLA Monitoring Engine
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { SlaMonitoringService } from '../../src/services/sla-monitoring.service.js';
import { DispatchBoardService } from '../../src/services/dispatch-board.service.js';
import {
  validateDispatchQuery,
  validateCapacityQuery,
} from '../../src/schemas/dispatch.schema.js';

describe('Phase 7: Dispatch Board & SLA Monitoring Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('work_orders').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure SLA Monitoring & Health Evaluation', () => {
    it('evaluates SLA status as on_track when ample time remains', () => {
      const created = '2026-03-16T08:00:00.000Z';
      const deadline = '2026-03-16T18:00:00.000Z'; // 10 hours total
      const now = '2026-03-16T10:00:00.000Z';      // 2 hours elapsed (20%), 8 hours remaining

      const result = SlaMonitoringService.evaluateSlaStatus(created, deadline, now);

      expect(result.status).toBe('on_track');
      expect(result.isBreached).toBe(false);
      expect(result.percentageElapsed).toBe(20);
      expect(result.remainingMinutes).toBe(480); // 8 hours
    });

    it('evaluates SLA status as approaching when 70% elapsed or <= 240 mins remain', () => {
      const created = '2026-03-16T08:00:00.000Z';
      const deadline = '2026-03-16T18:00:00.000Z'; // 10 hours total
      const now = '2026-03-16T15:30:00.000Z';      // 7.5 hours elapsed (75%), 150 mins remaining

      const result = SlaMonitoringService.evaluateSlaStatus(created, deadline, now);

      expect(result.status).toBe('approaching');
      expect(result.isBreached).toBe(false);
      expect(result.percentageElapsed).toBe(75);
      expect(result.remainingMinutes).toBe(150);
    });

    it('evaluates SLA status as at_risk when 85% elapsed or <= 120 mins remain', () => {
      const created = '2026-03-16T08:00:00.000Z';
      const deadline = '2026-03-16T18:00:00.000Z';
      const now = '2026-03-16T17:00:00.000Z';      // 9 hours elapsed (90%), 60 mins remaining

      const result = SlaMonitoringService.evaluateSlaStatus(created, deadline, now);

      expect(result.status).toBe('at_risk');
      expect(result.isBreached).toBe(false);
      expect(result.percentageElapsed).toBe(90);
      expect(result.remainingMinutes).toBe(60);
    });

    it('evaluates SLA status as breached when deadline is past', () => {
      const created = '2026-03-16T08:00:00.000Z';
      const deadline = '2026-03-16T18:00:00.000Z';
      const now = '2026-03-16T18:30:00.000Z'; // 30 minutes past deadline

      const result = SlaMonitoringService.evaluateSlaStatus(created, deadline, now);

      expect(result.status).toBe('breached');
      expect(result.isBreached).toBe(true);
      expect(result.percentageElapsed).toBe(100);
      expect(result.remainingMinutes).toBeLessThanOrEqual(0);
    });

    it('handles malformed timestamps safely without throwing', () => {
      const result = SlaMonitoringService.evaluateSlaStatus('invalid-date', 'invalid-deadline');

      expect(result.status).toBe('on_track');
      expect(result.isBreached).toBe(false);
      expect(result.remainingMinutes).toBe(0);
    });
  });

  describe('Dispatch Board DTO & Query Validation', () => {
    it('validates dispatch board query parameters', () => {
      const valid = validateDispatchQuery({
        companyId: DEMO_COMPANY_A,
        startDate: '2026-03-16',
        endDate: '2026-03-16',
        territoryId: 'terr-dxb-01',
        technicianId: 'emp-001',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.startDate).toBe('2026-03-16');
      expect(valid.territoryId).toBe('terr-dxb-01');
      expect(valid.technicianId).toBe('emp-001');
    });

    it('rejects dispatch query missing required dates', () => {
      expect(() =>
        validateDispatchQuery({
          companyId: DEMO_COMPANY_A,
          startDate: '2026-03-16',
        })
      ).toThrow(/endDate is required/i);
    });

    it('validates capacity query parameters', () => {
      const valid = validateCapacityQuery({
        companyId: DEMO_COMPANY_A,
        date: '2026-03-16',
        technicianId: 'emp-001',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.date).toBe('2026-03-16');
      expect(valid.technicianId).toBe('emp-001');
    });
  });

  describe('Live Database Dispatch Board & SLA Queries', () => {
    it('fetches unassigned and overdue work orders if live DB is available', async () => {
      if (!isLiveDb) return;

      const unassigned = await DispatchBoardService.getUnassignedWorkOrders(
        admin,
        DEMO_COMPANY_A
      );
      expect(Array.isArray(unassigned)).toBe(true);

      const overdue = await DispatchBoardService.getOverdueWorkOrders(
        admin,
        DEMO_COMPANY_A
      );
      expect(Array.isArray(overdue)).toBe(true);

      const atRisk = await SlaMonitoringService.getSlaAtRiskWorkOrders(
        admin,
        DEMO_COMPANY_A
      );
      expect(Array.isArray(atRisk)).toBe(true);

      const breached = await SlaMonitoringService.getSlaBreachedWorkOrders(
        admin,
        DEMO_COMPANY_A
      );
      expect(Array.isArray(breached)).toBe(true);
    });
  });
});

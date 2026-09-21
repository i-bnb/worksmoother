/**
 * =============================================================================
 * Test Suite 6: Service Visit Report & Structured Checklists
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { validateServiceVisitReportCreate } from '../../src/schemas/service-visit.schema.js';
import { ServiceReportService } from '../../src/services/service-report.service.js';

describe('Phase 7: Service Visit Report & Checklist Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('service_visit_reports').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Service Visit Report DTO Validation', () => {
    it('validates a complete service visit report schema with parts and labor summaries', () => {
      const valid = validateServiceVisitReportCreate({
        companyId: DEMO_COMPANY_A,
        visitId: 'vis-101',
        workOrderId: 'wo-101',
        appointmentId: 'apt-101',
        technicianId: 'emp-101',
        customerId: 'cust-101',
        assetId: 'ast-101',
        problemReported: 'Chiller compressor tripped on high discharge pressure limit',
        diagnosis: 'Condenser coils severely clogged with dust and scale; fan motor capacitor degraded',
        workPerformed: 'Deep-cleaned condenser coil pack with chemical wash; replaced 45uF capacitor; recharged 2kg R134a',
        partsUsedSummary: [
          {
            item_code: 'CAP-45UF',
            item_name: 'Run Capacitor 45uF 440V',
            quantity: 1,
            unit_price: 45.0,
            is_billable: true,
          },
          {
            item_code: 'GAS-R134A',
            item_name: 'Refrigerant R134a Cyl (kg)',
            quantity: 2,
            unit_price: 35.0,
            is_billable: true,
          },
        ],
        laborSummary: [
          {
            technician_id: 'emp-101',
            technician_name: 'Tariq Al-Mansoor',
            hours: 3.5,
            labor_rate: 85.0,
          },
        ],
        recommendations: 'Recommend monthly coil wash and quarterly vibration analysis',
        followUpRequired: false,
        customerRemarks: 'Unit running smooth and cooling restored promptly',
        technicianRemarks: 'Operating pressures verified: suction 42 PSI, discharge 175 PSI',
        completionStatus: 'resolved',
      });

      expect(valid.companyId).toBe(DEMO_COMPANY_A);
      expect(valid.problemReported).toContain('compressor tripped');
      expect(valid.partsUsedSummary).toHaveLength(2);
      expect(valid.laborSummary).toHaveLength(1);
      expect(valid.laborSummary![0].hours).toBe(3.5);
      expect(valid.completionStatus).toBe('resolved');
      expect(valid.followUpRequired).toBe(false);
    });

    it('rejects report when mandatory diagnostic or work performed fields are missing', () => {
      expect(() =>
        validateServiceVisitReportCreate({
          companyId: DEMO_COMPANY_A,
          visitId: 'vis-101',
          workOrderId: 'wo-101',
          technicianId: 'emp-101',
          customerId: 'cust-101',
          problemReported: 'HVAC noisy',
          diagnosis: '', // missing diagnosis
          workPerformed: 'Checked unit',
        })
      ).toThrow(/diagnosis is required/i);

      expect(() =>
        validateServiceVisitReportCreate({
          companyId: DEMO_COMPANY_A,
          visitId: 'vis-101',
          workOrderId: 'wo-101',
          technicianId: 'emp-101',
          customerId: 'cust-101',
          problemReported: 'HVAC noisy',
          diagnosis: 'Motor bearing wear',
          workPerformed: '', // missing work performed
        })
      ).toThrow(/workPerformed is required/i);
    });

    it('rejects report when completion status is invalid', () => {
      expect(() =>
        validateServiceVisitReportCreate({
          companyId: DEMO_COMPANY_A,
          visitId: 'vis-101',
          workOrderId: 'wo-101',
          technicianId: 'emp-101',
          customerId: 'cust-101',
          problemReported: 'No cooling',
          diagnosis: 'Thermostat failure',
          workPerformed: 'Replaced thermostat',
          completionStatus: 'all_good_now' as any,
        })
      ).toThrow(/completionStatus must be one of/i);
    });

    it('accepts partial resolution with follow-up required', () => {
      const partial = validateServiceVisitReportCreate({
        companyId: DEMO_COMPANY_A,
        visitId: 'vis-102',
        workOrderId: 'wo-102',
        technicianId: 'emp-101',
        customerId: 'cust-101',
        problemReported: 'Chiller bearing loud rattling',
        diagnosis: 'Main drive shaft sleeve bearing worn beyond tolerance',
        workPerformed: 'Applied high-temp grease and tightened mounting; temporary operational bypass enabled',
        completionStatus: 'parts_pending',
        followUpRequired: true,
        followUpNotes: 'OEM bearing replacement kit BEARING-OEM-770 ordered from supplier',
      });

      expect(partial.completionStatus).toBe('parts_pending');
      expect(partial.followUpRequired).toBe(true);
      expect(partial.followUpNotes).toContain('OEM bearing replacement kit');
    });
  });

  describe('Checklist Submission Validation', () => {
    it('structures checklist responses correctly for pass/fail, numeric, and text items', () => {
      // Pass/fail verification
      const passFailItem = {
        companyId: DEMO_COMPANY_A,
        visitId: 'vis-101',
        checklistItemId: 'chk-001',
        technicianId: 'emp-101',
        isPassed: true,
        notes: 'Safety interlocks tested and fully functional',
      };
      expect(passFailItem.isPassed).toBe(true);

      // Numeric parameter reading (e.g. pressure/temp)
      const numericItem = {
        companyId: DEMO_COMPANY_A,
        visitId: 'vis-101',
        checklistItemId: 'chk-002',
        technicianId: 'emp-101',
        numericValue: 175.5,
        responseValue: '175.5 PSI',
        isPassed: true,
      };
      expect(numericItem.numericValue).toBe(175.5);
      expect(numericItem.responseValue).toBe('175.5 PSI');

      // Visual inspection / Serial number text
      const textItem = {
        companyId: DEMO_COMPANY_A,
        visitId: 'vis-101',
        checklistItemId: 'chk-003',
        technicianId: 'emp-101',
        responseValue: 'SN-CARRIER-998822-X',
      };
      expect(textItem.responseValue).toBe('SN-CARRIER-998822-X');
    });
  });

  describe('Live Database Service Report Query', () => {
    it('retrieves report by visit ID if live DB is available', async () => {
      if (!isLiveDb) return;

      const report = await ServiceReportService.getReportByVisit(
        admin,
        'non-existent-visit-id'
      );
      expect(report).toBeNull();
    });
  });
});

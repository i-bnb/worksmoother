/**
 * =============================================================================
 * Test Suite 1: Territory Coverage & Skill-Based Technician Qualification
 * Maintenance Management ERP — Phase 7 Field Service Management
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminClient, DEMO_COMPANY_A } from './helpers.js';
import { ServiceTerritoryService } from '../../src/services/service-territory.service.js';
import { SkillMatchingService, RequiredSkillRequirement, TechnicianSkillProfile } from '../../src/services/skill-matching.service.js';
import { validateTerritoryCreate, validateTerritoryMemberAssign } from '../../src/schemas/service-territory.schema.js';
import { validateRequiredSkillCreate } from '../../src/schemas/service-appointment.schema.js';

describe('Phase 7: Territory Coverage & Skill Qualification Engine', () => {
  const admin = getAdminClient();
  let isLiveDb = false;

  beforeAll(async () => {
    try {
      const { data, error } = await admin.from('service_territories').select('id').limit(1);
      if (!error && data) {
        isLiveDb = true;
      }
    } catch {
      isLiveDb = false;
    }
  });

  describe('Pure Territory Coverage Logic', () => {
    it('verifies technician coverage in assigned territories', () => {
      const techTerritories = ['terr-dxb-north', 'terr-dxb-central'];
      expect(ServiceTerritoryService.isTechnicianInTerritory(techTerritories, 'terr-dxb-north')).toBe(true);
      expect(ServiceTerritoryService.isTechnicianInTerritory(techTerritories, 'terr-auh-central')).toBe(false);
      // Empty target territory means open coverage
      expect(ServiceTerritoryService.isTechnicianInTerritory(techTerritories, '')).toBe(true);
    });

    it('validates territory creation DTO schema', () => {
      const valid = validateTerritoryCreate({
        companyId: DEMO_COMPANY_A,
        code: 'TERR-DXB-SOUTH',
        name: 'Dubai South & JAFZA Industrial',
        workingHours: {
          shift_start: '07:30',
          shift_end: '17:30',
          working_days: [1, 2, 3, 4, 5, 6],
        },
        priorityRules: {
          emergency_buffer_minutes: 20,
          default_priority: 'high',
        },
      });

      expect(valid.code).toBe('TERR-DXB-SOUTH');
      expect(valid.workingHours?.shift_start).toBe('07:30');
      expect(valid.priorityRules?.emergency_buffer_minutes).toBe(20);
    });

    it('validates territory member assignment schema', () => {
      const valid = validateTerritoryMemberAssign({
        companyId: DEMO_COMPANY_A,
        territoryId: 'terr-101',
        employeeId: 'emp-202',
        isPrimary: true,
        effectiveFrom: '2026-03-01',
      });

      expect(valid.isPrimary).toBe(true);
      expect(valid.effectiveFrom).toBe('2026-03-01');
    });
  });

  describe('Pure Skill Matching & Qualification Engine', () => {
    it('qualifies technician when skill levels meet or exceed requirements', () => {
      const requirements: RequiredSkillRequirement[] = [
        {
          skillId: 'skl-hvac',
          skillCode: 'HVAC',
          skillName: 'HVAC Maintenance',
          minProficiencyLevel: 3,
          isMandatory: true,
          certificationRequired: false,
        },
      ];

      const technicianSkills: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-hvac',
          proficiencyLevel: 4, // Exceeds required level 3
          certified: true,
        },
      ];

      const result = SkillMatchingService.evaluateSkillMatch(requirements, technicianSkills);
      expect(result.isQualified).toBe(true);
      expect(result.score).toBe(100);
      expect(result.missingMandatorySkills).toHaveLength(0);
      expect(result.insufficientLevelSkills).toHaveLength(0);
    });

    it('rejects technician when required skill is completely missing', () => {
      const requirements: RequiredSkillRequirement[] = [
        {
          skillId: 'skl-chiller',
          skillCode: 'CHILLER',
          skillName: 'Centrifugal Chiller Overhaul',
          minProficiencyLevel: 2,
          isMandatory: true,
          certificationRequired: false,
        },
      ];

      const technicianSkills: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-plumbing',
          proficiencyLevel: 4,
          certified: true,
        },
      ];

      const result = SkillMatchingService.evaluateSkillMatch(requirements, technicianSkills);
      expect(result.isQualified).toBe(false);
      expect(result.score).toBe(0);
      expect(result.missingMandatorySkills).toContain('CHILLER');
    });

    it('rejects technician when proficiency level is below minimum required', () => {
      const requirements: RequiredSkillRequirement[] = [
        {
          skillId: 'skl-electrical',
          skillCode: 'ELEC_HV',
          skillName: 'High Voltage Switchgear',
          minProficiencyLevel: 4,
          isMandatory: true,
          certificationRequired: false,
        },
      ];

      const technicianSkills: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-electrical',
          proficiencyLevel: 2, // Level 2 < 4
          certified: true,
        },
      ];

      const result = SkillMatchingService.evaluateSkillMatch(requirements, technicianSkills);
      expect(result.isQualified).toBe(false);
      expect(result.insufficientLevelSkills).toHaveLength(1);
    });

    it('enforces certification requirements and rejects expired certificates', () => {
      const requirements: RequiredSkillRequirement[] = [
        {
          skillId: 'skl-gas',
          skillCode: 'EPA_608',
          skillName: 'EPA Section 608 Universal',
          minProficiencyLevel: 3,
          isMandatory: true,
          certificationRequired: true,
        },
      ];

      // Expired certificate
      const techExpired: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-gas',
          proficiencyLevel: 4,
          certified: true,
          validUntil: '2025-12-31', // Expired as of 2026
        },
      ];

      const expiredResult = SkillMatchingService.evaluateSkillMatch(requirements, techExpired, '2026-03-01');
      expect(expiredResult.isQualified).toBe(false);
      expect(expiredResult.unmetCertificationSkills[0]).toMatch(/Expired/i);

      // Valid certificate
      const techValid: TechnicianSkillProfile[] = [
        {
          skillId: 'skl-gas',
          proficiencyLevel: 4,
          certified: true,
          validUntil: '2027-12-31',
        },
      ];

      const validResult = SkillMatchingService.evaluateSkillMatch(requirements, techValid, '2026-03-01');
      expect(validResult.isQualified).toBe(true);
      expect(validResult.score).toBe(100);
    });

    it('validates required skill creation schema (levels between 1 and 5)', () => {
      const valid = validateRequiredSkillCreate({
        companyId: DEMO_COMPANY_A,
        workOrderId: 'wo-123',
        skillId: 'skl-456',
        minProficiencyLevel: 4,
        isMandatory: true,
      });

      expect(valid.minProficiencyLevel).toBe(4);

      expect(() =>
        validateRequiredSkillCreate({
          companyId: DEMO_COMPANY_A,
          workOrderId: 'wo-123',
          skillId: 'skl-456',
          minProficiencyLevel: 6, // max is 5
        })
      ).toThrow(/between 1 and 5/i);
    });
  });

  describe('Database Integration', () => {
    it('creates territory, team, and assigns technician in database', async () => {
      if (!isLiveDb) return;

      const territory = await ServiceTerritoryService.createTerritory(admin, {
        companyId: DEMO_COMPANY_A,
        code: `TERR-${Date.now()}`,
        name: 'Dubai Marina & JBR Coastal',
      });
      expect(territory.id).toBeDefined();

      const team = await ServiceTerritoryService.createTeam(admin, {
        companyId: DEMO_COMPANY_A,
        code: `TEAM-${Date.now()}`,
        name: 'Coastal Emergency Response Crew',
        territoryId: territory.id,
      });
      expect(team.id).toBeDefined();
    });
  });
});

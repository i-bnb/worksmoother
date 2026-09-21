import { SupabaseClient } from '@supabase/supabase-js';
import { RequiredSkillCreateDto } from '../schemas/service-appointment.schema.js';

export interface RequiredSkillRequirement {
  skillId: string;
  skillCode?: string;
  skillName?: string;
  minProficiencyLevel: number;
  isMandatory: boolean;
  certificationRequired: boolean;
}

export interface TechnicianSkillProfile {
  skillId: string;
  proficiencyLevel: number;
  certified: boolean;
  validUntil?: string | null;
}

export interface SkillMatchResult {
  isQualified: boolean;
  score: number; // 0 to 100
  matchedSkillsCount: number;
  missingMandatorySkills: string[];
  insufficientLevelSkills: string[];
  unmetCertificationSkills: string[];
}

export class SkillMatchingService {
  /**
   * Pure evaluation of technician skills against work order skill requirements.
   */
  static evaluateSkillMatch(
    required: RequiredSkillRequirement[],
    technicianSkills: TechnicianSkillProfile[],
    targetDateStr?: string
  ): SkillMatchResult {
    if (required.length === 0) {
      return {
        isQualified: true,
        score: 100,
        matchedSkillsCount: 0,
        missingMandatorySkills: [],
        insufficientLevelSkills: [],
        unmetCertificationSkills: [],
      };
    }

    const techSkillMap = new Map<string, TechnicianSkillProfile>();
    for (const ts of technicianSkills) {
      techSkillMap.set(ts.skillId, ts);
    }

    const missingMandatory: string[] = [];
    const insufficientLevel: string[] = [];
    const unmetCertification: string[] = [];
    let satisfiedCount = 0;

    const checkDate = targetDateStr ? new Date(targetDateStr).getTime() : Date.now();

    for (const req of required) {
      const techSkill = techSkillMap.get(req.skillId);
      const label = req.skillCode || req.skillName || req.skillId;

      if (!techSkill) {
        if (req.isMandatory) {
          missingMandatory.push(label);
        }
        continue;
      }

      // Check proficiency level
      if (techSkill.proficiencyLevel < req.minProficiencyLevel) {
        insufficientLevel.push(`${label} (Level ${techSkill.proficiencyLevel} < ${req.minProficiencyLevel})`);
        continue;
      }

      // Check certification requirement
      if (req.certificationRequired) {
        if (!techSkill.certified) {
          unmetCertification.push(`${label} (Uncertified)`);
          continue;
        }
        if (techSkill.validUntil) {
          const exp = new Date(techSkill.validUntil).getTime();
          if (exp < checkDate) {
            unmetCertification.push(`${label} (Certificate Expired)`);
            continue;
          }
        }
      }

      satisfiedCount++;
    }

    const isQualified =
      missingMandatory.length === 0 &&
      insufficientLevel.length === 0 &&
      unmetCertification.length === 0;

    const score = Math.round((satisfiedCount / required.length) * 100);

    return {
      isQualified,
      score,
      matchedSkillsCount: satisfiedCount,
      missingMandatorySkills: missingMandatory,
      insufficientLevelSkills: insufficientLevel,
      unmetCertificationSkills: unmetCertification,
    };
  }

  /**
   * Adds a skill requirement to a work order.
   */
  static async addRequiredSkill(client: SupabaseClient, dto: RequiredSkillCreateDto) {
    const { data, error } = await client
      .from('work_order_required_skills')
      .upsert(
        {
          company_id: dto.companyId,
          work_order_id: dto.workOrderId,
          skill_id: dto.skillId,
          min_proficiency_level: dto.minProficiencyLevel || 1,
          is_mandatory: dto.isMandatory !== undefined ? dto.isMandatory : true,
          certification_required: Boolean(dto.certificationRequired),
        },
        { onConflict: 'work_order_id, skill_id' }
      )
      .select('*, skill:skills(*)')
      .single();

    if (error) throw new Error(`Failed to add required skill: ${error.message}`);
    return data;
  }

  /**
   * Lists required skills for a work order.
   */
  static async listRequiredSkills(client: SupabaseClient, workOrderId: string) {
    const { data, error } = await client
      .from('work_order_required_skills')
      .select('*, skill:skills(id, code, name, category)')
      .eq('work_order_id', workOrderId);

    if (error) throw new Error(`Failed to list required skills: ${error.message}`);
    return data;
  }

  /**
   * Evaluates and scores all active technicians for a work order on the live database.
   */
  static async findQualifiedTechnicians(
    client: SupabaseClient,
    companyId: string,
    workOrderId: string,
    targetDateStr?: string
  ) {
    const requiredSkillsRaw = await this.listRequiredSkills(client, workOrderId);

    const required: RequiredSkillRequirement[] = (requiredSkillsRaw || []).map((r: any) => ({
      skillId: r.skill_id,
      skillCode: r.skill?.code,
      skillName: r.skill?.name,
      minProficiencyLevel: r.min_proficiency_level,
      isMandatory: r.is_mandatory,
      certificationRequired: r.certification_required,
    }));

    // Fetch technicians with skills
    const { data: technicians, error } = await client
      .from('employees')
      .select('id, display_name, labor_rate, overtime_rate, is_technician, skills:employee_skills(*)')
      .eq('company_id', companyId)
      .eq('employment_status', 'ACTIVE')
      .eq('is_technician', true);

    if (error) throw new Error(`Failed to fetch technicians: ${error.message}`);

    const results = (technicians || []).map((tech: any) => {
      const techSkills: TechnicianSkillProfile[] = (tech.skills || []).map((s: any) => ({
        skillId: s.skill_id,
        proficiencyLevel: s.proficiency_level,
        certified: s.certified,
        validUntil: s.valid_until,
      }));

      const match = this.evaluateSkillMatch(required, techSkills, targetDateStr);

      return {
        technicianId: tech.id,
        technicianName: tech.display_name,
        laborRate: tech.labor_rate,
        isQualified: match.isQualified,
        score: match.score,
        matchedSkillsCount: match.matchedSkillsCount,
        missingMandatorySkills: match.missingMandatorySkills,
        insufficientLevelSkills: match.insufficientLevelSkills,
        unmetCertificationSkills: match.unmetCertificationSkills,
      };
    });

    return results.sort((a, b) => b.score - a.score);
  }
}

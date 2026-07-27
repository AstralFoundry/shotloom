import type { JsonObject } from '../core/types';

export interface SkillRoutingCandidate {
  id: string;
  name?: string;
}

export interface SkillRoutingDecision<TSkill extends SkillRoutingCandidate> {
  skill: TSkill;
  continueProductionPlan: boolean;
  reason: string;
  usedFallback: boolean;
}

export function parseSkillRoutingDecision<TSkill extends SkillRoutingCandidate>(
  text: string,
  skills: TSkill[],
): SkillRoutingDecision<TSkill> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed: JsonObject = {};
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(text.slice(start, end + 1)) as JsonObject;
    } catch {
      parsed = {};
    }
  }
  const selected = skills.find((skill) => skill.id === String(parsed.skillId || ''));
  const fallback = skills.find((skill) => skill.id === 'general') || skills[0];
  if (!fallback) throw new Error('当前没有已启用 Skill，助手无法启动');
  return {
    skill: selected || fallback,
    continueProductionPlan: parsed.continueProductionPlan === true,
    reason: String(parsed.reason || ''),
    usedFallback: !selected,
  };
}

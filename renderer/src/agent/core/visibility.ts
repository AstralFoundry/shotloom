import { AGENT_DEFINITIONS, agentDefinition, type AgentDefinition } from '../agents/definitions.ts';
import { skillNamespaceIsLoaded, toolNamespacePrefix } from './toolIdentity.ts';
import type { AgentToolContext, AgentToolDefinition } from './types';
import type { StoredSkill } from '../tools/catalogTools';

/**
 * 工具可见性解析。这里是“某个 agent 能看见哪些工具”的唯一判定处，
 * 结果同时决定发给模型的 tools 与本地是否允许执行，两处共用同一份逻辑。
 *
 * 四层取交集，任何一层不通过就不可见：
 * 1. Agent 白名单（fail-closed：新工具默认对所有 agent 不可见）
 * 2. Agent 副作用上限
 * 3. 工具自身的 isAvailable（用户设置、当前工作区状态等客观条件）
 * 4. Skill 命名空间工具必须等对应 SKILL.md 真正加载
 */
export function selectAgentTools(
  agent: AgentDefinition,
  universe: AgentToolDefinition[],
  context: AgentToolContext,
): AgentToolDefinition[] {
  const allowed = new Set(agent.tools);
  const effects = new Set(agent.effects);
  return universe.filter((tool) => {
    if (!allowed.has(tool.id)) return false;
    // 静态 effect 是该工具可能造成的最大副作用；带输入的降级判断留在执行时策略里。
    if (!effects.has(tool.effect)) return false;
    if (tool.isAvailable?.(context) === false) return false;
    const namespace = toolNamespacePrefix(tool.id);
    if (namespace?.startsWith('skill_') && !skillNamespaceIsLoaded(namespace, context.loadedSkillIds)) return false;
    return true;
  });
}

/** 按 agent id 解析可见工具；未声明的 agent 直接报错，不静默放行任何工具。 */
export function visibleAgentTools(
  agentId: string,
  universe: AgentToolDefinition[],
  context: AgentToolContext,
): AgentToolDefinition[] {
  return selectAgentTools(agentDefinition(agentId), universe, context);
}

/** 显式 Skill 归属优先于通配符，避免画布 Agent 加载只能使用文本或剪辑工具的 Skill。 */
function availableByDefinition(agent: AgentDefinition, skillId: string): boolean {
  if (agent.skills.includes(skillId)) return true;
  if (!agent.skills.includes('*')) return false;
  return !AGENT_DEFINITIONS.some((other) => other.id !== agent.id && other.skills.includes(skillId));
}

/** Skill 可见性与设置页共用这份 Agent 定义解析。 */
export function selectAgentSkills(agent: AgentDefinition, enabled: StoredSkill[]): StoredSkill[] {
  const hasAssignments = enabled.some((skill) => Array.isArray(skill.agentIds) && skill.agentIds.length > 0);
  // Settings may assign custom Skills only among the user-facing primary Agents.
  // Subagents remain fail-closed to the explicit definitions.ts whitelist.
  if (agent.role === 'primary' && hasAssignments) {
    return enabled.filter((skill) => {
      if (!availableByDefinition(agent, skill.id) && AGENT_DEFINITIONS.some((other) => other.skills.includes(skill.id))) return false;
      if (Array.isArray(skill.agentIds) && skill.agentIds.length) return skill.agentIds.includes(agent.id);
      return availableByDefinition(agent, skill.id);
    });
  }
  return enabled.filter((skill) => availableByDefinition(agent, skill.id));
}

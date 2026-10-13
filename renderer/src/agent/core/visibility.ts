import { agentDefinition, type AgentDefinition } from '../agents/definitions.ts';
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

/** Skill 可见性：`'*'` 表示所有已启用 Skill，否则只暴露白名单内的 Skill。 */
export function selectAgentSkills(agent: AgentDefinition, enabled: StoredSkill[]): StoredSkill[] {
  if (agent.skills.includes('*')) return enabled;
  const allowed = new Set(agent.skills);
  return enabled.filter((skill) => allowed.has(skill.id));
}

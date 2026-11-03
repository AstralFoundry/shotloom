import { AGENT_DEFINITIONS } from '../agents/definitions.ts';
import { selectAgentSkills } from './visibility.ts';

export const configurableSkillAgents = AGENT_DEFINITIONS
  .filter((agent) => agent.role === 'primary')
  .map((agent) => ({ id: agent.id, label: agent.title }));

/**
 * 设置页与运行时消费同一份 Skill 可见性解析，不另存一份可漂移的权限表。
 */
export function skillAgentLabels(skillId: string, assignedIds?: string[]): string[] {
  return AGENT_DEFINITIONS
    .filter((agent) => selectAgentSkills(agent, [{
      id: skillId,
      ...(assignedIds?.length ? { agentIds: assignedIds } : {}),
    }]).length > 0)
    .map((agent) => agent.title)
    .filter(Boolean);
}


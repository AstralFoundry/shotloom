import type { AgentToolContext, AgentToolEffect } from './types';

export type AgentToolPolicy = 'allow' | 'confirm' | 'deny';

/** 真正改写项目、画布或启动媒体生成的副作用；这些才是需要用户在“询问”模式下把关的操作。 */
const projectChangingEffects = new Set<AgentToolEffect>(['project_write', 'canvas_write', 'media_generation']);

/**
 * 将“运行模式 + 工具副作用”归一化为唯一权限结论。
 * 工具描述只指导模型如何选择工具，不能授予权限；真正执行前必须经过这里。
 * - “询问”模式只拦截会改写项目/画布/启动生成等关键操作；
 *   只读与 Agent 内部记账（agent_state_write）不打扰用户。
 */
export function resolveAgentToolPolicy(
  effect: AgentToolEffect,
  context: Pick<AgentToolContext, 'capabilities'> & { requireApproval?: boolean },
): AgentToolPolicy {
  if (effect === 'media_generation' && context.capabilities.nodeExecution !== true) return 'deny';
  if (context.requireApproval === true && projectChangingEffects.has(effect)) return 'confirm';
  return 'allow';
}


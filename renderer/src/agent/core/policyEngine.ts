import type { AgentToolContext, AgentToolEffect } from './types';

export type AgentToolPolicy = 'allow' | 'confirm' | 'deny';

/**
 * 将“运行模式 + 工具副作用”归一化为唯一权限结论。
 * 工具描述只指导模型如何选择工具，不能授予权限；真正执行前必须经过这里。
 */
export function resolveAgentToolPolicy(
  effect: AgentToolEffect,
  context: Pick<AgentToolContext, 'capabilities'>,
): AgentToolPolicy {
  if (effect === 'media_generation' && context.capabilities.nodeExecution !== true) return 'deny';
  return 'allow';
}

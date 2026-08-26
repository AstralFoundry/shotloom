import type { AgentAction, AgentActionResult } from '@/services/agentTypes';

/** Capabilities exposed by the canvas action executor to individual handlers. */
// Each handler owns one explicit subset of the canonical action contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionHandlerContext = Record<string, any>;

export type ActionHandler = (
  action: AgentAction,
  context: ActionHandlerContext,
) => AgentActionResult | null | Promise<AgentActionResult | null>;

// 所有细粒度画布工具最终都在这里把 Action 路由到画布、生成配置或任务处理器，
// 保证不同模型工具入口不会产生两套持久化结构。
const actionHandlers = new Map<string, ActionHandler>();

export function registerAction(type: string, handler: ActionHandler): void {
  if (!type.trim()) throw new Error('Action type is required');
  if (actionHandlers.has(type)) throw new Error(`Action handler already registered: ${type}`);
  actionHandlers.set(type, handler);
}

export async function dispatchAction(
  action: AgentAction,
  context: ActionHandlerContext,
): Promise<AgentActionResult> {
  const handler = actionHandlers.get(action.type);
  if (!handler) return { applied: false, error: `No handler registered for action: ${action.type}` };
  return (await handler(action, context)) ?? { applied: false };
}

export function hasAction(type: string): boolean {
  return actionHandlers.has(type);
}

export function missingActionHandlers(actionTypes: Iterable<string>): string[] {
  return [...actionTypes].filter((type) => !actionHandlers.has(type));
}

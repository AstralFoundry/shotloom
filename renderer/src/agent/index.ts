import type { AgentPromptPayload, AgentRunResult, AgentRuntimeEvent } from './core/types';

export async function runAgent(
  payload: AgentPromptPayload = {},
  onEvent: (event: AgentRuntimeEvent) => void = () => undefined,
): Promise<AgentRunResult> {
  const runtime = await import('./runtime/OpenCodeRuntime');
  return runtime.runOpenCodeAgent(payload, onEvent);
}

export async function abortAgent(requestId: string): Promise<boolean> {
  const runtime = await import('./runtime/OpenCodeRuntime');
  return runtime.abortOpenCodeAgent(requestId);
}
export { submitAgentApproval, submitAgentClarification } from './runtime/runtimeInteractions';
export { registerAgentTool, listAgentTools } from './core/toolRegistry';
export type { AgentToolDefinition, AgentToolEffect, AgentToolContext } from './core/types';

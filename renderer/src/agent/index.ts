import { settingsStore } from '@/store/settingsStore';
import { loopUnsupportedReason } from './loop/modelRequest';
import type { AgentPromptPayload, AgentRunResult, AgentRuntimeEvent } from './core/types';

export type AgentEngine = 'loop' | 'opencode';

/**
 * 引擎选择只看一个客观事实：自研 loop 实现的是 OpenAI Chat Completions 协议，
 * 模型目录声明的 Agent 协议不是它时（例如 Anthropic 原生 /v1/messages）显式退回
 * OpenCode，而不是退化成一个"语义相近"的协议。
 *
 * SHOTLOOM_AGENT_ENGINE 是双轨回归期间的临时开关，用于用同一个模型对比两个引擎；
 * 删除 OpenCode 时连同这里一起移除。
 */
export function selectAgentEngine(model: string): AgentEngine {
  const forced = String(globalThis.localStorage?.getItem('SHOTLOOM_AGENT_ENGINE') || '').trim();
  if (forced === 'opencode' || forced === 'loop') return forced;
  return loopUnsupportedReason(model) ? 'opencode' : 'loop';
}

export async function runAgent(
  payload: AgentPromptPayload = {},
  onEvent: (event: AgentRuntimeEvent) => void = () => undefined,
): Promise<AgentRunResult> {
  const model = String(payload.model || settingsStore.agentPreferredTextModel || '');
  if (selectAgentEngine(model) === 'loop') {
    const loop = await import('./loop/runLoopAgent');
    return loop.runLoopAgent(payload, onEvent);
  }
  const runtime = await import('./runtime/OpenCodeRuntime');
  return runtime.runOpenCodeAgent(payload, onEvent);
}

/** 取消按 requestId 归属：两个引擎谁持有这一轮，谁负责真正中断。 */
export async function abortAgent(requestId: string): Promise<boolean> {
  const loop = await import('./loop/runLoopAgent');
  if (await loop.abortLoopAgent(requestId)) return true;
  const runtime = await import('./runtime/OpenCodeRuntime');
  return runtime.abortOpenCodeAgent(requestId);
}
export { submitAgentApproval, submitAgentClarification } from './runtime/runtimeInteractions';
export { registerAgentTool, listAgentTools } from './core/toolRegistry';
export type { AgentToolDefinition, AgentToolEffect, AgentToolContext } from './core/types';

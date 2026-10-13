import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { registerDefaultAgentTools } from '../tools/registerDefaultTools';
import { listAgentTools } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject } from '../core/types';
import { executeAgentToolCall, type AgentToolRun } from './executeToolCall';

// OpenCode 工具桥只负责传输：sidecar 里的插件通过 Tauri 事件把调用送进来，
// 权限、循环拦截、回执与事件全部复用引擎无关的 executeAgentToolCall。
let activeRun: AgentToolRun | null = null;
let unlisten: UnlistenFn | null = null;

async function ensureListener() {
  if (unlisten) return;
  unlisten = await listen<{ requestId: string; callId: string; name: string; arguments?: JsonObject }>('agent-tool-request', async ({ payload }) => {
    const run = activeRun;
    try {
      if (!run || run.context.requestId !== payload.requestId) {
        throw new Error('Shotloom tool transport has no matching active Agent run');
      }
      const result = await executeAgentToolCall(run, {
        callId: payload.callId,
        name: payload.name,
        // sidecar 插件已经把参数解析成对象，这里还原成 JSON 字符串交给统一管道。
        argumentsJson: JSON.stringify(payload.arguments || {}),
      });
      await invoke('agent_tool_reply', { callId: payload.callId, result, error: null });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      await invoke('agent_tool_reply', { callId: payload.callId, result: null, error }).catch(() => undefined);
    }
  });
}

export async function activateOpenCodeToolBridge(run: { context: AgentToolContext; model: string }) {
  registerDefaultAgentTools();
  if (activeRun && activeRun.context.requestId !== run.context.requestId) {
    throw new Error('Shotloom tool transport already has an active Agent run');
  }
  activeRun = run;
  await ensureListener();
  const tools = listAgentTools(run.context).map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: tool.resolveInputSchema?.(run.context) || tool.inputSchema,
  }));
  await invoke('agent_runtime_register_tools', { tools, requestId: run.context.requestId });
  return tools;
}

export async function deactivateOpenCodeToolBridge(requestId: string) {
  if (activeRun?.context.requestId === requestId) activeRun = null;
  await invoke('agent_runtime_release_tool_run', { requestId }).catch(() => undefined);
}

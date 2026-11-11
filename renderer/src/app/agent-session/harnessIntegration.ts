import { t, localizeNativeError } from '@/i18n';
import { CANVAS_AGENT_ID, DIRECTOR_AGENT_ID, EDITOR_AGENT_ID } from '../../agent/agents/definitions';
import { invoke as nativeInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { harnessModelConfig } from '../../services/harnessModelConfig';
import { availableAgentSkills } from '../../agent/tools/catalogTools';
import { desktopApi } from '../../services/desktopApi';
import { productToolCatalog, bindProductSession, registerEditorSessionBinder, executeProductRequest, type ProductBinding } from '../../services/harnessProductTools';
import { canvasHarnessSession, directorHarnessSession, editorHarnessSession, textHarnessSession } from '../../services/harnessSessionStore';
import { getAgentProjectIdentity, assertAgentProject } from '../../services/agentProjectIdentity';
import { store, touchProject } from '../../store/projectStore';
import { initializeHarnessClient } from './harnessClient';

// This integration owns native Harness calls, which bypass desktopApi's IPC boundary.
async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  try { return await nativeInvoke<T>(command, args); }
  catch (error) {
    const message = localizeNativeError(error);
    if (message === undefined) throw error;
    throw new Error(message);
  }
}

let startup: Promise<void> | undefined;
let bridgeListening = false;
export function startHarnessIntegration(): Promise<void> {
  if (startup) return startup;
  registerEditorSessionBinder(async nodeId => {
    const result = await openHarnessPanel(EDITOR_AGENT_ID, nodeId);
    const conversation = editorHarnessSession(store.project, nodeId);
    return { sessionId: result.sessionId, projectKey: getAgentProjectIdentity().projectKey, conversationId: conversation.id!, agentId: EDITOR_AGENT_ID, nodeId };
  });
  startup = (async () => {
    if (desktopApi.platform === 'browser') throw new Error(t('agent.desktopRequired'));
    if (!bridgeListening) await listen<Parameters<typeof executeProductRequest>[0]>('harness://tool-request', async event => {
      try {
        const result = await executeProductRequest(event.payload);
        // 工具目录在绑定会话时一次性下发，所以两类工具必须在返回结果前重新下发，
        // 否则模型按回执去调用时会发现工具不在本轮请求里：
        // - save_skill 保存的新 Skill 要立刻可见；
        // - editor_find_tools 解锁的原生工具要立刻可调用。
        const refreshesCatalog = event.payload.toolName === 'save_skill' || event.payload.toolName === 'editor_find_tools';
        if (refreshesCatalog && event.payload.phase !== 'authorize') {
          const receipt = result as { result?: { success?: boolean; activation?: string; warning?: string } };
          if (receipt.result?.success) {
            try {
              const { sessionId, ...binding } = event.payload.binding;
              await invoke('harness_bind_session', { config: { binding, sessionId,
                tools: productToolCatalog(binding), skills: availableAgentSkills(binding.agentId).map(skill => ({
                  id: skill.id, description: skill.description, instructions: skill.instructions || '', metadata: skill.metadata, builtIn: skill.builtIn === true,
                })),
              } });
              // Skill 保存路径对外暴露可观察的激活状态；工具解锁只用同一份刷新，不新增文案。
              if (event.payload.toolName === 'save_skill') receipt.result.activation = 'current-session-refreshed';
            } catch (error) {
              if (event.payload.toolName === 'save_skill') {
                receipt.result.activation = 'refresh-failed';
                receipt.result.warning = t('agent.skillRefreshFailed', { error: String(error) });
              } else {
                // 解锁已写入会话状态，下一轮重新打开面板即生效；这里如实降级，不谎称当轮可用。
                receipt.result.warning = t('tool.feedback.editor.toolRefreshFailed', { error: String(error) });
              }
            }
          }
        }
        await invoke('harness_tool_respond', { response: { requestId: event.payload.requestId, result } });
      } catch (error) {
        await invoke('harness_tool_respond', { response: { requestId: event.payload.requestId, error: String(error) } }).catch(() => {});
      }
    });
    bridgeListening = true;
    let status = await invoke<{ running: boolean; ready: boolean; error?: string }>('start_harness_runtime', { options: {} });
    const deadline = Date.now() + 30_000;
    while (!status.ready) {
      if (!status.running || Date.now() >= deadline) throw new Error(localizeNativeError(status.error) ?? status.error ?? t('agent.hostNotReady'));
      await new Promise(resolve => setTimeout(resolve, 100));
      status = await invoke('harness_runtime_status');
    }
    await initializeHarnessClient();
  })().catch(error => { startup = undefined; throw error; });
  return startup;
}

export async function openHarnessPanel(role: ProductBinding['agentId'], nodeId?: string, conversationId?: string) {
  await startHarnessIntegration();
  const identity = getAgentProjectIdentity();
  const selected = store.project.harnessSessions?.find((item: { id?: string; agentId?: string; textNodeId?: string; editorNodeId?: string; directorNodeId?: string }) => item.id === conversationId && item.agentId === role && (item.textNodeId || item.editorNodeId || item.directorNodeId) === nodeId);
  const conversation = selected ?? (role === CANVAS_AGENT_ID ? canvasHarnessSession(store.project)
    : role === DIRECTOR_AGENT_ID ? directorHarnessSession(store.project, nodeId)
    : role === EDITOR_AGENT_ID ? editorHarnessSession(store.project, nodeId!) : textHarnessSession(store.project, nodeId!));
  const binding = { projectKey: identity.projectKey, conversationId: conversation.id!, agentId: role, ...(nodeId ? { nodeId } : {}) };
  const result = await invoke<{ sessionId: string; tools: string[]; toolTitles: Record<string, string> }>('harness_bind_session', { config: {
    binding, tools: productToolCatalog(binding), skills: availableAgentSkills(role).map(skill => ({ id: skill.id, description: skill.description, instructions: skill.instructions || '', metadata: skill.metadata, builtIn: skill.builtIn === true })),
    ...harnessModelConfig(),
    ...(conversation.harnessSessionId ? { sessionId: conversation.harnessSessionId } : {}),
  } });
  assertAgentProject(identity.projectKey, identity.instanceId, identity.generation);
  bindProductSession({ ...binding, sessionId: result.sessionId });
  conversation.harnessSessionId = result.sessionId;
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return result;
}

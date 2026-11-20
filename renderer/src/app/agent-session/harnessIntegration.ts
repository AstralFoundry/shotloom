import { t } from '@/i18n';
import { CANVAS_AGENT_ID, DIRECTOR_AGENT_ID, EDITOR_AGENT_ID } from '../../agent/agents/definitions';
import { harnessModelConfig } from '../../services/harnessModelConfig';
import { availableAgentSkills } from '../../agent/tools/catalogTools';
import { productToolCatalog, bindProductSession, registerEditorSessionBinder, executeProductRequest, type ProductBinding } from '../../services/harnessProductTools';
import { canvasHarnessSession, directorHarnessSession, editorHarnessSession, textHarnessSession } from '../../services/harnessSessionStore';
import { getAgentProjectIdentity, assertAgentProject } from '../../services/agentProjectIdentity';
import { store, touchProject } from '../../store/projectStore';
export { setHarnessSessionsArchived } from '../../services/harnessArchive';
import { cloudEnabled } from '../../utils/cloudConfig';
import { refreshCloudAccountSettings } from '../../store/settingsStore';
import { loadGlobalSkills } from '../../store/skillsStore';
import { loadGlobalRecipes } from '../../store/recipesStore';
import { bindBrowserHarness, respondBrowserTool, registerBrowserToolHandler, connectBrowserHarness } from '../../services/browserHarnessTransport';

// 所有端共用 Worker；产品工具仍通过现有绑定与权限边界执行。
async function invoke<T>(command: string, args: { config?: unknown; response?: Parameters<typeof respondBrowserTool>[0] }): Promise<T> {
  if (command === 'harness_bind_session') return bindBrowserHarness<T>(args.config);
  if (command === 'harness_tool_respond') { await respondBrowserTool(args.response!); return undefined as T; }
  throw new Error(`Unknown Agent operation: ${command}`);
}

let startup: Promise<void> | undefined;
export function startHarnessIntegration(): Promise<void> {
  if (startup) return startup;
  registerEditorSessionBinder(async nodeId => {
    const result = await openHarnessPanel(EDITOR_AGENT_ID, nodeId);
    const conversation = editorHarnessSession(store.project, nodeId);
    return { sessionId: result.sessionId, projectKey: getAgentProjectIdentity().projectKey, conversationId: conversation.id!, agentId: EDITOR_AGENT_ID, nodeId };
  });
  startup = (async () => {
    const handleToolRequest = async (payload: Parameters<typeof executeProductRequest>[0], signal?: AbortSignal) => {
      try {
        const result = await executeProductRequest(payload, signal);
        // 工具目录在绑定会话时一次性下发，所以两类工具必须在返回结果前重新下发，
        // 否则模型按回执去调用时会发现工具不在本轮请求里：
        // - save_skill 保存的新 Skill 要立刻可见；
        // - editor_find_tools 解锁的原生工具要立刻可调用。
        const refreshesCatalog = payload.toolName === 'save_skill' || payload.toolName === 'editor_find_tools';
        if (refreshesCatalog && payload.phase !== 'authorize') {
          const receipt = result as { result?: { success?: boolean; activation?: string; warning?: string } };
          if (receipt.result?.success) {
            try {
              const { sessionId, ...binding } = payload.binding;
              await invoke('harness_bind_session', { config: { binding, sessionId,
                tools: productToolCatalog(binding), skills: availableAgentSkills(binding.agentId).map(skill => ({
                  id: skill.id, description: skill.description, instructions: skill.instructions || '', metadata: skill.metadata, builtIn: skill.builtIn === true,
                })),
              } });
              // Skill 保存路径对外暴露可观察的激活状态；工具解锁只用同一份刷新，不新增文案。
              if (payload.toolName === 'save_skill') receipt.result.activation = 'current-session-refreshed';
            } catch (error) {
              if (payload.toolName === 'save_skill') {
                receipt.result.activation = 'refresh-failed';
                receipt.result.warning = t('agent.skillRefreshFailed', { error: String(error) });
              } else {
                // 解锁已写入会话状态，下一轮重新打开面板即生效；这里如实降级，不谎称当轮可用。
                receipt.result.warning = t('tool.feedback.editor.toolRefreshFailed', { error: String(error) });
              }
            }
          }
        }
        await invoke('harness_tool_respond', { response: { requestId: payload.requestId, result } });
      } catch (error) {
        await invoke('harness_tool_respond', { response: { requestId: payload.requestId, error: String(error) } }).catch(() => {});
      }
    };
    registerBrowserToolHandler(handleToolRequest);
    await connectBrowserHarness();
  })().catch(error => { startup = undefined; throw error; });
  return startup;
}

export async function openHarnessPanel(role: ProductBinding['agentId'], nodeId?: string, conversationId?: string, signal?: AbortSignal) {
  const identity = getAgentProjectIdentity();
  signal?.throwIfAborted();
  await startHarnessIntegration();
  signal?.throwIfAborted();
  assertAgentProject(identity.projectKey, identity.instanceId, identity.generation);
  if (cloudEnabled) {
    await Promise.all([loadGlobalSkills(), loadGlobalRecipes(), refreshCloudAccountSettings()]);
    signal?.throwIfAborted();
    assertAgentProject(identity.projectKey, identity.instanceId, identity.generation);
  }
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
  if (conversation.harnessSessionId && conversation.harnessSessionId !== result.sessionId && !conversation.legacyHarnessSessionId) {
    conversation.legacyHarnessSessionId = conversation.harnessSessionId;
  }
  conversation.harnessSessionId = result.sessionId;
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return result;
}

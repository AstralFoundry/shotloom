import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createOpencodeClient, type Event, type Part } from '@opencode-ai/sdk/client';
import { getModelInfo, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { assertAgentProject, getAgentProjectIdentity, getAgentProjectKey } from '@/services/agentProjectIdentity';
import { store } from '@/store/projectStore';
import { getModelCredentialStatus, getProviderCredentials, settingsStore } from '@/store/settingsStore';
import { availableAgentSkills } from '../tools/catalogTools';
import { AGENT_DEFINITIONS, agentDefinition } from '../agents/definitions.ts';
import { listAgentTools } from '../core/toolRegistry.ts';
import { selectAgentTools } from '../core/visibility.ts';
import { buildAgentSystemPrompt, buildRunContextBlock, buildSubagentPrompt } from '../content/instructions';
import { resolveImageAttachments } from '../content/attachments';
import { appendAgentRuntimeEvent, createAgentInteraction } from './runStore';
import { waitForAgentApproval } from './runtimeInteractions';
import { activateOpenCodeToolBridge, deactivateOpenCodeToolBridge } from './OpenCodeToolBridge';
import { activeProductionPlanSummary } from './productionPlanStore';
import { diagnoseRuntimeFailure, RuntimeDiagnosticError } from './runtimeDiagnostics';
import { resolveOpenCodeProvider } from './openCodeProvider.mjs';
import type { AgentPromptPayload, AgentRunResult, AgentRuntimeEvent, AgentToolContext, AgentToolReceipt, JsonObject, JsonSchema } from '../core/types';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';
import { nativeRuntimeSkills, type NativeRuntimeSkill } from './nativeSkills';

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;
interface OpenCodeConfiguration {
  tools: Array<{ name: string; description: string; inputSchema: JsonSchema }>;
  enabledProviders: string[];
  model: string;
  provider: JsonObject;
  agent: JsonObject;
  skills: NativeRuntimeSkill[];
  workspaceDirectory: string;
  shellApproval: 'ask' | 'full';
  runtimeProtection: {
    healthIntervalMs: number;
    failureThreshold: number;
    failureWindowMs: number;
    circuitCooldownMs: number;
    stallWarningMs: number;
    hardCapMs: number;
  };
}
const activeRuns = new Map<string, { controller: AbortController; client: OpenCodeClient; sessionId: string }>();
let clientPromise: Promise<{ client: OpenCodeClient }> | null = null;
let clientConfigurationKey = '';
const PROVIDER_LKG_FILE = 'agent-provider-lkg.json';

// system prompt 里唯一随引擎变化的句子：告诉模型谁在管理循环、历史和子 Agent。
const RUNTIME_MODEL_CONTRACT = '模型循环、会话、上下文压缩与子 Agent 由 OpenCode Runtime 管理。';

function stripProviderSecrets(configuration: OpenCodeConfiguration): OpenCodeConfiguration {
  const clone = JSON.parse(JSON.stringify(configuration)) as OpenCodeConfiguration;
  for (const provider of Object.values(clone.provider || {}) as any[]) {
    if (!provider?.options) continue;
    for (const key of Object.keys(provider.options)) {
      if (/api.?key|token|secret|password|authorization/i.test(key)) delete provider.options[key];
    }
  }
  return clone;
}

async function saveProviderLkg(configuration: OpenCodeConfiguration) {
  await invoke('storage_set', {
    name: PROVIDER_LKG_FILE,
    value: { schemaVersion: 1, savedAt: new Date().toISOString(), configuration: stripProviderSecrets(configuration) },
  }).catch(() => undefined);
}

async function providerLkgFallback(current: OpenCodeConfiguration): Promise<OpenCodeConfiguration | null> {
  const stored = await invoke<any>('storage_get', {
    name: PROVIDER_LKG_FILE,
    fallback: null,
  }).catch(() => null);
  const lkg = stored?.schemaVersion === 1 ? stored.configuration as OpenCodeConfiguration : null;
  if (!lkg?.provider || !lkg?.model) return null;
  const [providerId, modelId] = String(current.model).split('/', 2);
  if (!providerId || !modelId || !(lkg.provider as any)?.[providerId]?.models?.[modelId]) return null;
  const currentProvider = (current.provider as any)[providerId];
  const lkgProvider = (lkg.provider as any)[providerId];
  if (!currentProvider || !lkgProvider) return null;
  return {
    ...lkg,
    model: current.model,
    workspaceDirectory: current.workspaceDirectory,
    agent: current.agent,
    skills: current.skills,
    tools: current.tools,
    runtimeProtection: current.runtimeProtection,
    provider: {
      ...lkg.provider,
      [providerId]: {
        ...lkgProvider,
        options: { ...(lkgProvider.options || {}), ...(currentProvider.options || {}) },
      },
    },
  };
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

interface RuntimeHttpResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

interface RuntimeStreamEvent {
  subscriptionId: string;
  event?: Event;
  error?: string;
  done: boolean;
}

async function runtimeFetch(request: Request): Promise<Response> {
  const target = new URL(request.url);
  const response = await invoke<RuntimeHttpResponse>('agent_runtime_request', {
    request: {
      method: request.method,
      url: `${target.pathname}${target.search}`,
      headers: Array.from(request.headers.entries()),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    },
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function runtimeClient(configuration: OpenCodeConfiguration) {
  const configurationKey = JSON.stringify(configuration);
  if (clientConfigurationKey !== configurationKey) clientPromise = null;
  if (clientPromise) {
    const status = await invoke<{ state: string }>('agent_runtime_status').catch(() => ({ state: 'failed' }));
    if (status.state !== 'ready') clientPromise = null;
  }
  if (!clientPromise) {
    clientConfigurationKey = configurationKey;
    clientPromise = invoke<{ state: string; error?: string }>('agent_runtime_start', { configuration })
      .catch(async (primaryError) => {
        const fallback = await providerLkgFallback(configuration);
        if (!fallback) throw primaryError;
        return invoke<{ state: string; error?: string }>('agent_runtime_start', { configuration: fallback });
      }).then((status) => {
      if (status.state !== 'ready') throw new Error(status.error || 'OpenCode Runtime 启动失败');
      void saveProviderLkg(configuration);
      const client = createOpencodeClient({
        baseUrl: 'http://shotloom-runtime',
        fetch: runtimeFetch,
        throwOnError: true,
        responseStyle: 'data',
      });
      return { client };
    }).catch((error) => {
      clientPromise = null;
      clientConfigurationKey = '';
      throw error;
    });
  }
  return clientPromise;
}

/**
 * 把 Agent 定义翻译成 Runtime 的 agent profile。
 *
 * 子 Agent 的工具关闭项由"主 Agent 已注册的集合减去该子 Agent 的可见集合"生成，
 * 因此白名单或副作用上限一变，这里自动生效，不再需要手工维护 deny 列表。
 */
function agentProfiles(context: AgentToolContext, skills: NativeRuntimeSkill[]) {
  const primary = agentDefinition(context.agentId);
  const registeredTools = listAgentTools(context);
  const registeredToolIds = registeredTools.map((tool) => `shotloom_${tool.id}`);
  const profiles: JsonObject = {};
  for (const definition of AGENT_DEFINITIONS) {
    if (definition.role === 'primary') {
      if (definition.id !== primary.id) continue;
      profiles[definition.id] = {
        mode: 'primary', maxSteps: definition.maxSteps, description: definition.description,
        prompt: buildAgentSystemPrompt(context, RUNTIME_MODEL_CONTRACT),
        permission: {
          edit: 'deny', bash: settingsStore.agentShellApproval === 'ask' ? 'ask' : 'allow',
          external_directory: 'deny', webfetch: 'deny',
          skill: Object.fromEntries([
            ['*', 'deny'],
            // skills 已由 configureModel 按该 Agent 的 Skill 白名单解析过。
            ...skills.map((skill) => [skill.id, 'allow']),
          ]),
        },
      };
      continue;
    }
    // 只有主 Agent 显式授予的 dispatch 才建立 profile，避免任何 primary 都能调用全部子 Agent。
    if (!primary.dispatch.includes(definition.id)) continue;
    const allowed = new Set(
      selectAgentTools(definition, registeredTools, context).map((tool) => `shotloom_${tool.id}`),
    );
    profiles[definition.id] = {
      mode: 'subagent', maxSteps: definition.maxSteps, description: definition.description,
      prompt: buildSubagentPrompt(definition.id, definition.instructions || ''),
      tools: Object.fromEntries(registeredToolIds.filter((id) => !allowed.has(id)).map((id) => [id, false])),
      permission: { skill: { '*': 'deny' } },
    };
  }
  return profiles;
}

function configureModel(model: string, workspaceDirectory: string, context: AgentToolContext) {
  const info = getModelInfo(model);
  if (!info) throw new Error(`文本模型未在模型目录中配置：${model}`);
  const credential = getModelCredentialStatus(model);
  if (!credential.available) throw new Error(`${credential.message}，Agent 无法启动`);
  const { baseUrl, apiKey } = getProviderCredentials(info.provider);
  const contract = resolveModelRuntimeContract('textGeneration', model, []);
  const agentProtocol = contract?.agent;
  const provider = resolveOpenCodeProvider(
    info.provider,
    baseUrl,
    agentProtocol?.endpoint || contract?.endpoint,
    agentProtocol?.transport,
  );
  const contextLimit = Number(contract?.inputConstraints?.text?.maxTokens || 64_000);
  const outputLimit = Number(contract?.outputConstraints?.maxTokens || 8_192);
  const skills = nativeRuntimeSkills(availableAgentSkills(context.agentId));
  const configuration: OpenCodeConfiguration = {
    tools: [],
    enabledProviders: ['shotloom'],
    model: `shotloom/${model}`,
    agent: agentProfiles(context, skills),
    skills,
    workspaceDirectory,
    runtimeProtection: { ...settingsStore.runtimeProtection },
    shellApproval: settingsStore.agentShellApproval === 'ask' ? 'ask' : 'full',
    provider: {
      'shotloom': {
        name: credential.providerName,
        npm: provider.npm,
        options: { baseURL: provider.baseURL, apiKey, timeout: 300_000 },
        models: {
          [model]: {
            id: info.upstreamModel,
            name: info.name,
            reasoning: false,
            tool_call: true,
            limit: { context: contextLimit, output: outputLimit },
            modalities: { input: ['text', 'image'], output: ['text'] },
            ...(agentProtocol?.requestOptions ? { options: structuredClone(agentProtocol.requestOptions) } : {}),
          },
        },
      },
    },
  } as OpenCodeConfiguration;
  return { configuration, contextLimit, outputLimit };
}

function conversationRecord(conversationId: string): any {
  return (store.project.copilotConversations || []).find((item: any) => String(item.id) === conversationId);
}

function responseData<T>(response: T | { data?: T }): T {
  return ((response as { data?: T })?.data ?? response) as T;
}

function runtimeErrorText(error: unknown) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const value = error as any;
  return String(value?.data?.message || value?.message || value?.error?.message || JSON.stringify(value));
}

async function resolveSession(client: OpenCodeClient, conversationId: string, directory: string, title: string) {
  const conversation = conversationRecord(conversationId);
  const persisted = String(conversation?.openCodeSessionId || '');
  if (persisted) {
    try {
      const session = responseData<any>(await client.session.get({ path: { id: persisted }, query: { directory } }));
      if (session?.id) return session.id;
    } catch {
      // The persisted runtime session was removed; create a clean replacement.
    }
  }
  const session = responseData<any>(await client.session.create({ body: { title }, query: { directory } }));
  if (!session?.id) throw new Error('OpenCode 没有返回 Session ID');
  if (conversation) conversation.openCodeSessionId = session.id;
  return session.id;
}

function textFromParts(parts: Part[] = []) {
  return parts.filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join('');
}

async function promptParts(text: string, attachments: JsonObject[] = []) {
  const images = await resolveImageAttachments(attachments);
  return [
    { type: 'text' as const, text },
    ...images.map((image) => ({ type: 'file' as const, mime: image.mime, filename: image.filename, url: image.url })),
  ];
}

export async function runOpenCodeAgent(
  payload: AgentPromptPayload = {},
  onEvent: (event: AgentRuntimeEvent) => void = () => undefined,
): Promise<AgentRunResult> {
  const requestId = String(payload.requestId || uid('agent'));
  if (activeRuns.size) throw new Error('当前已有 Agent 正在运行，请等待完成或先取消');
  const controller = new AbortController();
  const projectKey = String(payload.projectKey || getAgentProjectKey());
  const projectIdentity = getAgentProjectIdentity();
  const conversationId = String(payload.conversationId || '');
  // 会话记录上的 agentId 决定本轮使用哪个 Agent 定义；未声明的 id 直接失败，
  // 不退回某个默认 Agent，避免错误配置静默获得另一套工具权限。
  const agentId = String(conversationRecord(conversationId)?.agentId || '');
  const agent = agentDefinition(agentId);
  const model = String(payload.model || settingsStore.agentPreferredTextModel || '');
  const directory = String(store.projectDir || '.');
  assertAgentProject(projectKey, projectIdentity.instanceId, projectIdentity.generation);
  const emit = (event: JsonObject & { type: string }) => {
    const runtimeEvent = { ...event, requestId, sessionId: conversationId } as AgentRuntimeEvent;
    appendAgentRuntimeEvent(requestId, conversationId, runtimeEvent, projectKey);
    onEvent(runtimeEvent);
  };
  let lastNativeActivityAt = 0;
  const noteNativeActivity = (finished = false, force = false) => {
    const now = Date.now();
    if (!force && now - lastNativeActivityAt < 2_000) return;
    lastNativeActivityAt = now;
    void invoke('agent_runtime_note_activity', {
      runId: requestId,
      projectKey,
      finished,
    }).catch(() => undefined);
    void invoke('recovery_update_activity', {
      runtimeState: finished ? 'ready' : 'running',
      activeRunId: finished ? '' : requestId,
      activeProjectKey: finished ? '' : projectKey,
      lastError: '',
    }).catch(() => undefined);
  };
  const message = String(payload.message || '').trim();
  const state = new Map<string, unknown>();
  const continuation = payload.continuation as JsonObject | undefined;
  const restoredReceipts = new Map<string, AgentToolReceipt>();
  for (const receipt of (continuation?.toolReceipts as AgentToolReceipt[] | undefined) || []) {
    if (receipt?.callId) restoredReceipts.set(receipt.callId, receipt);
  }
  state.set('successfulToolCallIds', new Set<string>(
    ((continuation?.successfulToolCallIds as string[] | undefined) || []).map(String),
  ));
  state.set('toolReceipts', restoredReceipts);
  if (continuation?.hasAppliedActions === true) state.set('hasAppliedActions', true);
  state.set('expectedCanvasFingerprint', canvasMutationFingerprint(store.project));
  if (continuation?.activeProductionPlanId) {
    state.set('activeProductionPlanId', String(continuation.activeProductionPlanId));
  }
  const toolContext: AgentToolContext = {
    requestId, turnId: `${requestId}:root`, projectKey,
    projectInstanceId: projectIdentity.instanceId,
    projectGeneration: projectIdentity.generation,
    conversationId, agentId,
    signal: controller.signal, loadedSkillIds: new Set<string>(),
    attachments: payload.attachments || [],
    capabilities: { nodeExecution: settingsStore.agentCanRunNodes === true }, state, emit,
  };
  let client: OpenCodeClient;
  let sessionId: string;
  let modelLimits = { contextLimit: 64_000, outputLimit: 8_192 };
  try {
    const tools = await activateOpenCodeToolBridge({ context: toolContext, model });
    const configured = configureModel(model, directory, toolContext);
    configured.configuration.tools = tools;
    modelLimits = configured;
    ({ client } = await runtimeClient(configured.configuration));
    sessionId = await resolveSession(client, conversationId, directory, message.slice(0, 80) || 'Shotloom Agent');
    activeRuns.set(requestId, { controller, client, sessionId });
    emit({
      type: 'run_started', runtime: 'opencode', mode: 'standard', title: message.slice(0, 80) || 'Agent 任务',
      conversationId, model, openCodeSessionId: sessionId, createdAt: new Date().toISOString(),
    });
    emit({ type: 'run_status', status: 'running', createdAt: new Date().toISOString() });
    noteNativeActivity(false, true);
    await invoke('agent_runtime_bind_tool_session', { requestId, sessionId });
  } catch (cause) {
    controller.abort();
    activeRuns.delete(requestId);
    await deactivateOpenCodeToolBridge(requestId);
    const diagnosis = await diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  }
  const childSessions = new Set<string>();
  const assistantMessageIds = new Set<string>();
  const compactionPartIds = new Set<string>();
  const streamedLengths = new Map<string, number>();
  let parentSessionError = '';
  const subscriptionId = uid('opencode-events');
  let unlisten: UnlistenFn | undefined;
  let supervisorUnlisten: UnlistenFn | undefined;
  let runtimeStalled = false;
  try {
    supervisorUnlisten = await listen<JsonObject>('agent-runtime-supervisor', ({ payload: supervised }) => {
      if (String(supervised.runId || '') && String(supervised.runId) !== requestId) return;
      if (supervised.type === 'session_stalled') {
        runtimeStalled = true;
        emit({
          type: 'session_stalled', stalled: true,
          silentMs: Number(supervised.silentMs || 0),
          watchdog: supervised.hardCap === true ? 'hard_cap' : 'no_progress',
          createdAt: new Date().toISOString(),
        });
      } else if (supervised.type === 'runtime_failed') {
        emit({ type: 'runtime_warning', error: String(supervised.error || 'Runtime failed'), createdAt: new Date().toISOString() });
      }
    });
    unlisten = await listen<RuntimeStreamEvent>('agent-runtime-event', ({ payload: streamed }) => {
      if (streamed.subscriptionId !== subscriptionId || controller.signal.aborted) return;
      if (streamed.error) {
        emit({ type: 'runtime_warning', error: streamed.error, createdAt: new Date().toISOString() });
        return;
      }
      const event = streamed.event;
      if (!event) return;
      if (runtimeStalled) {
        runtimeStalled = false;
        emit({ type: 'session_stalled', stalled: false, createdAt: new Date().toISOString() });
      }
      noteNativeActivity();
      if (event.type === 'permission.updated'
        && String((event.properties as any)?.sessionID || '') === sessionId) {
        const permission = (event.properties || {}) as any;
        const permissionId = String(permission.id || permission.permissionID || '');
        if (!permissionId) return;
        const interactionId = `${requestId}:opencode-permission:${permissionId}`;
        const stepId = `opencode:${permissionId}`;
        createAgentInteraction({
          id: interactionId, runId: requestId, conversationId, projectKey,
          kind: 'tool_confirmation',
          payload: {
            toolCallId: String(permission.callID || permissionId), toolName: 'bash', stepId,
            mode: 'opencode_permission', title: String(permission.title || 'Shell 命令需要审批'),
            pendingArgs: { command: String(permission.metadata?.command || permission.title || ''), workdir: directory,
              permission: String(permission.type || 'shell'), pattern: permission.pattern || '*' },
          },
          continuation: { toolCallId: String(permission.callID || permissionId), toolName: 'bash', model, conversationId,
            attachments: payload.attachments || [], nodeMentions: [], successfulToolCallIds: [], toolReceipts: [],
            hasAppliedActions: false, lastActionError: '', modelRounds: 0 },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        });
        emit({ type: 'interaction_requested', interactionId, kind: 'tool_confirmation', toolCallId: String(permission.callID || permissionId),
          stepId, title: String(permission.title || 'Shell 命令需要审批'), pendingArgs: { command: String(permission.metadata?.command || permission.title || ''), workdir: directory }, createdAt: new Date().toISOString() });
        void waitForAgentApproval(requestId, stepId, controller.signal).then(async (resolution) => {
          await client.postSessionIdPermissionsPermissionId({ path: { id: sessionId, permissionID: permissionId }, query: { directory }, body: { response: resolution.approved ? 'once' : 'reject' } });
        }).catch(() => undefined);
        return;
      }
      if (event.type === 'message.updated') {
        const info = event.properties.info;
        if (info.sessionID === sessionId && info.role === 'assistant') assistantMessageIds.add(info.id);
        return;
      }
      if (event.type === 'session.created'
        && (event.properties.info.parentID === sessionId || childSessions.has(String(event.properties.info.parentID || '')))) {
        childSessions.add(event.properties.info.id);
        emit({
          type: 'subagent_started', parentRunId: requestId,
          childSessionId: event.properties.info.id, title: event.properties.info.title,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (event.type === 'session.idle' && childSessions.has(event.properties.sessionID)) {
        emit({ type: 'subagent_completed', parentRunId: requestId, childSessionId: event.properties.sessionID, createdAt: new Date().toISOString() });
        return;
      }
      if (event.type === 'session.error' && event.properties.sessionID && childSessions.has(event.properties.sessionID)) {
        emit({ type: 'subagent_failed', parentRunId: requestId, childSessionId: event.properties.sessionID, error: JSON.stringify(event.properties.error || {}), createdAt: new Date().toISOString() });
        return;
      }
      if (event.type === 'session.error' && event.properties.sessionID === sessionId) {
        parentSessionError = runtimeErrorText(event.properties.error);
        emit({ type: 'runtime_warning', error: parentSessionError, createdAt: new Date().toISOString() });
        return;
      }
      if (event.type === 'session.compacted' && event.properties.sessionID === sessionId) {
        emit({
          type: 'context_compaction', status: 'completed', automatic: true,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (event.type !== 'message.part.updated') return;
      const { part, delta } = event.properties;
      if (part.sessionID === sessionId && part.type === 'compaction') {
        if (!compactionPartIds.has(part.id)) {
          compactionPartIds.add(part.id);
          emit({
            type: 'context_compaction', status: 'running', automatic: part.auto,
            createdAt: new Date().toISOString(),
          });
        }
        return;
      }
      if (part.sessionID === sessionId && part.type === 'tool' && part.tool === 'skill') {
        const skillId = String(part.state.input?.name || '').trim();
        if (part.state.status === 'completed' && skillId && !toolContext.loadedSkillIds.has(skillId)) {
          const skill = availableAgentSkills(agentId).find((item) => item.id === skillId);
          if (skill) {
            toolContext.loadedSkillIds.add(skillId);
            toolContext.state.set('activeSkillId', skillId);
            emit({
              type: 'skill_used', skillId, name: String(skill.name || skillId),
              source: skill.builtIn ? 'built-in' : 'user', createdAt: new Date().toISOString(),
            });
          }
        }
        return;
      }
      if (part.sessionID === sessionId && part.type === 'step-finish') {
        const estimatedTokens = part.tokens.input + part.tokens.output + part.tokens.reasoning
          + part.tokens.cache.read + part.tokens.cache.write;
        const inputBudget = Math.max(1, modelLimits.contextLimit - modelLimits.outputLimit);
        emit({
          type: 'context_usage', estimatedTokens, inputLimit: modelLimits.contextLimit,
          inputBudget, outputReserve: modelLimits.outputLimit, ratio: estimatedTokens / inputBudget,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      if (part.sessionID !== sessionId || part.type !== 'text' || part.synthetic || part.ignored
        || !assistantMessageIds.has(part.messageID)) return;
      if (delta) {
        emit({ type: 'text_delta', turnId: part.messageID, delta });
        streamedLengths.set(part.id, (streamedLengths.get(part.id) || 0) + delta.length);
      } else {
        const previous = streamedLengths.get(part.id) || 0;
        if (part.text.length > previous) emit({ type: 'text_delta', turnId: part.messageID, delta: part.text.slice(previous) });
        streamedLengths.set(part.id, part.text.length);
      }
    });
    await invoke('agent_runtime_subscribe', { subscriptionId, directory });
  } catch (cause) {
    unlisten?.();
    supervisorUnlisten?.();
    controller.abort();
    activeRuns.delete(requestId);
    await deactivateOpenCodeToolBridge(requestId);
    const diagnosis = await diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  }
  try {
    const text = [message, buildRunContextBlock({
      nodeMentions: payload.nodeMentions,
      attachments: payload.attachments,
      planSummary: activeProductionPlanSummary(conversationId),
    })].filter(Boolean).join('\n\n');
    const parts = await promptParts(text, payload.attachments || []);
    const promptSession = async () => {
      const startedAt = Date.now();
      const response = responseData<any>(await client.session.prompt({
        path: { id: sessionId }, query: { directory },
        body: {
          agent: agent.id,
          model: { providerID: 'shotloom', modelID: model },
          system: buildAgentSystemPrompt(toolContext, RUNTIME_MODEL_CONTRACT),
          parts,
        },
        signal: controller.signal,
      }));
      const createdAt = Number(response?.info?.time?.created || 0);
      const isCurrentResponse = response?.info?.role === 'assistant' && createdAt >= startedAt;
      return { response, isCurrentResponse };
    };
    let prompted = await promptSession();
    if (!prompted.isCurrentResponse) {
      const staleSessionId = sessionId;
      const replacement = responseData<any>(await client.session.create({
        body: { title: message.slice(0, 80) || 'Shotloom Agent' },
        query: { directory },
      }));
      if (!replacement?.id) throw new Error('OpenCode 返回了历史回复，且无法创建恢复 Session');
      sessionId = replacement.id;
      await invoke('agent_runtime_bind_tool_session', { requestId, sessionId });
      const conversation = conversationRecord(conversationId);
      if (conversation) conversation.openCodeSessionId = sessionId;
      activeRuns.set(requestId, { controller, client, sessionId });
      assistantMessageIds.clear();
      streamedLengths.clear();
      parentSessionError = '';
      emit({
        type: 'runtime_warning',
        error: `Runtime Session ${staleSessionId} 返回了历史回复，已切换到干净 Session 重试`,
        createdAt: new Date().toISOString(),
      });
      prompted = await promptSession();
    }
    if (!prompted.isCurrentResponse) throw new Error('OpenCode 没有生成与本轮用户消息对应的新回复');
    const response = prompted.response;
    if (response?.info?.finish === 'length') {
      throw new Error('Agent 达到本轮输出上限，尚未完成工具调用');
    }
    const responseError = runtimeErrorText(response?.info?.error || response?.error);
    if (responseError || parentSessionError) throw new Error(responseError || parentSessionError);
    let outcome = state.get('verifiedOutcome') as JsonObject | undefined;
    let reply = textFromParts(response?.parts || []) || String(outcome?.summary || '');
    if (state.get('hasAppliedActions') === true && !outcome) {
      const receipts = state.get('toolReceipts') as Map<string, AgentToolReceipt>;
      const writeCallIds = [...receipts.values()]
        .filter((receipt) => receipt.applied)
        .map((receipt) => receipt.callId);
      outcome = {
        status: 'partial',
        summary: reply || '项目操作已经执行，但 Agent 没有提交完整终态说明。',
        evidence: { toolCallIds: writeCallIds },
        remaining: ['需要根据当前画布和任务状态补充最终核验'],
      };
    }
    if (!reply) {
      throw new Error('模型返回了 0 token 空响应；请检查文本模型 endpoint 与 OpenAI-compatible 流式响应格式');
    }
    const outcomeStatus = String(outcome?.status || 'completed');
    const runStatus = outcomeStatus === 'partial' || outcomeStatus === 'blocked' ? outcomeStatus : 'completed';
    emit({ type: 'run_status', status: runStatus, outcome, createdAt: new Date().toISOString() });
    return {
      requestId, reply, model, toolCallCount: (state.get('successfulToolCallIds') as Set<string>).size,
      openCodeSessionId: sessionId, outcome,
    };
  } catch (cause) {
    const aborted = controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError');
    if (aborted) {
      emit({ type: 'run_status', status: 'cancelled', error: cause instanceof Error ? cause.message : String(cause), createdAt: new Date().toISOString() });
      throw cause;
    }
    const diagnosis = await diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  } finally {
    controller.abort();
    await invoke('agent_runtime_unsubscribe', { subscriptionId }).catch(() => undefined);
    unlisten?.();
    supervisorUnlisten?.();
    noteNativeActivity(true, true);
    activeRuns.delete(requestId);
    await deactivateOpenCodeToolBridge(requestId);
  }
}

export async function abortOpenCodeAgent(requestId: string): Promise<boolean> {
  const run = activeRuns.get(requestId);
  if (!run) return false;
  run.controller.abort();
  await run.client.session.abort({ path: { id: run.sessionId } }).catch(() => undefined);
  return true;
}

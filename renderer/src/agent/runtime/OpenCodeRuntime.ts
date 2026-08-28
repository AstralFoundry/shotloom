import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createOpencodeClient, type Event, type Part } from '@opencode-ai/sdk/client';
import { getModelInfo, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { assertAgentProject, getAgentProjectIdentity, getAgentProjectKey } from '@/services/agentProjectIdentity';
import { desktopApi } from '@/services/desktopApi';
import { store } from '@/store/projectStore';
import { getModelCredentialStatus, getProviderCredentials, settingsStore } from '@/store/settingsStore';
import { availableAgentSkills } from '../tools/catalogTools';
import { contractsForAgentType, formatContractsBlock } from '../content/contractLoader';
import systemBasePrompt from '../content/prompts/system-base.md?raw';
import { appendAgentRuntimeEvent } from './runStore';
import { activateOpenCodeToolBridge, deactivateOpenCodeToolBridge } from './OpenCodeToolBridge';
import { activeProductionPlan } from './productionPlanStore';
import { diagnoseRuntimeFailure, RuntimeDiagnosticError } from './runtimeDiagnostics';
import { resolveOpenCodeProvider } from './openCodeProvider.mjs';
import type { AgentPromptPayload, AgentRunResult, AgentRuntimeEvent, AgentToolContext, AgentToolReceipt, JsonObject } from '../core/types';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';
import { nativeRuntimeSkills, type NativeRuntimeSkill } from './nativeSkills';

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;
interface OpenCodeConfiguration {
  enabledProviders: string[];
  model: string;
  provider: JsonObject;
  agent: JsonObject;
  skills: NativeRuntimeSkill[];
  workspaceDirectory: string;
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

function agentProfiles(skillIds: string[]) {
  const primarySkillPermission = Object.fromEntries([
    ['*', 'deny'],
    ...skillIds.map((skillId) => [skillId, 'allow']),
  ]);
  const primaryOnlyTools = {
    shotloom_request_clarification: false,
    shotloom_report_outcome: false,
    shotloom_save_skill_bundle: false,
  };
  const canvasReadonlyTools = {
    ...primaryOnlyTools,
    shotloom_canvas_create_node: false,
    shotloom_canvas_update_node: false,
    shotloom_canvas_connect_nodes: false,
    shotloom_canvas_layout_nodes: false,
    shotloom_canvas_delete_node: false,
    shotloom_canvas_update_edge: false,
    shotloom_canvas_start_generation: false,
    shotloom_undo_canvas: false,
    shotloom_redo_canvas: false,
  };
  const analysisTools = {
    ...canvasReadonlyTools,
    shotloom_plan_write: false,
    shotloom_plan_patch_stage: false,
    shotloom_plan_update_stage_state: false,
  };
  const shared = (profile: string) => formatContractsBlock(contractsForAgentType(profile));
  return {
    'shotloom': {
      mode: 'primary', maxSteps: 80,
      description: 'Shotloom creative workspace agent',
      prompt: systemPrompt(),
      permission: {
        edit: 'deny', bash: 'deny', external_directory: 'deny', webfetch: 'deny',
        skill: primarySkillPermission,
      },
    },
    'production-planner': {
      mode: 'subagent', maxSteps: 40,
      description: 'Author complete Production Plan work items, prompts, dependencies and completion criteria',
      prompt: `Author a Production Plan for the requested scope. Use the Active Skill and its constraints supplied by the parent task. Do not mutate the canvas or claim completion.\n\n${shared('production-planner')}`,
      tools: { ...canvasReadonlyTools, shotloom_save_skill_bundle: false },
      permission: { skill: { '*': 'deny' } },
    },
    'stage-executor': {
      mode: 'subagent', maxSteps: 60,
      description: 'Compile and execute the current Production Plan stage',
      prompt: `Execute the requested stage using the Active Skill and constraints supplied by the parent task. Respect real dependencies and return exact receipts.\n\n${shared('stage-executor')}`,
      tools: primaryOnlyTools,
      permission: { skill: { '*': 'deny' } },
    },
    'result-reviewer': {
      mode: 'subagent', maxSteps: 24,
      description: 'Verify outcomes, constraints, artifacts and canvas state',
      prompt: `Verify using read tools and tool receipts. Never modify the canvas.\n\n${shared('result-reviewer')}`,
      tools: analysisTools,
      permission: { skill: { '*': 'deny' } },
    },
  };
}

function configureModel(model: string, workspaceDirectory: string) {
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
  const skills = nativeRuntimeSkills(availableAgentSkills());
  const configuration: OpenCodeConfiguration = {
    enabledProviders: ['shotloom'],
    model: `shotloom/${model}`,
    agent: agentProfiles(skills.map((skill) => skill.id)),
    skills,
    workspaceDirectory,
    runtimeProtection: { ...settingsStore.runtimeProtection },
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

function systemPrompt() {
  const canRunNodes = settingsStore.agentCanRunNodes === true;
  const contracts = formatContractsBlock(contractsForAgentType('shotloom'));
  const base = systemBasePrompt
    .replace('{{mode_contract}}', canRunNodes
      ? '画布写入遵守本地策略；设置已允许 Agent 运行节点。复杂制作的范围和执行阶段由 Agent 根据用户完整语义与真实依赖管理。'
      : '画布可按用户要求创建和配置节点；“允许 Agent 运行节点”已关闭，任何生成任务都会在统一权限边界被拒绝。')
    .replace('{{runtime_model_contract}}', '模型循环、会话、上下文压缩与子 Agent 由 OpenCode Runtime 管理。');
  return [
    base,
    'Use Shotloom MCP tools for every canvas, project, task, model-catalog, Skill, or media operation.',
    'For a non-trivial production request, inspect runtime capabilities first. Decide production scope from the full user message. If the scope is genuinely unresolved, use request_clarification and formulate the question and options for the actual context. Do not ask again when the user has already stated the scope clearly. Never infer execution merely because the user pasted a complete script.',
    'A plan_canvas request means creating every determinable, configured canvas node and its real input edges without starting generation. A note describing omitted media nodes is not a canvas plan. A plan_and_execute request runs one dependency stage at a time and verifies actual outputs before continuing.',
    'Keep the Production Plan current. Bind every work item to its own real node/task runtime reference; never mark a stage done from an unrelated summary node.',
    'The newest user message is the current request. An unfinished question or rejected action from an earlier turn is context, not permission to replace the newest request.',
    'Never claim that an operation succeeded without a successful tool receipt.',
    'Use production-planner, stage-executor, or result-reviewer only for their named bounded responsibility. The primary agent owns Skill selection, user interaction and stage lifecycle.',
    'When delegating, include the selected Active Skill id and the relevant Skill constraints in the child task. Subagents must return their findings to the parent; only the parent addresses the user.',
    canRunNodes
      ? 'Node execution is enabled. Execute according to the user request and real dependencies without asking for duplicate stage approval.'
      : 'Node execution is disabled. You may create and configure nodes, but must not claim to have run them.',
    'If the run changes the project, canvas, or starts a task, call report_outcome with verifiable evidence before finishing. Every tool result returns toolCallId; copy those exact ids into evidence.toolCallIds and never use tool names as ids.',
    'For a conversational or explanatory answer that makes no project change, answer directly without report_outcome.',
    contracts,
  ].filter(Boolean).join('\n\n');
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

async function ensureMcpConnected(client: OpenCodeClient, directory: string) {
  const readStatus = async () => {
    const statuses = responseData<any>(await client.mcp.status({ query: { directory } }));
    return statuses?.shotloom;
  };
  const waitForConnection = async () => {
    let status = await readStatus();
    for (let attempt = 0; attempt < 4 && status?.status === 'connecting'; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      status = await readStatus();
    }
    return status;
  };

  let status = await readStatus();
  if (status?.status === 'connected') return;
  await client.mcp.connect({ path: { name: 'shotloom' }, query: { directory } });
  status = await waitForConnection();
  if (status?.status === 'connected') return;

  // OpenCode 会保留一次 tools/list 失败后的 MCP client。只重建这个已失败的
  // 本地连接，避免用户点击“重试”时继续命中同一个 failed client。
  if (status?.status === 'failed') {
    await client.mcp.disconnect({ path: { name: 'shotloom' }, query: { directory } })
      .catch(() => undefined);
    await client.mcp.connect({ path: { name: 'shotloom' }, query: { directory } });
    status = await waitForConnection();
  }
  if (status?.status !== 'connected') {
    throw new Error(`Shotloom 工具桥连接失败：${status?.error || status?.status || '未知状态'}`);
  }
}

function textFromParts(parts: Part[] = []) {
  return parts.filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join('');
}

function attachmentString(attachment: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = attachment[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function attachmentMime(attachment: JsonObject) {
  const declared = attachmentString(attachment, 'mimeType', 'mime');
  if (declared) return declared;
  const source = attachmentString(attachment, 'fileName', 'name', 'filePath', 'path', 'url').toLowerCase();
  const extensionMimes: Record<string, string> = {
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
  };
  return Object.entries(extensionMimes).find(([extension]) => source.split(/[?#]/)[0].endsWith(extension))?.[1] || '';
}

function arrayBufferDataUrl(buffer: ArrayBuffer, mime: string) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function promptParts(text: string, attachments: JsonObject[] = []) {
  const parts: Array<
    { type: 'text'; text: string }
    | { type: 'file'; mime: string; filename: string; url: string }
  > = [{ type: 'text', text }];
  for (const attachment of attachments) {
    const mime = attachmentMime(attachment);
    if (!mime.startsWith('image/')) continue;
    const filename = attachmentString(attachment, 'fileName', 'name') || 'attachment';
    const remoteUrl = attachmentString(attachment, 'url');
    if (/^(?:data:|https?:\/\/)/i.test(remoteUrl)) {
      parts.push({ type: 'file', mime, filename, url: remoteUrl });
      continue;
    }
    const filePath = attachmentString(attachment, 'filePath', 'path');
    if (!filePath) continue;
    const buffer = await desktopApi.file.readArrayBuffer(filePath);
    if (!buffer?.byteLength) throw new Error(`无法读取附件：${filename}`);
    parts.push({ type: 'file', mime, filename, url: arrayBufferDataUrl(buffer, mime) });
  }
  return parts;
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
    conversationId,
    signal: controller.signal, loadedSkillIds: new Set<string>(),
    attachments: payload.attachments || [],
    capabilities: { nodeExecution: settingsStore.agentCanRunNodes === true }, state, emit,
  };
  let client: OpenCodeClient;
  let sessionId: string;
  let modelLimits = { contextLimit: 64_000, outputLimit: 8_192 };
  try {
    const configured = configureModel(model, directory);
    modelLimits = configured;
    ({ client } = await runtimeClient(configured.configuration));
    sessionId = await resolveSession(client, conversationId, directory, message.slice(0, 80) || 'Shotloom Agent');
    activeRuns.set(requestId, { controller, client, sessionId });
    emit({
      type: 'run_started', mode: 'standard', title: message.slice(0, 80) || 'Agent 任务',
      conversationId, model, openCodeSessionId: sessionId, createdAt: new Date().toISOString(),
    });
    emit({ type: 'run_status', status: 'running', createdAt: new Date().toISOString() });
    noteNativeActivity(false, true);
    await activateOpenCodeToolBridge({ context: toolContext, model });
    await ensureMcpConnected(client, directory);
  } catch (cause) {
    controller.abort();
    activeRuns.delete(requestId);
    deactivateOpenCodeToolBridge(requestId);
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
          const skill = availableAgentSkills().find((item) => item.id === skillId);
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
    deactivateOpenCodeToolBridge(requestId);
    const diagnosis = await diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  }
  try {
    const existingPlan = activeProductionPlan(conversationId);
    const planSummary = existingPlan ? {
      id: existingPlan.id,
      revision: existingPlan.revision,
      title: existingPlan.title,
      goal: existingPlan.goal,
      executionMode: existingPlan.executionMode,
      stages: existingPlan.stages.map((stage) => ({ id: stage.id, title: stage.title, status: stage.status })),
    } : undefined;
    const contextSuffix = [
      payload.nodeMentions?.length ? `Mentioned nodes: ${JSON.stringify(payload.nodeMentions)}` : '',
      payload.attachments?.length ? `Attachments: ${JSON.stringify(payload.attachments)}` : '',
      planSummary ? `Existing Production Plan candidate; continue it only if the newest request is genuinely related: ${JSON.stringify(planSummary)}` : '',
    ].filter(Boolean).join('\n');
    const text = [message, contextSuffix].filter(Boolean).join('\n\n');
    const parts = await promptParts(text, payload.attachments || []);
    const promptSession = async () => {
      const startedAt = Date.now();
      const response = responseData<any>(await client.session.prompt({
        path: { id: sessionId }, query: { directory },
        body: {
          agent: 'shotloom',
          model: { providerID: 'shotloom', modelID: model },
          system: systemPrompt(),
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
      sessionMessages: [], openCodeSessionId: sessionId, outcome,
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
    deactivateOpenCodeToolBridge(requestId);
  }
}

export async function abortOpenCodeAgent(requestId: string): Promise<boolean> {
  const run = activeRuns.get(requestId);
  if (!run) return false;
  run.controller.abort();
  await run.client.session.abort({ path: { id: run.sessionId } }).catch(() => undefined);
  return true;
}

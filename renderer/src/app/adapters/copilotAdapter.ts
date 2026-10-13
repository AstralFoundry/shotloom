import { abortAgent, runAgent } from "../../agent";
import { EDITOR_AGENT_ID } from "../../agent/agents/definitions";
import {
  resolveClarification,
  resolveToolConfirmation,
} from "../copilot/agentInteractionCoordinator";
import { listAgentInteractions } from "../../agent/runtime/runStore";
import { getModelInfo } from "../../domain/catalog/ModelCatalog";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.js";
import { getAgentProjectKey } from "../../services/agentProjectIdentity";
import {
  canvasCopilotConversation,
  clearCopilotConversation,
  createCopilotConversation,
  deleteCopilotConversation,
  editorCopilotConversation,
  getActiveCopilotConversation,
  scopedCopilotConversations,
  switchCopilotConversation,
  titleConversationFromMessage,
} from "../../services/copilotConversations.mjs";
import { store, touchProject } from "../../store/projectStore";
import {
  getAvailableAgentModelCatalog,
  saveAppSettings,
  settingsStore,
} from "../../store/settingsStore";
import { uid } from "../../utils/format";
import type { AgentController, AgentMessage } from "../agent-chat/contracts";
import type { AgentReference } from "../agent-chat/mediaReference";
import { CopilotRuntimePresenter } from "../copilot/CopilotRuntimePresenter";
import { showToast } from "../store/overlayStore";
import { focusCanvasNodes } from "./canvasAdapter";
import { toRaw } from "../../store/domainReactivity.js";
import { recordPerformanceMetric } from "../../services/performanceMetrics";
import {
  compactInactiveCopilotSessions,
  dropCopilotSessionArchive,
  restoreCopilotSession,
} from "../../services/copilotSessionLifecycle.mjs";

type Loose = Record<string, any>;
type CopilotSendPayload = {
  text: string;
  model: string;
  attachments: unknown[];
  nodeMentions: unknown[];
  references?: AgentReference[];
  conversationId?: string;
};
type AgentResume = {
  conversationId: string;
  payload: CopilotSendPayload & {
    continuation: Loose;
  };
};
const listeners = new Set<() => void>();
const MAX_QUEUED_DELIVERIES = 3;
let busy = false;
let activeRequestId = "";
let revision = 0;
let deliveryProcessing = false;
type Delivery = {
  clientMessageId: string;
  payload: CopilotSendPayload;
  resume?: AgentResume;
  skipUserMessage: boolean;
  conversationId: string;
  project: Loose;
  projectKey: string;
  userMessageId?: string;
};
const deliveryQueue: Delivery[] = [];
let textModelConfigSource: object | null = null;
let cachedTextModels: Array<{ id: string; label: string; iconId: string }> = [];
const notify = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};
export const subscribeCopilot = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getCopilotRevision = () => revision;
export function maintainCopilotSessionMemory() {
  const startedAt = performance.now();
  const result = compactInactiveCopilotSessions(toRaw(store.project));
  if (result.compacted) {
    recordPerformanceMetric("copilot.sessions.compact", startedAt, result);
    notify();
  }
  return result;
}
function active() {
  return getActiveCopilotConversation(store.project) as Loose;
}
function conversationById(conversationId: string) {
  if (!conversationId) return null;
  return ((store.project.copilotConversations || []) as Loose[]).find(
    (item) => String(item.id) === conversationId,
  ) || null;
}
function availableTextModels() {
  const source = toRaw(settingsStore.providerConfigs) as object;
  if (source === textModelConfigSource) return cachedTextModels;
  textModelConfigSource = source;
  const catalog = getAvailableAgentModelCatalog();
  cachedTextModels = (
    catalog.find((item: Loose) => item.type === "textGeneration")?.models || []
  ).map((model: Loose) => ({
    id: model.id,
    label: model.name || getModelInfo(model.id)?.name || model.id,
    iconId: resolveProviderIconId(model.provider, model.id, model.iconId),
  }));
  return cachedTextModels;
}
function pushMessage(message: Loose, targetConversation?: Loose) {
  const conversation = targetConversation || (toRaw(active()) as Loose);
  if (!busy) {
    conversation.messages = conversation.messages.filter((item: Loose) => !item.transient);
  }
  const id = String(message.id || uid());
  conversation.messages.push({
    id,
    createdAt: new Date().toISOString(),
    ...message,
  });
  if (message.role === "user") {
    titleConversationFromMessage(conversation, message.content);
  }
  conversation.updatedAt = new Date().toISOString();
  touchProject();
  notify();
  return id;
}
function pushTyping(targetConversation?: Loose) {
  const id = uid();
  const conversation = toRaw(targetConversation || active()) as Loose;
  conversation.messages.push({
    id,
    role: "assistant",
    title: "助手正在处理",
    content: "",
    typing: true,
    transient: true,
    createdAt: new Date().toISOString(),
  });
  notify();
  return id;
}
function patchMessage(id: string, patch: Loose, targetConversation?: Loose) {
  const conversation = toRaw(targetConversation || active()) as Loose;
  const item = conversation.messages.find((message: Loose) => message.id === id);
  if (item) Object.assign(item, patch);
  notify();
}
function finalizeMessage(id: string, patch: Loose, targetConversation?: Loose) {
  const conversation = toRaw(targetConversation || active()) as Loose;
  const item = conversation.messages.find((message: Loose) => message.id === id);
  if (!item) return pushMessage(patch, conversation);
  Object.assign(item, patch, {
    id: item.id,
    createdAt: item.createdAt,
    typing: false,
    transient: false,
  });
  conversation.updatedAt = new Date().toISOString();
  touchProject();
  notify();
}

function patchConversationMessage(conversationId: string, id: string, patch: Loose) {
  const conversation = (store.project.copilotConversations || [])
    .find((item: Loose) => String(item.id || "") === conversationId);
  const message = conversation?.messages?.find((item: Loose) => item.id === id);
  if (!message) return;
  Object.assign(message, patch);
  conversation.updatedAt = new Date().toISOString();
  touchProject({ sessionDelay: 100, coalesceSession: true });
  notify();
}

export function copilotData(scope: 'canvas' | 'editor' = 'canvas', editorNodeId = '') {
  const scoped = scopedCopilotConversations(store.project, scope, editorNodeId) as Loose[];
  const conversation = scope === 'editor'
    ? editorCopilotConversation(store.project, editorNodeId)
    : canvasCopilotConversation(store.project);
  const interactionList = listAgentInteractions();
  const interactions = new Map(interactionList.map((item) => [item.id, item]));
  for (const message of conversation.messages as Loose[]) {
    for (const tool of message.toolCalls || []) {
      const interaction = interactions.get(String(tool.interactionId || ""));
      if (interaction && interaction.status !== "pending") {
        tool.pending = false;
        tool.status = interaction.status === "expired" ? "error" : tool.status;
      }
    }
    for (const clarification of message.clarifications || []) {
      const interaction = interactions.get(String(clarification.interactionId || ""));
      if (interaction && interaction.status !== "pending") {
        clarification.answered = true;
        clarification.expired = interaction.status === "expired";
      }
    }
  }
  const textModels = availableTextModels();
  const configured = settingsStore.agentPreferredTextModel;
  return {
    messages: conversation.messages as AgentMessage[],
    conversations: scoped.map((item: Loose) => {
      const pending = interactionList.filter(
        (interaction) =>
          interaction.conversationId === String(item.id) && interaction.status === "pending",
      );
      return {
        id: item.id,
        editorNodeId: item.editorNodeId,
        title: item.title,
        updatedAt: item.updatedAt,
        pendingInteractionCount: pending.length,
        waitingKind: pending.some((interaction) => interaction.kind === "question")
          ? "question"
          : pending.length
            ? "tool_confirmation"
            : "",
      };
    }),
    // 列表与高亮必须来自同一作用域解析结果，否则抽屉会把另一个作用域的会话 id 当作选中项。
    activeConversationId: String(conversation.id || ""),
    busy,
    textModel: textModels.some((item: Loose) => item.id === configured)
      ? configured
      : textModels[0]?.id || "",
    textModels,
  };
}

async function send(
  payload: CopilotSendPayload,
  resume?: AgentResume,
  options: { skipUserMessage?: boolean; delivery?: Delivery } = {},
) {
  const project = options.delivery?.project || store.project;
  const projectKey = options.delivery?.projectKey || getAgentProjectKey();
  const requestedConversationId = String(payload.conversationId || "");
  const conversation = conversationById(requestedConversationId) || active();
  if (resume && String(conversation.id || "") !== resume.conversationId) {
    showToast("待续跑的 Agent 属于另一个对话，请先切换回原对话");
    return;
  }
  const messageText = payload.text.trim() || "请结合我选择的节点和附件继续处理。";
  if (!resume && !options.skipUserMessage) {
    pushMessage({
      role: "user",
      title: "你的消息",
      content: messageText,
      references: [...(payload.references || [])],
    }, conversation);
  }
  const typingId = pushTyping(conversation);
  const presentation = new CopilotRuntimePresenter();
  let timer = 0;
  let pendingPatch: Loose = {};
  let pendingContextUsage: Loose | null = null;
  let pendingEventCount = 0;
  let batchStartedAt = 0;
  const flush = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    if (!pendingEventCount && !Object.keys(pendingPatch).length && !pendingContextUsage) return;
    const startedAt = batchStartedAt || performance.now();
    if (pendingContextUsage) (toRaw(conversation) as Loose).contextUsage = pendingContextUsage;
    patchMessage(typingId, {
      content: presentation.streamed,
      typing: true,
      ...pendingPatch,
    }, conversation);
    recordPerformanceMetric("copilot.stream.flush", startedAt, {
      eventCount: pendingEventCount,
      contentLength: presentation.streamed.length,
      toolCount: presentation.tools.length,
    });
    pendingPatch = {};
    pendingContextUsage = null;
    pendingEventCount = 0;
    batchStartedAt = 0;
  };
  const schedule = () => {
    if (!batchStartedAt) batchStartedAt = performance.now();
    pendingEventCount += 1;
    if (!timer) timer = window.setTimeout(flush, 32);
  };
  const stopTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  try {
    if (options.delivery?.userMessageId) {
      patchConversationMessage(options.delivery.conversationId, options.delivery.userMessageId, {
        deliveryStage: "sent",
      });
    }
    const result = await runAgent(
      {
        message: messageText,
        model: payload.model,
        attachments: payload.attachments as Loose[],
        nodeMentions: payload.nodeMentions as Loose[],
        continuation: resume?.payload.continuation,
        projectKey,
        conversationId: conversation.id,
      } as any,
      (event: Loose) => {
        if (event.type === "run_started") {
          activeRequestId = String(event.requestId || "");
          if (options.delivery?.userMessageId) {
            patchConversationMessage(options.delivery.conversationId, options.delivery.userMessageId, {
              deliveryStage: "started",
              requestId: activeRequestId,
            });
          }
        }
        if (store.project !== project || getAgentProjectKey() !== projectKey) return;
        const effect = presentation.consume(event);
        let shouldSchedule = effect.textChanged === true;
        if (effect.contextUsage) {
          pendingContextUsage = effect.contextUsage;
          shouldSchedule = true;
        }
        if (effect.messagePatch) {
          pendingPatch = { ...pendingPatch, ...effect.messagePatch };
          shouldSchedule = true;
        }
        if (shouldSchedule) schedule();
        if (effect.persist) {
          flush();
          touchProject();
        }
      },
    );
    if (store.project !== project || getAgentProjectKey() !== projectKey) {
      return;
    }
    conversation.contextUsage = result?.contextUsage || conversation.contextUsage || null;
    conversation.updatedAt = new Date().toISOString();
    if (options.delivery?.userMessageId) {
      patchConversationMessage(options.delivery.conversationId, options.delivery.userMessageId, {
        deliveryStage: "completed",
      });
    }
    flush();
    finalizeMessage(typingId, {
      role: "assistant",
      title: "画布助手",
      content: presentation.streamed || result?.reply || "Agent 已完成本轮处理。",
      ...presentation.snapshot(),
      requestId: result?.requestId || "",
    }, conversation);
  } catch (cause: any) {
    if (store.project === project && getAgentProjectKey() === projectKey) {
      flush();
      const error = String(cause?.message || cause || "未知错误");
      const cancelled = /abort|cancel/i.test(error);
      const diagnosis = cause?.diagnosis as Loose | undefined;
      if (options.delivery?.userMessageId) {
        patchConversationMessage(options.delivery.conversationId, options.delivery.userMessageId, {
          deliveryStage: cancelled ? "cancelled" : "failed",
          deliveryError: cancelled ? "" : error,
        });
      }
      finalizeMessage(typingId, {
        role: "assistant",
        title: cancelled ? "已停止" : "运行失败",
        content: presentation.streamed || (cancelled ? "已停止当前任务。" : ""),
        ...(cancelled
          ? {}
          : {
              error: diagnosis?.title ? `${diagnosis.title}：${diagnosis.message}` : `Agent 运行失败：${error}`,
              diagnosis,
              retryable: true,
              ...(diagnosis?.retryable === false ? { retryable: false } : {}),
              retryPayload: {
                text: payload.text,
                model: payload.model,
                attachments: [...payload.attachments],
                nodeMentions: [...payload.nodeMentions],
              },
            }),
        ...presentation.snapshot({ toolCalls: presentation.failRunningTools() }),
      }, conversation);
    }
  } finally {
    stopTimer();
    activeRequestId = "";
  }
}

function enqueueDelivery(
  payload: CopilotSendPayload,
  resume?: AgentResume,
  options: { skipUserMessage?: boolean; priority?: boolean } = {},
): boolean {
  if (!resume && !options.skipUserMessage && (busy || deliveryProcessing || deliveryQueue.length)) {
    return false;
  }
  if (deliveryQueue.length >= MAX_QUEUED_DELIVERIES) {
    showToast("待续任务过多，请等待当前任务结束");
    return false;
  }
  const project = store.project as Loose;
  const projectKey = getAgentProjectKey();
  // 面板发送必须显式带上目标会话；只有续跑/重试这类没有面板上下文的投递才回退到项目级活动会话。
  const conversation = conversationById(String(payload.conversationId || "")) || active();
  const clientMessageId = uid();
  const messageText = payload.text.trim() || "请结合我选择的节点和附件继续处理。";
  const userMessageId = !resume && !options.skipUserMessage
    ? pushMessage({
        role: "user",
        title: "你的消息",
        content: messageText,
        clientMessageId,
        deliveryStage: "sent",
        references: [...(payload.references || [])],
      }, conversation)
    : undefined;
  const delivery: Delivery = {
    clientMessageId,
    payload: {
      ...payload,
      conversationId: String(conversation.id || ""),
      attachments: [...payload.attachments],
      nodeMentions: [...payload.nodeMentions],
    },
    resume,
    skipUserMessage: true,
    conversationId: String(conversation.id || ""),
    project,
    projectKey,
    userMessageId,
  };
  if (options.priority) deliveryQueue.unshift(delivery);
  else deliveryQueue.push(delivery);
  notify();
  void drainDeliveries();
  return true;
}

async function drainDeliveries() {
  if (deliveryProcessing) return;
  deliveryProcessing = true;
  busy = true;
  notify();
  try {
    while (deliveryQueue.length) {
      const delivery = deliveryQueue.shift()!;
      notify();
      if (store.project !== delivery.project || getAgentProjectKey() !== delivery.projectKey) {
        if (delivery.userMessageId) {
          patchConversationMessage(delivery.conversationId, delivery.userMessageId, {
            deliveryStage: "failed",
            deliveryError: "消息所属项目已经切换",
          });
        }
        continue;
      }
      await send(delivery.payload, delivery.resume, {
        skipUserMessage: delivery.skipUserMessage,
        delivery,
      });
    }
  } finally {
    deliveryProcessing = false;
    busy = false;
    activeRequestId = "";
    notify();
  }
}

export const copilotController: AgentController = {
  openVideoEditorConversation: (nodeId: string) => {
    if (busy) return;
    const existing = (store.project.copilotConversations || []).find(
      (item: Loose) => item.editorNodeId === nodeId,
    );
    if (existing) {
      restoreCopilotSession(toRaw(store.project), String(existing.id));
      switchCopilotConversation(store.project, String(existing.id));
    } else {
      const conversation = createCopilotConversation(store.project, { title: "剪辑 Agent", agentId: EDITOR_AGENT_ID });
      (conversation as Loose).editorNodeId = nodeId;
    }
    touchProject();
    notify();
  },
  send: (payload) => {
    // 共享 controller 的 send 只服务画布面板；剪辑面板会覆盖 send 并自带剪辑会话。
    // 缺省目标固定为画布作用域的活动会话，不跟随项目级 active 指针，否则画布消息会被写进剪辑会话。
    return enqueueDelivery({
      ...payload,
      conversationId: payload.conversationId
        || String(canvasCopilotConversation(store.project).id || ""),
    });
  },
  close: () => {},
  cancel: () => {
    if (!activeRequestId) return;
    void abortAgent(activeRequestId).then((cancelled) => {
      if (cancelled) showToast("正在停止 Agent");
    });
  },
  retry: (messageId) => {
    if (busy) return;
    // 重试必须回到失败消息所属的会话：项目级 active 可能停在另一个作用域。
    const conversation = ((store.project.copilotConversations || []) as Loose[]).find((item) =>
      (item.messages || []).some((message: Loose) => message.id === messageId),
    );
    const message = (conversation?.messages || []).find((item: Loose) => item.id === messageId);
    if (!message?.retryable || !message.retryPayload) {
      showToast("这条失败消息没有可用的重试信息");
      return;
    }
    message.retryable = false;
    touchProject();
    notify();
    enqueueDelivery(
      {
        text: String(message.retryPayload.text || ""),
        model: String(message.retryPayload.model || ""),
        attachments: [...(message.retryPayload.attachments || [])],
        nodeMentions: [...(message.retryPayload.nodeMentions || [])],
        conversationId: String(conversation?.id || ""),
      },
      undefined,
      { skipUserMessage: true },
    );
  },
  clear: (conversationId?: string) => {
    const target = String(conversationId || "")
      || String(canvasCopilotConversation(store.project).id || "");
    if (
      listAgentInteractions({ pendingOnly: true }).some(
        (item) => item.conversationId === target,
      )
    ) {
      showToast("当前对话仍有问题或操作等待处理，完成后才能清空");
      return;
    }
    clearCopilotConversation(store.project, target);
    touchProject();
    notify();
    showToast("当前 Copilot 对话上下文已清空");
  },
  newConversation: (editorNodeId?: string) => {
    if (busy) return;
    const nodeId = String(editorNodeId || "");
    const conversation = createCopilotConversation(
      store.project,
      nodeId ? { title: "剪辑 Agent" } : {},
    );
    if (nodeId) (conversation as Loose).editorNodeId = nodeId;
    touchProject();
    notify();
    showToast(nodeId ? "已新建剪辑对话" : "已新建项目对话");
  },
  selectConversation: (id) => {
    if (!busy) restoreCopilotSession(toRaw(store.project), id);
    if (!busy && switchCopilotConversation(store.project, id)) {
      touchProject();
      notify();
      maintainCopilotSessionMemory();
    }
  },
  deleteConversation: (id) => {
    if (listAgentInteractions({ pendingOnly: true }).some((item) => item.conversationId === id)) {
      showToast("这个会话仍有问题或操作等待处理，完成后才能删除");
      return;
    }
    if (!busy && deleteCopilotConversation(store.project, id)) {
      dropCopilotSessionArchive(String(store.project.id || ''), id);
      touchProject();
      notify();
      showToast("会话已删除");
    }
  },
  changeModel: (model) => {
    void saveAppSettings({ agentPreferredTextModel: model }).then(notify);
  },
  submitClarification: (payload: unknown) => {
    const value = payload as Loose;
    try {
      const resolution = resolveClarification(
        String(value?.interactionId || ""),
        Array.isArray(value?.answers) ? value.answers : [],
        value?.skipped === true,
        !busy,
      );
      if (resolution.resume) enqueueDelivery(resolution.resume.payload, resolution.resume, { skipUserMessage: true, priority: true });
      notify();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : String(cause));
    }
  },
  approveToolCall: (payload: unknown) => {
    const value = payload as Loose;
    const interactionId = String(value.interactionId || "");
    if (!interactionId) return;
    const modifiedArgs = value.modifiedArgs && typeof value.modifiedArgs === "object"
      ? (value.modifiedArgs as Record<string, unknown>)
      : undefined;
    void resolveToolConfirmation(interactionId, true, !busy, modifiedArgs)
      .then((resolution) => {
        if (resolution.resume) enqueueDelivery(resolution.resume.payload, resolution.resume, { skipUserMessage: true, priority: true });
        notify();
      })
      .catch((cause) => showToast(cause instanceof Error ? cause.message : String(cause)));
  },
  rejectToolCall: (payload: unknown) => {
    const value = payload as Loose;
    const interactionId = String(value.interactionId || "");
    if (!interactionId) return;
    void resolveToolConfirmation(interactionId, false, !busy)
      .then((resolution) => {
        if (resolution.resume) enqueueDelivery(resolution.resume.payload, resolution.resume, { skipUserMessage: true, priority: true });
        notify();
      })
      .catch((cause) => showToast(cause instanceof Error ? cause.message : String(cause)));
  },
  focusNodes: (nodeIds) => {
    const existing = new Set((store.project.nodes || []).map((node: Loose) => String(node.id)));
    const ids = nodeIds.filter((id) => existing.has(id));
    if (!ids.length) return showToast("这个阶段还没有可定位的画布产物");
    focusCanvasNodes(ids);
    showToast(`已选中 ${ids.length} 个阶段产物`);
  },
};

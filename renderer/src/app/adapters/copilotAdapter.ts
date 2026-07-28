import { abortAgent, runAgent } from "../../agent";
import {
  resolveClarification,
  resolveToolConfirmation,
} from "../copilot/agentInteractionCoordinator";
import { listAgentInteractions } from "../../agent/runtime/runStore";
import { getModelInfo } from "../../domain/catalog/ModelCatalog";
import { getAgentProjectKey } from "../../services/agentProjectIdentity";
import {
  clearActiveCopilotConversation,
  createCopilotConversation,
  deleteCopilotConversation,
  getActiveCopilotConversation,
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
import type { CopilotController, CopilotMessage } from "../copilot/CopilotPanel";
import { CopilotRuntimePresenter } from "../copilot/CopilotRuntimePresenter";
import { showToast } from "../store/overlayStore";
import { setSelectedNodeIds } from "../../store/nodeStore";
import { toRaw } from "../../store/domainReactivity.js";

type Loose = Record<string, any>;
type CopilotSendPayload = {
  text: string;
  model: string;
  attachments: unknown[];
  nodeMentions: unknown[];
};
type AgentResume = {
  conversationId: string;
  payload: CopilotSendPayload & {
    continuation: Loose;
  };
};
const listeners = new Set<() => void>();
let busy = false;
let activeRequestId = "";
let revision = 0;
let textModelConfigSource: object | null = null;
let cachedTextModels: Array<{ id: string; label: string }> = [];
const notify = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};
export const subscribeCopilot = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getCopilotRevision = () => revision;
function active() {
  return getActiveCopilotConversation(store.project) as Loose;
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
  }));
  return cachedTextModels;
}
function pushMessage(message: Loose) {
  const conversation = active();
  conversation.messages = conversation.messages.filter((item: Loose) => !item.transient);
  conversation.messages.push({
    id: uid(),
    createdAt: new Date().toISOString(),
    ...message,
  });
  if (message.role === "user") {
    titleConversationFromMessage(conversation, message.content);
  }
  conversation.updatedAt = new Date().toISOString();
  if (conversation.messages.length > 200) {
    conversation.messages.splice(0, conversation.messages.length - 200);
  }
  touchProject();
  notify();
}
function pushTyping() {
  const id = uid();
  const conversation = toRaw(active()) as Loose;
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
function patchMessage(id: string, patch: Loose) {
  const conversation = toRaw(active()) as Loose;
  const item = conversation.messages.find((message: Loose) => message.id === id);
  if (item) Object.assign(item, patch);
  notify();
}
function finalizeMessage(id: string, patch: Loose) {
  const conversation = toRaw(active()) as Loose;
  const item = conversation.messages.find((message: Loose) => message.id === id);
  if (!item) return pushMessage(patch);
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

export function copilotData() {
  const conversation = active();
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
    messages: conversation.messages as CopilotMessage[],
    conversations: (store.project.copilotConversations || []).map((item: Loose) => {
      const pending = interactionList.filter(
        (interaction) =>
          interaction.conversationId === String(item.id) && interaction.status === "pending",
      );
      return {
        id: item.id,
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
    activeConversationId: String(store.project.activeCopilotConversationId || ""),
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
  options: { skipUserMessage?: boolean } = {},
) {
  if (busy) return;
  const project = store.project;
  const projectKey = getAgentProjectKey();
  const conversation = active();
  if (resume && String(conversation.id || "") !== resume.conversationId) {
    showToast("待续跑的 Agent 属于另一个对话，请先切换回原对话");
    return;
  }
  busy = true;
  notify();
  const messageText = payload.text.trim() || "请结合我选择的节点和附件继续处理。";
  if (!resume && !options.skipUserMessage) {
    pushMessage({
      role: "user",
      title: "你的消息",
      content: messageText,
      meta: [
        ...(payload.nodeMentions as Loose[]).map(
          (node) => `@${node.alias || node.id} ${node.title || "未命名节点"}`,
        ),
        ...(payload.attachments as Loose[]).map(
          (file) => `附件 ${file.name || file.fileName || "未命名文件"}`,
        ),
      ],
    });
  }
  const typingId = pushTyping();
  const presentation = new CopilotRuntimePresenter();
  let timer = 0;
  const flush = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    patchMessage(typingId, { content: presentation.streamed, typing: true });
  };
  const schedule = () => {
    if (!timer) timer = window.setTimeout(flush, 48);
  };
  const stopTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  try {
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
        if (event.type === "run_started") activeRequestId = String(event.requestId || "");
        if (store.project !== project || getAgentProjectKey() !== projectKey) return;
        const effect = presentation.consume(event);
        if (effect.textChanged) schedule();
        if (effect.contextUsage) {
          (toRaw(conversation) as Loose).contextUsage = effect.contextUsage;
          notify();
        }
        if (effect.messagePatch) patchMessage(typingId, effect.messagePatch);
        if (effect.persist) touchProject();
      },
    );
    if (store.project !== project || getAgentProjectKey() !== projectKey) {
      return;
    }
    conversation.contextUsage = result?.contextUsage || conversation.contextUsage || null;
    conversation.updatedAt = new Date().toISOString();
    flush();
    finalizeMessage(typingId, {
      role: "assistant",
      title: "画布助手",
      content: presentation.streamed || result?.reply || "Agent 已完成本轮处理。",
      ...presentation.snapshot(),
      requestId: result?.requestId || "",
    });
  } catch (cause: any) {
    if (store.project === project && getAgentProjectKey() === projectKey) {
      flush();
      const error = String(cause?.message || cause || "未知错误");
      const cancelled = /abort|cancel/i.test(error);
      finalizeMessage(typingId, {
        role: "assistant",
        title: cancelled ? "已停止" : "运行失败",
        content: presentation.streamed || (cancelled ? "已停止当前任务。" : ""),
        ...(cancelled
          ? {}
          : {
              error: `Agent 运行失败：${error}`,
              retryable: true,
              retryPayload: {
                text: payload.text,
                model: payload.model,
                attachments: [...payload.attachments],
                nodeMentions: [...payload.nodeMentions],
              },
            }),
        ...presentation.snapshot({ toolCalls: presentation.failRunningTools() }),
      });
    }
  } finally {
    stopTimer();
    busy = false;
    activeRequestId = "";
    notify();
  }
}

export const copilotController: CopilotController = {
  send: (payload) => {
    void send(payload);
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
    const message = active().messages.find((item: Loose) => item.id === messageId);
    if (!message?.retryable || !message.retryPayload) {
      showToast("这条失败消息没有可用的重试信息");
      return;
    }
    message.retryable = false;
    touchProject();
    notify();
    void send(
      {
        text: String(message.retryPayload.text || ""),
        model: String(message.retryPayload.model || ""),
        attachments: [...(message.retryPayload.attachments || [])],
        nodeMentions: [...(message.retryPayload.nodeMentions || [])],
      },
      undefined,
      { skipUserMessage: true },
    );
  },
  clear: () => {
    if (
      listAgentInteractions({ pendingOnly: true }).some(
        (item) => item.conversationId === String(active().id || ""),
      )
    ) {
      showToast("当前对话仍有问题或操作等待处理，完成后才能清空");
      return;
    }
    clearActiveCopilotConversation(store.project);
    touchProject();
    notify();
    showToast("当前 Copilot 对话上下文已清空");
  },
  newConversation: () => {
    if (busy) return;
    createCopilotConversation(store.project);
    touchProject();
    notify();
    showToast("已新建项目对话");
  },
  selectConversation: (id) => {
    if (!busy && switchCopilotConversation(store.project, id)) {
      touchProject();
      notify();
    }
  },
  deleteConversation: (id) => {
    if (listAgentInteractions({ pendingOnly: true }).some((item) => item.conversationId === id)) {
      showToast("这个会话仍有问题或操作等待处理，完成后才能删除");
      return;
    }
    if (!busy && deleteCopilotConversation(store.project, id)) {
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
      if (resolution.resume) void send(resolution.resume.payload, resolution.resume);
      notify();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : String(cause));
    }
  },
  approveToolCall: (payload: unknown) => {
    const value = payload as Loose;
    const interactionId = String(value.interactionId || "");
    if (!interactionId) return;
    void resolveToolConfirmation(interactionId, true, !busy)
      .then((resolution) => {
        if (resolution.resume) void send(resolution.resume.payload, resolution.resume);
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
        if (resolution.resume) void send(resolution.resume.payload, resolution.resume);
        notify();
      })
      .catch((cause) => showToast(cause instanceof Error ? cause.message : String(cause)));
  },
  focusNodes: (nodeIds) => {
    const existing = new Set((store.project.nodes || []).map((node: Loose) => String(node.id)));
    const ids = nodeIds.filter((id) => existing.has(id));
    if (!ids.length) return showToast("这个阶段还没有可定位的画布产物");
    setSelectedNodeIds(ids);
    showToast(`已选中 ${ids.length} 个阶段产物`);
  },
};

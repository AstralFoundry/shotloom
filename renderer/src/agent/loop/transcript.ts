import { store, touchProject } from '@/store/projectStore';
import type { JsonObject, JsonValue } from '../core/types';

/**
 * 自研 Agent loop 的模型可见历史。
 *
 * OpenCode 把历史存在 sidecar 的 session 里，Shotloom 只有对话展示层的消息；
 * 自己驱动循环就必须自己保存"模型真正看到过什么"，包括工具调用与工具结果。
 * 这份记录挂在会话记录上，只服务模型，不参与界面渲染。
 */

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  /**
   * system 只出现在单次请求的头部，不会进入持久化历史；
   * 历史里合法的角色只有 user / assistant / tool。
   */
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

/** 单条工具结果写给模型的上限；画布快照之类的返回可以很大，不能整轮被它占满。 */
const TOOL_RESULT_CHAR_LIMIT = 20_000;
/** 估算只用于决定窗口边界，真实占用仍以模型返回的 usage 上报给界面。 */
const CHARS_PER_TOKEN = 3;

function messageChars(message: ChatMessage): number {
  if (typeof message.content === 'string') return message.content.length;
  if (Array.isArray(message.content)) {
    // 图片按固定额度计入，避免把 data URL 的 base64 长度当成几千 token 文本。
    return message.content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 1_000), 0);
  }
  return 0;
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((total, message) => total + messageChars(message)
    + (message.tool_calls || []).reduce((inner, call) => inner + call.function.name.length + call.function.arguments.length, 0), 0) / CHARS_PER_TOKEN);
}

/**
 * 中断可能发生在"assistant 提出 tool_calls"与"工具结果回写"之间。落盘前给每个
 * 没有应答的调用补一条工具消息，否则下一轮请求带着无应答的 tool_calls 会被
 * provider 直接拒绝，这个会话就永久卡在坏历史上。
 */
export function closeDanglingToolCalls(messages: ChatMessage[], note: string): ChatMessage[] {
  const answered = new Set(messages
    .filter((message) => message.role === 'tool' && message.tool_call_id)
    .map((message) => String(message.tool_call_id)));
  const output: ChatMessage[] = [];
  for (const message of messages) {
    output.push(message);
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls || []) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      output.push({ role: 'tool', tool_call_id: call.id, content: note });
    }
  }
  return output;
}

/** 截断必须让模型知道内容被截断，否则它会以为看到了完整回执。 */
export function truncateToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_CHAR_LIMIT) return text;
  return `${text.slice(0, TOOL_RESULT_CHAR_LIMIT)}\n…（工具结果过长，已截断 ${text.length - TOOL_RESULT_CHAR_LIMIT} 个字符）`;
}

/**
 * 一个分组是"一条用户消息"或"一条 assistant 消息加它的若干工具结果"。
 * 裁剪必须整组进行：留下没有对应 assistant tool_calls 的 tool 消息会被 provider 直接拒绝。
 */
function groupTranscript(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const startGroup = message.role === 'user' || message.role === 'assistant';
    if (startGroup || !groups.length) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }
  return groups;
}

export interface TranscriptWindow {
  messages: ChatMessage[];
  droppedGroups: number;
  estimatedTokens: number;
}

/** 从最旧的分组开始丢弃，直到估算占用装进输入预算；至少保留最后一个分组。 */
export function fitTranscript(messages: ChatMessage[], inputBudget: number): TranscriptWindow {
  const groups = groupTranscript(messages);
  let dropped = 0;
  while (groups.length - dropped > 1 && estimateMessageTokens(groups.slice(dropped).flat()) > inputBudget) {
    dropped += 1;
  }
  const kept = groups.slice(dropped).flat();
  return { messages: kept, droppedGroups: dropped, estimatedTokens: estimateMessageTokens(kept) };
}

function conversationRecord(conversationId: string): JsonObject | undefined {
  return (store.project.copilotConversations || []).find(
    (item: JsonObject) => String(item.id || '') === String(conversationId),
  );
}

/**
 * 每次写入都整体替换数组而不是原地 push：项目持久化对比的是引用，
 * 原地修改会让"历史已推进"这一步在崩溃后丢失。
 */
export function loadConversationTranscript(conversationId: string): ChatMessage[] {
  const stored = conversationRecord(conversationId)?.runtimeTranscript;
  return Array.isArray(stored) ? [...(stored as unknown as ChatMessage[])] : [];
}

export function saveConversationTranscript(conversationId: string, messages: ChatMessage[]): void {
  const conversation = conversationRecord(conversationId);
  if (!conversation) return;
  conversation.runtimeTranscript = messages as unknown as JsonValue;
  touchProject({ sessionDelay: 250, coalesceSession: true });
}

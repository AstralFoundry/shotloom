import { store, touchProject } from '@/store/projectStore';
import { receiptChangesProject } from '../runtime/toolReceipts';
import type { AgentToolContext, AgentToolReceipt, JsonObject, JsonValue } from '../core/types';

/**
 * Agent loop 的模型可见历史。
 *
 * 界面消息只是展示层的内容，不能代替"模型真正看到过什么"；循环自己读写这份记录，
 * 包括工具调用与工具结果。它挂在会话记录上，只服务模型，不参与界面渲染。
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

/** 单条消息的估算只用于决定窗口边界，真实占用仍以模型返回的 usage 上报给界面。 */
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
 * 工具本体真正开始执行的标记。
 *
 * 中断后要给无应答的调用补一条工具消息，而"能不能直接重试"取决于这次调用有没有
 * 碰过外部世界：等待用户确认时被打断可以原样重试，已经在 execute 里被打断就不行。
 * 只有工具自己知道后者，所以必须在派发点记账，不能让模型或界面试着去猜。
 */
const STARTED_TOOL_CALLS_KEY = 'startedToolCallIds';

export function markToolCallStarted(context: AgentToolContext, callId: string): void {
  const started = (context.state.get(STARTED_TOOL_CALLS_KEY) as Set<string>) || new Set<string>();
  started.add(callId);
  context.state.set(STARTED_TOOL_CALLS_KEY, started);
}

export function startedToolCallIds(state: Map<string, unknown>): Set<string> {
  return (state.get(STARTED_TOOL_CALLS_KEY) as Set<string>) || new Set<string>();
}

/** 历史里没有应答的工具调用 id。 */
export function danglingToolCallIds(messages: ChatMessage[]): Set<string> {
  const answered = new Set(messages
    .filter((message) => message.role === 'tool' && message.tool_call_id)
    .map((message) => String(message.tool_call_id)));
  const dangling = new Set<string>();
  for (const message of messages) {
    for (const call of message.tool_calls || []) {
      if (!answered.has(call.id)) dangling.add(call.id);
    }
  }
  return dangling;
}

/**
 * 无应答工具调用的补写内容，按这次调用的真实进度分档。
 *
 * 统一说"没有执行，没有产生任何效果"是不实的：写画布的调用完全可能在 execute 内部
 * 被打断，此时节点已经落地，模型相信这句话就会重复创建，用户看到一排重复节点。
 * 档位只由本地已记录的事实决定（回执是否改变项目、是否已派发），不去猜工具语义。
 *
 * `unattributed` 是上一次没来得及收尾的运行留下的调用（强退或崩溃）：本地对它们
 * 没有任何执行记录，既不能宣称已完成，也不能宣称没有效果。
 */
export function interruptedToolNoteFor(
  state: Map<string, unknown>,
  unattributed: Set<string>,
): (call: AgentToolCall) => string {
  const receipts = (state.get('toolReceipts') as Map<string, AgentToolReceipt>) || new Map<string, AgentToolReceipt>();
  const started = startedToolCallIds(state);
  const unknownOutcome = (label: string, reason: string) =>
    `${label}${reason}，实际影响未知。它可能有副作用，先用只读工具核验当前状态再决定是否重做，不要直接重复调用。`;
  return (call) => {
    const label = `工具 ${call.function.name}`;
    const receipt = receipts.get(call.id);
    if (receipt) {
      return receiptChangesProject(receipt)
        ? `${label} 在本次中断的运行里已经执行完成，并且真实改动了项目（涉及的节点或任务已记录在回执里）。结果没能写回历史。不要重试这个写操作；需要确认就用只读工具查看当前画布真实状态。`
        : `${label} 在本次中断的运行里已经执行完成，没有改动项目。结果没能写回历史，需要它就重新调用一次。`;
    }
    if (started.has(call.id)) return unknownOutcome(label, ' 在本次中断的运行里已经开始执行，但结果没能写回历史');
    if (unattributed.has(call.id)) return unknownOutcome(label, ' 来自上一次未正常退出的运行，本地没有它的执行记录');
    return `${label} 在本次中断的运行里尚未开始执行，没有产生任何效果；需要时可以直接重新调用。`;
  };
}

/**
 * 中断可能发生在"assistant 提出 tool_calls"与"工具结果回写"之间。落盘前给每个
 * 没有应答的调用补一条工具消息，否则下一轮请求带着无应答的 tool_calls 会被
 * provider 直接拒绝，这个会话就永久卡在坏历史上。
 */
export function closeDanglingToolCalls(
  messages: ChatMessage[],
  noteFor: (call: AgentToolCall) => string,
): ChatMessage[] {
  const pending = danglingToolCallIds(messages);
  const output: ChatMessage[] = [];
  for (const message of messages) {
    output.push(message);
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls || []) {
      if (!pending.has(call.id)) continue;
      pending.delete(call.id);
      output.push({ role: 'tool', tool_call_id: call.id, content: noteFor(call) });
    }
  }
  return output;
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

export function conversationRecord(conversationId: string): JsonObject | undefined {
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

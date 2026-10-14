import { store, touchProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { conversationRecord } from './transcript';
import type { AgentToolContext, JsonObject, JsonValue } from '../core/types';

/**
 * 超大工具结果的落盘与读回。
 *
 * 画布快照之类的结果整条进历史会挤掉真实对话，而按字符截断会直接销毁 JSON 尾部：
 * 模型既看不到后面的节点，也不知道自己少了什么，只能凭开头编下去。这里把完整输出
 * 写进项目目录，历史只留头尾摘要加读回方式，内容随时可以按原样分段取回。
 */

/** 超过这个长度才落盘；小结果直接进历史，不值得多一次文件往返。 */
const SPILL_THRESHOLD_CHARS = 20_000;
const PREVIEW_HEAD_CHARS = 6_000;
const PREVIEW_TAIL_CHARS = 2_000;
/** 一个会话最多留几份落盘输出；超出的最旧项连文件一起清掉，不在项目目录里堆垃圾。 */
const MAX_SPILLED_OUTPUTS = 20;
const DEFAULT_READ_CHARS = 12_000;
/** 读回上限必须不超过落盘阈值，否则一次读取本身又会触发落盘。 */
const MAX_READ_CHARS = 20_000;

export interface SpilledToolOutput {
  callId: string;
  toolName: string;
  path: string;
  chars: number;
  createdAt: string;
}

function spilledOutputs(conversationId: string): SpilledToolOutput[] {
  const stored = conversationRecord(conversationId)?.toolOutputs;
  return Array.isArray(stored) ? [...(stored as unknown as SpilledToolOutput[])] : [];
}

function saveSpilledOutputs(conversationId: string, entries: SpilledToolOutput[]): void {
  const conversation = conversationRecord(conversationId);
  if (!conversation) return;
  conversation.toolOutputs = entries as unknown as JsonValue;
  touchProject({ sessionDelay: 250, coalesceSession: true });
}

function safeSegment(value: string): string {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
}

/**
 * 文件名带上会话标识：不同会话里模型给的 callId 完全可能相同（provider 常按
 * call-1、call-2 编号），只按 callId 命名会让一个会话把另一个会话的落盘结果覆盖掉。
 */
function spillPathFor(conversationId: string, callId: string): string {
  const projectDir = String(store.projectDir || '').replace(/[\\/]+$/, '');
  return `${projectDir}/.shotloom/agent-spill/${safeSegment(conversationId)}__${safeSegment(callId)}.json`;
}

/** 落盘失败只是退回"没有读回途径的摘要"，不能因此让整轮 Agent 失败。 */
async function writeSpillFile(conversationId: string, callId: string, text: string) {
  if (!store.projectDir || !conversationId) return { path: '', error: '当前项目还没有磁盘目录' };
  const path = spillPathFor(conversationId, callId);
  try {
    await desktopApi.file.writeFileToPath(path, new TextEncoder().encode(text));
    return { path, error: '' };
  } catch (cause) {
    return { path: '', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function rememberSpilledOutput(conversationId: string, entry: SpilledToolOutput): void {
  const kept = [entry, ...spilledOutputs(conversationId).filter((item) => item.callId !== entry.callId)];
  for (const dropped of kept.slice(MAX_SPILLED_OUTPUTS)) {
    void desktopApi.file.trash(dropped.path).catch(() => undefined);
  }
  saveSpilledOutputs(conversationId, kept.slice(0, MAX_SPILLED_OUTPUTS));
}

/** 进历史的工具结果文本：短的原样，长的落盘并只回头尾摘要。 */
export async function serializeToolOutputForTranscript(input: {
  context: AgentToolContext;
  callId: string;
  toolName: string;
  text: string;
}): Promise<string> {
  const { text } = input;
  if (text.length <= SPILL_THRESHOLD_CHARS) return text;
  const written = await writeSpillFile(input.context.conversationId, input.callId, text);
  if (written.path) {
    rememberSpilledOutput(input.context.conversationId, {
      callId: input.callId,
      toolName: input.toolName,
      path: written.path,
      chars: text.length,
      createdAt: new Date().toISOString(),
    });
  }
  const readBack = written.path
    ? `完整结果已落盘在本项目内，用 read_tool_output 传 callId="${input.callId}" 可分段读回`
    : `完整结果未能落盘（${written.error}），只能用更窄的只读参数重新获取`;
  return [
    text.slice(0, PREVIEW_HEAD_CHARS),
    `…（中间省略 ${text.length - PREVIEW_HEAD_CHARS - PREVIEW_TAIL_CHARS} 个字符；${readBack}）…`,
    text.slice(text.length - PREVIEW_TAIL_CHARS),
  ].join('\n');
}

/** read_tool_output 的真实实现：只认本次会话登记过的 callId，不接受任意路径。 */
export async function readSpilledToolOutput(context: AgentToolContext, input: JsonObject): Promise<JsonObject> {
  const callId = String(input.callId || '');
  const entry = spilledOutputs(context.conversationId).find((item) => String(item.callId || '') === callId);
  if (!entry) {
    return {
      success: false,
      error: `没有 callId 为「${callId}」的落盘输出。只有历史摘要里标明已落盘的调用可以读回；需要别的信息就用对应的只读工具重新查询。`,
    };
  }
  let text = '';
  try {
    text = new TextDecoder().decode(await desktopApi.file.readArrayBuffer(entry.path));
  } catch {
    text = '';
  }
  if (!text) {
    return {
      success: false,
      error: `落盘结果已经读不出来了（文件可能已被移动或删除），它原本记录的是 ${entry.toolName} 的 ${entry.chars} 个字符输出。请用只读工具重新获取这份数据。`,
    };
  }
  const offset = Math.max(0, Math.floor(Number(input.offset || 0)) || 0);
  const limit = Math.min(MAX_READ_CHARS, Math.max(1, Math.floor(Number(input.limit || 0)) || DEFAULT_READ_CHARS));
  const content = text.slice(offset, offset + limit);
  const nextOffset = offset + content.length;
  return {
    success: true,
    callId,
    toolName: entry.toolName,
    path: entry.path,
    chars: text.length,
    offset,
    returned: content.length,
    nextOffset,
    eof: nextOffset >= text.length,
    content,
  };
}

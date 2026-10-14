import { agentDefinition, type AgentDefinition } from '../agents/definitions.ts';
import { buildSubagentPrompt } from '../content/instructions';
import { executeAgentToolCall } from '../runtime/executeToolCall';
import type { AgentToolContext, JsonObject } from '../core/types';
import { createLoopBuiltins, type LoopBuiltin } from './builtinTools';
import { serializeToolOutputForTranscript } from './toolOutputSpill';
import { serializeLoopTools, buildLoopRequestBody, type LoopModelPlan } from './modelRequest';
import {
  fitTranscript,
  markToolCallStarted,
  type AgentToolCall,
  type ChatContentPart,
  type ChatMessage,
} from './transcript';

/**
 * Shotloom 自研 Agent 循环。
 *
 * 循环控制权在渲染进程：每一步都重新解析该 session 的工具可见集，因此子 Agent 只看得见
 * 自己定义里的工具；模型回复、工具调用与工具结果都按 OpenAI 消息结构进入历史。
 * 这里只负责"问模型 → 执行它选的工具 → 把真实结果喂回去"，业务权限全部由
 * runtime/executeToolCall.ts 强制执行。
 */

export interface AssistantTurn {
  text: string;
  toolCalls: AgentToolCall[];
  finishReason: string;
  /** 模型上报的真实占用；缺失时调用方用估算值兜底。 */
  usage?: { input?: number; output?: number };
}

export type LoopModelCaller = (
  body: Record<string, unknown>,
  onTextDelta: (delta: string) => void,
) => Promise<AssistantTurn>;

export interface AgentLoopInput {
  agent?: AgentDefinition;
  context: AgentToolContext;
  plan: LoopModelPlan;
  systemPrompt: string;
  messages: ChatMessage[];
  maxSteps?: number;
  callModel: LoopModelCaller;
  emit: (event: JsonObject & { type: string }) => void;
  onMessagesChanged?: (messages: ChatMessage[]) => void;
}

export interface AgentLoopResult {
  reply: string;
  modelRounds: number;
  messages: ChatMessage[];
}

function builtinToRequestTool(builtin: LoopBuiltin) {
  return {
    type: 'function' as const,
    function: { name: builtin.name, description: builtin.description, parameters: builtin.parameters },
  };
}

function imageParts(attachments: JsonObject[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  for (const attachment of attachments) {
    const url = String(attachment.url || attachment.dataUrl || '');
    const mime = String(attachment.mime || attachment.mimeType || '');
    // 只接受可直接引用的图片数据或远程地址，工具输出的真实素材帧才进视觉上下文。
    if (!/^data:image\//i.test(url) && !/^https?:\/\//i.test(url)) continue;
    if (mime && !mime.startsWith('image/')) continue;
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const agent = input.agent || agentDefinition(input.context.agentId);
  const maxSteps = input.maxSteps ?? agent.maxSteps;
  const messages = input.messages;
  // 一次运行只有一个事件出口：先打上本轮 Agent 的身份，再交给上层。
  // 循环机制事件用这个出口，工具管道事件用 context.emit，两者必须是同一个，
  // 否则子 Agent 的工具回执在 agentRuntimeEvents 里会和父级混成同一个身份。
  const emit = (event: JsonObject & { type: string }) => input.emit({
    agentId: agent.id,
    agentSessionId: input.context.agentSessionId,
    ...event,
  });
  const context: AgentToolContext = { ...input.context, emit };
  const builtinByName = new Map<string, LoopBuiltin>();
  const builtins = createLoopBuiltins({
    agent,
    context,
    emit,
    runSubagent: async (child, task, childSessionId) => {
      // 子 Agent 用自身定义解析可见集：父级的画布写权限不随派发继承。
      const result = await runAgentLoop({
        ...input,
        agent: child,
        context: { ...context, agentId: child.id, agentSessionId: childSessionId, turnId: `${childSessionId}:root` },
        systemPrompt: buildSubagentPrompt(child.id, child.instructions || ''),
        messages: [{ role: 'user', content: task }],
        maxSteps: child.maxSteps,
        onMessagesChanged: undefined,
      });
      return result.reply;
    },
  });
  for (const builtin of builtins) builtinByName.set(builtin.name, builtin);

  let modelRounds = 0;
  let reply = '';
  const inputBudget = Math.max(1, input.plan.contextLimit - input.plan.outputLimit);

  const commit = () => input.onMessagesChanged?.([...messages]);

  for (let step = 1; step <= maxSteps; step += 1) {
    const window = fitTranscript(messages, inputBudget);
    if (window.droppedGroups) {
      // 落盘的历史必须与模型真正看到的一致：把内存里的历史收敛到窗口，
      // 否则长会话的 runtimeTranscript 只增不减，最终把整个项目 JSON 撑大。
      messages.length = 0;
      messages.push(...window.messages);
      commit();
      emit({ type: 'context_compaction', status: 'completed', automatic: true, droppedGroups: window.droppedGroups, createdAt: new Date().toISOString() });
    }
    emit({ type: 'turn_start', turn: step, createdAt: new Date().toISOString() });
    modelRounds = step;
    const turnId = `${input.context.requestId}:step:${step}`;
    const body = buildLoopRequestBody(
      input.plan,
      [...serializeLoopTools(context), ...builtins.map(builtinToRequestTool)],
      [{ role: 'system', content: input.systemPrompt }, ...window.messages],
    );
    const turn = await input.callModel(body, (delta) => emit({ type: 'text_delta', turnId, delta }));
    // 模型上报真实占用时用上报值，否则用本轮请求的估算值，保证面板不会显示 0。
    const used = (turn.usage?.input || window.estimatedTokens) + (turn.usage?.output || 0);
    emit({
      type: 'context_usage',
      estimatedTokens: used,
      inputLimit: input.plan.contextLimit,
      inputBudget,
      outputReserve: input.plan.outputLimit,
      ratio: used / inputBudget,
      createdAt: new Date().toISOString(),
    });

    messages.push({
      role: 'assistant',
      content: turn.text || null,
      ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}),
    });
    commit();

    if (!turn.toolCalls.length) {
      if (turn.finishReason === 'length') {
        throw new Error('Agent 达到本轮输出上限，尚未完成工具调用');
      }
      reply = turn.text;
      if (!reply.trim()) {
        throw new Error('模型返回了 0 token 空响应；请检查文本模型 endpoint 与 OpenAI-compatible 流式响应格式');
      }
      return { reply, modelRounds, messages };
    }

    for (const call of turn.toolCalls) {
      const builtin = builtinByName.get(call.function.name);
      let result: Record<string, unknown>;
      if (builtin) {
        let parsed: JsonObject;
        try {
          parsed = JSON.parse(call.function.arguments || '{}') as JsonObject;
        } catch {
          parsed = {};
        }
        // 子 Agent 的画布写发生在这次派发内部，中断时同样可能已经改过项目。
        markToolCallStarted(context, call.id);
        result = await builtin.run(parsed);
      } else {
        try {
          result = await executeAgentToolCall(
            { context, model: input.plan.model },
            { callId: call.id, name: call.function.name, argumentsJson: call.function.arguments || '{}' },
          );
        } catch (cause) {
          // 可恢复的失败以工具结果返回给模型，让它改输入或换工具，而不是终止整轮。
          const error = cause instanceof Error ? cause.message : String(cause);
          result = { success: false, error };
        }
      }
      const { __toolAttachments: rawAttachments, ...output } = result;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await serializeToolOutputForTranscript({
          context, callId: call.id, toolName: call.function.name, text: JSON.stringify(output),
        }),
      });
      const attachments = Array.isArray(rawAttachments) ? rawAttachments as JsonObject[] : [];
      if (attachments.length) {
        const parts = imageParts(attachments);
        if (parts.length) {
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: `以上是工具 ${call.function.name} 返回的真实素材帧，请实际查看后再继续。` }, ...parts],
          });
        }
      }
      commit();
    }
  }
  throw new Error(`Agent 达到 ${maxSteps} 步上限仍未给出最终回复，本轮已停止以避免无限执行`);
}

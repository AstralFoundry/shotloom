import { getModelInfo, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { getModelCredentialStatus } from '@/store/settingsStore';
import { listAgentTools } from '../core/toolRegistry.ts';
import type { AgentToolContext } from '../core/types';
import type { ChatMessage } from './transcript';

/** Agent 历史统一保存为 Chat 消息；请求边界按目录声明转换为供应商协议。 */

export type LoopProtocol = 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages';

export interface LoopModelPlan {
  model: string;
  protocol: LoopProtocol;
  upstreamModel: string;
  providerId: string;
  endpointPath: string;
  endpointScope: string;
  endpointMethod: string;
  headers: Record<string, string>;
  auth: { type: string; name?: string; prefix?: string };
  requestOptions: Record<string, unknown>;
  contextLimit: number;
  outputLimit: number;
  timeoutMs: number;
}

const CHAT_COMPLETIONS_SUFFIX = '/chat/completions';
const RESPONSES_SUFFIX = '/responses';
const MESSAGES_SUFFIX = '/messages';

function resolveProtocol(path: string, transport: string): LoopProtocol | null {
  if (transport === 'openai-chat-completions') return path.endsWith(CHAT_COMPLETIONS_SUFFIX) ? transport : null;
  if (transport === 'openai-responses') return path.endsWith(RESPONSES_SUFFIX) ? transport : null;
  if (transport === 'anthropic-messages') return path.endsWith(MESSAGES_SUFFIX) ? transport : null;
  if (transport === 'provider-default' && path.endsWith(CHAT_COMPLETIONS_SUFFIX)) return 'openai-chat-completions';
  return null;
}
/**
 * 单轮模型请求必须自己带超时：loop 侧的看门狗只负责提示用户"卡住了"，不会中止请求，
 * 否则一次挂死的流式响应会让整轮运行永久停在"正在处理"。
 */
const MODEL_REQUEST_TIMEOUT_MS = 300_000;

/** 供运行入口判断：该文本模型能否由自研 loop 直接驱动。返回空字符串表示支持。 */
export function loopUnsupportedReason(model: string): string {
  const info = getModelInfo(model);
  if (!info) return `文本模型未在模型目录中配置：${model}`;
  const contract = resolveModelRuntimeContract('textGeneration', model, []);
  if (!contract) return `${model} 缺少 textGeneration 运行时契约`;
  if (contract.agent?.supportsTools !== true) return `${model} 未声明支持 Agent 工具调用`;
  const endpoint = contract.agent?.endpoint || contract.endpoint;
  if (!resolveProtocol(String(endpoint?.path || ''), String(contract.agent?.transport || ''))) {
    return `${model} 的 Agent 协议声明与 endpoint 不匹配或尚未支持`;
  }
  return '';
}

export function resolveLoopModelPlan(model: string): LoopModelPlan {
  const reason = loopUnsupportedReason(model);
  if (reason) throw new Error(reason);
  const credential = getModelCredentialStatus(model);
  if (!credential.available) throw new Error(`${credential.message}，Agent 无法启动`);
  const info = getModelInfo(model)!;
  const contract = resolveModelRuntimeContract('textGeneration', model, [])!;
  const endpoint = contract.agent?.endpoint || contract.endpoint;
  const protocol = resolveProtocol(endpoint.path, contract.agent!.transport)!;
  return {
    model,
    protocol,
    upstreamModel: info.upstreamModel,
    // 供应商鉴权与 Base URL 由 Rust 网关按 providerId 注入，渲染进程不搬运密钥。
    providerId: contract.provider || info.provider,
    endpointPath: endpoint.path,
    endpointScope: endpoint.scope || 'root',
    endpointMethod: (endpoint.method || 'POST').toUpperCase(),
    headers: contract.headers || {},
    auth: contract.auth || { type: 'bearer' },
    requestOptions: structuredClone(contract.agent?.requestOptions || {}),
    contextLimit: Number(contract.inputConstraints?.text?.maxTokens || 64_000),
    outputLimit: Number(contract.outputConstraints?.maxTokens || 8_192),
    timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
  };
}

/**
 * 工具定义只序列化 id、说明和输入 schema；execute 与运行时状态不会离开本地。
 * 每步都重新解析，Skill 加载后新出现的命名空间工具才会进入下一次请求。
 */
export function serializeLoopTools(context: AgentToolContext) {
  return listAgentTools(context).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.id,
      description: tool.description,
      parameters: tool.resolveInputSchema?.(context) || tool.inputSchema,
    },
  }));
}

export function buildLoopRequestBody(
  plan: LoopModelPlan,
  tools: ReturnType<typeof serializeLoopTools>,
  messages: ChatMessage[],
): Record<string, unknown> {
  let payload: Record<string, unknown>;
  if (plan.protocol === 'openai-responses') {
    const input: Record<string, unknown>[] = [];
    for (const message of messages) {
      if (message.role === 'tool') {
        input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content || '' });
        continue;
      }
      if (message.role === 'assistant' && message.responseItems?.length) input.push(...message.responseItems);
      if (message.content !== null) {
        const content = Array.isArray(message.content)
          ? message.content.map((part) => part.type === 'text'
            ? { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
            : { type: 'input_image', image_url: part.image_url.url })
          : message.content;
        input.push({ role: message.role, content });
      }
      for (const call of message.tool_calls || []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
    payload = {
      model: plan.upstreamModel, input, stream: true, include: ['reasoning.encrypted_content'],
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', name: tool.function.name,
        description: tool.function.description, parameters: tool.function.parameters })), tool_choice: 'auto' } : {}),
    };
  } else if (plan.protocol === 'anthropic-messages') {
    const system = messages.filter((message) => message.role === 'system').map((message) => String(message.content || '')).join('\n\n');
    const converted: Record<string, unknown>[] = [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') {
        const previous = converted.at(-1);
        const result = { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content || '' };
        if (previous?.role === 'user') (previous.content as Record<string, unknown>[]).push(result);
        else converted.push({ role: 'user', content: [result] });
        continue;
      }
      const content: Record<string, unknown>[] = [];
      if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') content.push({ type: 'text', text: part.text });
          else {
            const url = part.image_url.url;
            const data = /^data:(image\/[^;]+);base64,(.+)$/s.exec(url);
            content.push({ type: 'image', source: data
              ? { type: 'base64', media_type: data[1], data: data[2] }
              : { type: 'url', url } });
          }
        }
      }
      for (const call of message.tool_calls || []) {
        let parsed: unknown;
        try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { parsed = {}; }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parsed });
      }
      if (content.length) converted.push({ role: message.role, content });
    }
    payload = {
      model: plan.upstreamModel, system, messages: converted, max_tokens: plan.outputLimit, stream: true,
      ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.function.name,
        description: tool.function.description, input_schema: tool.function.parameters })), tool_choice: { type: 'auto' } } : {}),
    };
  } else {
    payload = { model: plan.upstreamModel, messages: messages.map(({ responseItems: _responseItems, ...message }) => message), stream: true,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}) };
  }
  return {
    ...payload,
    ...plan.requestOptions,
    __agentProtocol: plan.protocol || 'openai-chat-completions',
    __providerId: plan.providerId,
    __endpointPath: plan.endpointPath,
    __endpointScope: plan.endpointScope,
    __endpointMethod: plan.endpointMethod,
    __headers: plan.headers,
    __auth: plan.auth,
    __timeoutMs: plan.timeoutMs,
  };
}

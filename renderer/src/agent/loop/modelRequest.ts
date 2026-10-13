import { getModelInfo, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { getModelCredentialStatus } from '@/store/settingsStore';
import { listAgentTools } from '../core/toolRegistry.ts';
import type { AgentToolContext } from '../core/types';
import type { ChatMessage } from './transcript';

/**
 * 自研 loop 只实现 OpenAI Chat Completions 协议。
 *
 * 模型目录是输入能力的唯一来源：这里不猜 endpoint、不猜鉴权方式，也不在协议不符时
 * 退化成一个"语义相近"的协议。目录声明的 agent 协议不是 Chat Completions 时，
 * 由运行时选择层显式退回另一个引擎。
 */

export interface LoopModelPlan {
  model: string;
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
/**
 * 自研 loop 没有 Rust 侧的 watchdog 与硬上限，单轮模型请求必须自己带超时，
 * 否则一次挂死的流式响应会让整轮运行永久停在"正在处理"。
 */
const MODEL_REQUEST_TIMEOUT_MS = 300_000;

/** 供运行时选择层判断：该文本模型能否由自研 loop 直接驱动。返回空字符串表示支持。 */
export function loopUnsupportedReason(model: string): string {
  const info = getModelInfo(model);
  if (!info) return `文本模型未在模型目录中配置：${model}`;
  const contract = resolveModelRuntimeContract('textGeneration', model, []);
  if (!contract) return `${model} 缺少 textGeneration 运行时契约`;
  if (contract.agent?.supportsTools !== true) return `${model} 未声明支持 Agent 工具调用`;
  const endpoint = contract.agent?.endpoint || contract.endpoint;
  if (!String(endpoint?.path || '').endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    return `${model} 的 Agent 协议不是 OpenAI Chat Completions`;
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
  return {
    model,
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
  return {
    model: plan.upstreamModel,
    messages,
    stream: true,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    ...plan.requestOptions,
    __providerId: plan.providerId,
    __endpointPath: plan.endpointPath,
    __endpointScope: plan.endpointScope,
    __endpointMethod: plan.endpointMethod,
    __headers: plan.headers,
    __auth: plan.auth,
    __timeoutMs: plan.timeoutMs,
  };
}

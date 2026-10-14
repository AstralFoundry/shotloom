import type { AgentAction, AgentBatchResult, JsonObject, JsonValue } from '@/services/agentTypes';

export type { JsonObject, JsonValue };

export type AgentToolEffect =
  | 'read'
  | 'agent_state_write'
  | 'project_write'
  | 'canvas_write'
  | 'media_generation';

export interface AgentToolReceipt extends JsonObject {
  callId: string;
  toolName: string;
  effect: AgentToolEffect;
  success: boolean;
  applied: boolean;
  partial: boolean;
  skippedCount: number;
  nodeIds: string[];
  edgeIds: string[];
  taskIds: string[];
  error: string;
  display?: AgentToolDisplay;
}

/**
 * 工具自己描述给用户的产出。界面不再猜结果结构，
 * 否则新增工具就会在对话里显示成一条没有内容的"已运行"。
 */
export interface AgentToolDisplay extends JsonObject {
  summary: string;
  previews?: Array<{ path: string; label: string }>;
}

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  enum?: JsonValue[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

export interface AgentRuntimeEvent extends JsonObject {
  type: string;
  requestId: string;
  turnId?: string;
}

export interface AgentToolContext {
  requestId: string;
  turnId: string;
  projectKey: string;
  projectInstanceId: string;
  projectGeneration: number;
  conversationId: string;
  /**
   * 本轮运行使用的 Agent 定义 id。主 Agent 与每个子 Agent 各自一份，
   * 工具可见性完全由 agents/definitions.ts 的白名单按此 id 解析，
   * 不再从会话作用域或工具名前缀猜测。
   */
  agentId: string;
  /**
   * 事件归属用的会话标识：主 Agent 用 requestId，子 Agent 用派发时生成的
   * childSessionId。子 Agent 与父级共用同一条执行管道和同一个事件出口，
   * 少了这个标识就无法诊断"这条回执是哪个 Agent 产生的"。
   */
  agentSessionId: string;
  signal: AbortSignal;
  loadedSkillIds: Set<string>;
  attachments: JsonObject[];
  capabilities: {
    nodeExecution: boolean;
  };
  state: Map<string, unknown>;
  emit: (event: JsonObject & { type: string }) => void;
}

export interface AgentToolDefinition<TInput extends JsonObject = JsonObject, TResult = unknown> {
  id: string;
  title: string;
  /** 界面图标名（IconSymbol）。缺省时按 effect 取类别图标。 */
  icon?: string;
  description: string;
  inputSchema: JsonSchema;
  resolveInputSchema?: (context: AgentToolContext) => JsonSchema;
  effect: AgentToolEffect;
  resolveEffect?: (input: TInput, context: AgentToolContext) => AgentToolEffect;
  isAvailable?: (context: AgentToolContext) => boolean;
  summarizeInput?: (input: TInput) => string;
  summarizeResult?: (result: TResult) => AgentToolDisplay | undefined;
  execute: (input: TInput, context: AgentToolContext) => Promise<TResult> | TResult;
}

export interface PreparedAgentToolCall {
  definition: AgentToolDefinition;
  input: JsonObject;
  inputSummary: string;
}

export interface AgentPromptPayload extends JsonObject {
  message?: string;
  model?: string;
  attachments?: JsonObject[];
  nodeMentions?: JsonObject[];
  projectKey?: string;
  conversationId?: string;
  continuation?: JsonObject;
}

export interface AgentRunResult extends JsonObject {
  requestId: string;
  reply: string;
  model: string;
  toolCallCount: number;
  contextUsage?: JsonObject;
  budget?: JsonObject;
  outcome?: JsonObject;
}

export interface CanvasActionToolInput extends JsonObject {
  actions?: AgentAction[];
  title?: string;
  autoLayout?: boolean;
  selectCreated?: boolean;
}

export type CanvasActionToolResult = AgentBatchResult;

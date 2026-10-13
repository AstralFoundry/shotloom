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
   * 本轮运行所属的主 Agent id。工具可见性完全由 agents/definitions.ts 的
   * 白名单按此 id 解析，不再从会话作用域或工具名前缀猜测。
   * 子 Agent 通过父 Agent 的同一份上下文执行，其独立可见性要到自研 loop 才按
   * session 区分，因此这里的 agentId 始终代表本轮的权限上界。
   */
  agentId: string;
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
  sessionMessages?: JsonObject[];
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
  sessionMessages: JsonObject[];
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

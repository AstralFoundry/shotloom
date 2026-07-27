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
  taskIds: string[];
  error: string;
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
  conversationId: string;
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
  description: string;
  inputSchema: JsonSchema;
  resolveInputSchema?: (context: AgentToolContext) => JsonSchema;
  effect: AgentToolEffect;
  resolveEffect?: (input: TInput, context: AgentToolContext) => AgentToolEffect;
  isAvailable?: (context: AgentToolContext) => boolean;
  summarizeInput?: (input: TInput) => string;
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

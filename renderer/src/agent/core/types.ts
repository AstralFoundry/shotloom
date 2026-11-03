import type { AgentAction, AgentBatchResult, JsonObject, JsonValue } from '@/services/agentTypes';

export type { JsonObject, JsonValue };

export type AgentToolEffect =
  | 'read'
  | 'agent_state_write'
  | 'project_write'
  | 'canvas_write'
  | 'media_generation';

/**
 * 折叠轨迹头部归纳活动用的类别。它描述"这一步在改动哪个对象"，由工具自己声明，
 * 缺省按 effect 归类；界面不得按工具名或文本猜测。
 */
export type AgentToolActivity =
  | 'inspect'
  | 'canvas'
  | 'plan'
  | 'write'
  | 'editor'
  | 'generate'
  | 'skill'
  | 'questions'
  | 'tools';

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

/** Product write revision and active production-plan facts only. */
export interface AgentRunFacts {
  /** 上一次画布写之后的指纹；写围栏靠它拒绝"基于过期快照的覆盖"。 */
  expectedCanvasFingerprint: string;
  activeProductionPlanId: string;
}

/** Trusted product execution scope. Harness owns Session and turn state. */
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
  /** 整轮运行共享的事实；子 Agent 派发时继承同一个对象引用。 */
  run: AgentRunFacts;
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
  /**
   * 折叠轨迹头部的活动类别；缺省按 effect 归类。只在同一 effect 内语义明显不同
   * （例如同样写项目状态但改的是剪辑时间线）时才显式声明。
   */
  activity?: AgentToolActivity;
  resolveEffect?: (input: TInput, context: AgentToolContext) => AgentToolEffect;
  isAvailable?: (context: AgentToolContext) => boolean;
  /**
   * 无论运行模式如何、无论副作用类别，都必须先经用户确认才执行。
   * 用于"模型提议、人类裁决"这一类单点人工闸口（如计划模式收尾），而不是把开放式流程
   * 变成阻塞所有工具的代码门禁；effect 本身仍如实描述它改了什么。
   */
  approvalRequired?: boolean;
  /**
   * execute 的时长上限；缺省用 DEFAULT_AGENT_TOOL_TIMEOUT_MS，0 表示不设上限。
   * 等待用户输入或等待真实渲染完成的工具必须显式声明 0：它们的耗时由用户和厂商决定，
   * 不是本地卡死，不能被当成超时。
   */
  timeoutMs?: number;
  summarizeInput?: (input: TInput) => string;
  summarizeResult?: (result: TResult) => AgentToolDisplay | undefined;
  execute: (input: TInput, context: AgentToolContext) => Promise<TResult> | TResult;
}

export interface PreparedAgentToolCall {
  definition: AgentToolDefinition;
  input: JsonObject;
  inputSummary: string;
}

export interface CanvasActionToolInput extends JsonObject {
  actions?: AgentAction[];
  title?: string;
  autoLayout?: boolean;
  selectCreated?: boolean;
}

export type CanvasActionToolResult = AgentBatchResult;

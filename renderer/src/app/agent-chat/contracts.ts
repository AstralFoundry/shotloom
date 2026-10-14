import type { AgentArtifactRefs } from "./artifactHelpers";
import type { AgentReference } from "./mediaReference";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";

/** 可被 @ 引用的画布节点，以及它在输入区呈现出的媒体预览。 */
export interface MentionableNode {
  id: string;
  alias: string;
  title: string;
  typeLabel: string;
  imageAttachment: Record<string, unknown> | null;
  node: WorkflowNodeData;
}

/**
 * Agent 面板与运行时之间的呈现契约。面板只消费这里声明的数据，
 * 不感知底层 runtime 是哪一个，也不从消息文本反推执行状态。
 */
export interface AgentMessage {
  id: string;
  role: string;
  title?: string;
  content?: string;
  typing?: boolean;
  error?: string;
  retryable?: boolean;
  deliveryStage?: "sent" | "started" | "completed" | "failed" | "cancelled";
  deliveryError?: string;
  diagnosis?: {
    code?: string;
    title?: string;
    message?: string;
    primaryAction?: string;
    suggestions?: string[];
  };
  meta?: string[];
  /** 用户这条消息引用的真实素材，界面按媒体卡呈现。 */
  references?: AgentReference[];
  toolCalls?: AgentToolCall[];
  /** 本轮派发过的子 Agent，用于显示"谁在执行、子任务到哪一步、结论是什么"。 */
  subagents?: AgentSubagentView[];
  productionPlan?: AgentPlanView;
  artifactRefs?: AgentArtifactRefs;
  clarifications?: Array<{
    interactionId?: string;
    runId?: string;
    questions?: Array<{
      id?: string;
      header?: string;
      question?: string;
      options?: string[];
      multiple?: boolean;
      required?: boolean;
    }>;
    answered?: boolean;
    expired?: boolean;
  }>;
}

export interface AgentToolCall {
  id?: string;
  name?: string;
  /** 展示主文案。真实工具由界面从工具注册表解析，技能/模板这类非注册表行由事件层直接给出。 */
  title?: string;
  kind?: "skill" | "recipe" | "tool" | "system";
  effect?: string;
  status?: string;
  summary?: string;
  /** 工具真实产出的文字描述；没有产出时为空，界面不得用入参冒充结果。 */
  output?: string;
  /** 工具产出的本地位图（如抽帧结果），用于让用户核对 Agent 的依据。 */
  previews?: Array<{ path: string; label: string }>;
  pending?: boolean;
  runId?: string;
  stepId?: string;
  interactionId?: string;
  /** 待确认调用的原始参数；存在时用户可以在确认前修改。 */
  pendingArgs?: Record<string, unknown>;
  /** 执行这一步的 Agent 与会话；界面按会话把子 Agent 的步骤归到它的任务下面。 */
  agentId?: string;
  agentSessionId?: string;
  /** 事件到达顺序，用于把子任务标题插在父级步骤之间而不是堆到末尾。 */
  seq?: number;
}

/**
 * 一次子 Agent 派发的呈现视图。`agentId` 可能为空：sidecar 报不出子 Agent 定义，
 * 界面此时只能显示通用文案，不能冒充某个具体 Agent。
 */
export interface AgentSubagentView {
  /** 派发时生成的子会话 id，与工具行的 agentSessionId 对应。 */
  id?: string;
  agentId?: string;
  title?: string;
  /** 父 Agent 交给它的完整任务说明。 */
  task?: string;
  status?: string;
  /** 子 Agent 返回给父级的结论；失败时为空，错误在 error 里。 */
  summary?: string;
  error?: string;
  runId?: string;
  seq?: number;
}

export interface AgentPlanView {
  schemaVersion?: number;
  id?: string;
  title?: string;
  goal?: string;
  executionMode?: string;
  revision?: number;
  stages?: Array<{
    id?: string;
    order?: number;
    title?: string;
    description?: string;
    status?: string;
    authored?: boolean;
    workItems?: Array<{ id?: string; title?: string; outputType?: string; prompt?: string }>;
    runtimeRefs?: Array<{ workItemId?: string; nodeId?: string; taskId?: string }>;
    summary?: string;
    blockedReason?: string;
  }>;
}

export interface ConversationItem {
  id: string;
  editorNodeId?: string;
  title?: string;
  updatedAt?: string;
  pendingInteractionCount?: number;
  waitingKind?: string;
}

export interface AgentController {
  openVideoEditorConversation?: (nodeId: string) => void;
  send: (payload: {
    text: string;
    model: string;
    attachments: unknown[];
    nodeMentions: unknown[];
    /** 展示层引用描述，只随消息持久化，不发给模型。 */
    references?: AgentReference[];
    conversationId?: string;
  }) => boolean;
  clear: (conversationId?: string) => void;
  close: () => void;
  cancel: () => void;
  retry: (messageId: string) => void;
  newConversation: (editorNodeId?: string) => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  changeModel: (model: string) => void;
  submitClarification: (payload: unknown) => void;
  approveToolCall: (payload: unknown) => void;
  rejectToolCall: (payload: unknown) => void;
  focusNodes: (nodeIds: string[]) => void;
}

export interface AgentPanelHandle {
  /** 画布「加入对话」入口：按节点 id 追加一条引用。 */
  addNodeMentionById: (nodeId: string) => void;
}

export interface TextModelOption {
  id: string;
  label: string;
  iconId: string;
}

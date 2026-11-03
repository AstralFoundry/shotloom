import type { NodeType } from '../domain/graph/NodeType';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type AgentNodeType = Exclude<NodeType, 'clipStudio'>;

export const CANVAS_ARTIFACT_TYPES = ['character', 'scene', 'storyboard', 'prop', 'other'] as const;
export type CanvasArtifactType = typeof CANVAS_ARTIFACT_TYPES[number];

/** 旧项目没有用途标注；保留为 other，不从标题或提示词猜。 */
export function canvasArtifactType(value: unknown): CanvasArtifactType {
  return CANVAS_ARTIFACT_TYPES.includes(value as CanvasArtifactType)
    ? value as CanvasArtifactType : 'other';
}

export type AgentInputRole =
  | 'textContext'
  | 'referenceImage'
  | 'inputVideo'
  | 'referenceAudio';
export type AgentInputMode = 'reference' | 'firstFrame' | 'firstLastFrame' | 'videoExtension';
export type AgentInputSlot = 'reference' | 'firstFrame' | 'lastFrame' | 'inputVideo' | 'referenceAudio';

export interface AgentAttachment extends JsonObject {
  name?: string;
  fileName?: string;
  path?: string;
  filePath?: string;
  url?: string;
  mimeType?: string;
  type?: string;
  materialId?: string;
  resourceType?: string;
  size?: number;
}

export interface AgentInputLink extends JsonObject {
  nodeId: string;
  role?: AgentInputRole;
  slot?: AgentInputSlot;
  required?: boolean;
}

export interface AgentAction extends JsonObject {
  type: string;
  tempId?: string;
  nodeId?: string;
  assetId?: string;
  materialId?: string;
  assetName?: string;
  nodeType?: AgentNodeType | string;
  artifactType?: CanvasArtifactType;
  title?: string;
  name?: string;
  content?: string;
  prompt?: string;
  model?: string;
  recipeId?: string;
  source?: string;
  target?: string;
  id?: string;
  role?: AgentInputRole;
  inputMode?: AgentInputMode;
  slot?: AgentInputSlot;
  required?: boolean;
  force?: boolean;
  config?: JsonObject;
  outputSpec?: JsonObject;
  data?: JsonObject & { attachments?: AgentAttachment[] };
  inputLinks?: AgentInputLink[];
  position?: { x?: number; y?: number };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface AgentActionRequest extends JsonObject {
  actions: AgentAction[];
  projectKey?: string;
  projectInstanceId?: string;
  projectGeneration?: number;
  conversationId?: string;
  runId?: string;
  title?: string;
  name?: string;
  source?: string;
  batchId?: string;
  autoLayout?: boolean;
  selectCreated?: boolean;
  trackBatch?: boolean;
}

export interface AgentActionResult {
  [key: string]: unknown;
  applied: boolean;
  createdNodeId?: string;
  nodeId?: string;
  taskId?: string | null;
  batchId?: string;
  error?: string | undefined;
}

export interface AgentBatchResult {
  [key: string]: unknown;
  success: boolean;
  complete?: boolean;
  error?: string;
  appliedCount?: number;
  skippedCount?: number;
  createdNodeIds?: string[];
  changedNodeIds?: string[];
  startedTaskIds?: string[];
  actionResults?: AgentActionResult[];
  agentBatch?: JsonObject | null;
  validation?: unknown;
}

export interface AgentNode extends JsonObject {
  id: string;
  type: AgentNodeType | string;
  artifactType?: CanvasArtifactType;
  title?: string;
  name?: string;
  status?: string;
  model?: string;
  inputMode?: AgentInputMode;
  prompt?: string;
  recipeId?: string;
  config?: JsonObject;
  outputSpec?: JsonObject;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alias?: string | null;
  agentSemanticId?: string;
  agentTempId?: string;
  segmentIds?: string[];
  artifactRole?: string;
  agentPlan?: JsonObject & {
    id?: string;
    semanticId?: string;
    segmentIds?: string[];
    artifactRole?: string;
  };
}

export interface AgentTask extends JsonObject {
  id: string;
  nodeId: string;
  status: string;
  remoteTaskId?: string;
  error?: string;
  startedAt?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface AgentEdge extends JsonObject {
  id: string;
  source: string;
  target: string;
  data?: JsonObject;
}

export interface AgentProject extends JsonObject {
  name?: string;
  schema?: string;
  updatedAt?: string;
  nodes: AgentNode[];
  edges: AgentEdge[];
  tasks: AgentTask[];
  assets?: JsonValue[];
  materials?: JsonValue[];
  agentBatches?: JsonObject[];
  agentEvaluations?: JsonObject[];
}

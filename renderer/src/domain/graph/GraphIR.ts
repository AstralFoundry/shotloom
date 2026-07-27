/**
 * Graph Intermediate Representation — 画布图的类型定义。
 * 框架无关，不依赖 Vue、Vue Flow 或任何具体 Store。
 */

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  status: string;
  x?: number;
  y?: number;
  archived?: boolean;
  model?: string;
  prompt?: string;
  recipeId?: string;
  config?: Record<string, unknown>;
  data?: Record<string, unknown>;
  segmentIds?: string[];
  artifactRole?: string;
  agentPlan?: AgentPlanMeta | null;
  agentTempId?: string;
  agentSemanticId?: string;
  resourceType?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  previewUrl?: string;
  remoteUrl?: string;
  objectKey?: string;
  materialId?: string;
  mimeType?: string;
  content?: string;
  boardText?: string;
  boardData?: unknown;
  directorData?: unknown;
  selectedOutputNodeId?: string;
  selectedOutput?: unknown;
  uploadedFile?: unknown;
  imageEdit?: unknown;
  retryCount?: number;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind?: string;
  data?: {
    inputRole?: string;
    required?: boolean;
    skipTaskInput?: boolean;
    [key: string]: unknown;
  };
}

export interface GraphTask {
  id: string;
  nodeId: string;
  title: string;
  type: string;
  model: string;
  status: string;
  progress: number;
  runner?: string;
  remoteTaskId?: string;
  requestPayload?: unknown;
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  retryCount?: number;
  [key: string]: unknown;
}

export interface GraphProject {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tasks: GraphTask[];
  materials?: unknown[];
  aliasMap?: Record<string, string>;
  tempIdMap?: Record<string, string>;
}

export interface AgentPlanMeta {
  id: string;
  runId: string;
  source: string;
  artifactRole: string;
  segmentIds: string[];
  dependsOn?: string[];
  semanticId?: string;
}

// ── Graph Mutation Specs ─────────────────────────────────────────────────────

export interface NodeSpec {
  id?: string;
  tempId?: string;
  type: string;
  title: string;
  model?: string;
  prompt?: string;
  recipeId?: string;
  config?: Record<string, unknown>;
  data?: Record<string, unknown>;
  segmentIds?: string[];
  artifactRole?: string;
  agentPlan?: AgentPlanMeta | null;
  resourceType?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  previewUrl?: string;
  remoteUrl?: string;
  objectKey?: string;
  materialId?: string;
  mimeType?: string;
  content?: string;
  [key: string]: unknown;
}

export interface EdgeSpec {
  id?: string;
  source: string;
  target: string;
  kind?: string;
  data?: {
    inputRole?: string;
    required?: boolean;
    skipTaskInput?: boolean;
    [key: string]: unknown;
  };
}

export interface NodePatch {
  id: string;
  config?: Record<string, unknown>;
  title?: string;
  model?: string;
  prompt?: string;
  status?: string;
  [key: string]: unknown;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ── Transaction ──────────────────────────────────────────────────────────────

export interface TransactionState {
  createdNodes: NodeSpec[];
  createdEdges: EdgeSpec[];
  updatedNodes: NodePatch[];
  deletedNodeIds: string[];
  layoutRequested: boolean;
  layoutNodeIds: string[];
  layoutOptions: Record<string, unknown>;
}

export interface CommitResult {
  success: boolean;
  createdNodeIds: string[];
  changedNodeIds: string[];
  deletedNodeIds: string[];
  createdEdgeCount: number;
  layoutApplied: boolean;
  error?: string;
  validationErrors?: ValidationError[];
}

export interface RollbackResult {
  success: boolean;
  reason?: string;
}

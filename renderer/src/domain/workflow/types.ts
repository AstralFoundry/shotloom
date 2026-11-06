/**
 * 可复用工作流的模板契约。
 *
 * 模板由两部分组成，必须分开存放：
 * - `definition` 是可分享的结构：槽位、端口、输出，不含提示词、模型与原始素材；
 * - `recipe` 是私有配方：每个生成步骤当时的提示词、模型与参数，只在本机随模板保存。
 *
 * 这样导出的模板能换素材重跑，又不会把创作者的提示词和素材带出去。
 */

export type WorkflowRole = 'input' | 'constant' | 'generation';
export type WorkflowMediaType = 'image' | 'video' | 'audio' | 'text';

/** 模板里的轻量缩略图：只用于展示流程，不参与运行。 */
export interface WorkflowNodePreview {
  kind: 'image' | 'video' | 'audio' | 'text';
  /** 小尺寸 JPEG data URL；视频取首帧胶片带。可能缺省（解码失败/超限）。 */
  dataUrl?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** 素材名或节点标题，展示在缩略图下方。 */
  label?: string | undefined;
}

export interface WorkflowDefinitionNode {
  id: string;
  /** 槽位名称（通用名，如「图片输入」「生成步骤」），由编译方生成，用户可改。 */
  title: string;
  role: WorkflowRole;
  mediaType: WorkflowMediaType;
  /** 可替换输入的当前绑定；导出时清空。 */
  resourceId?: string;
  /** 固定文本内容。 */
  text?: string;
  /** 保存时截取的缩略图，跨项目仍可展示；实例化时忽略。 */
  preview?: WorkflowNodePreview | undefined;
}

export interface WorkflowDefinitionEdge {
  fromNodeId: string;
  toNodeId: string;
  /** 目标节点的输入槽位（如 reference / firstFrame），对应画布 edge.data.inputSlot。 */
  toPort?: string;
  /** 输入用途（如 referenceImage），用于重建 typed-input 连线。 */
  inputRole?: string;
}

export interface WorkflowDefinition {
  version: 1;
  nodes: WorkflowDefinitionNode[];
  edges: WorkflowDefinitionEdge[];
  outputNodeIds: string[];
}

/** 生成步骤的私有配方：运行时用它重建节点的提示词与参数。 */
export interface WorkflowRecipeNode {
  prompt?: string;
  model?: string;
  config?: Record<string, unknown>;
  outputSpec?: unknown;
  sourceTaskId?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  revision: number;
  definition: WorkflowDefinition;
  recipe: Record<string, WorkflowRecipeNode>;
  createdAt: string;
  updatedAt: string;
}

/** 可分享副本：去掉私有配方与素材绑定。 */
export interface ShareableWorkflowTemplate {
  format: 'shotloom.workflow-template';
  formatVersion: 1;
  id: string;
  name: string;
  description: string;
  revision: number;
  definition: WorkflowDefinition;
  exportedAt: string;
}

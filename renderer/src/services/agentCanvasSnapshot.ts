import { settingsStore } from '@/store/settingsStore';
import { listAgentBatches } from '@/store/agentBatchStore';
import { listAgentSteps } from '@/store/agentStepStore';
import { listAgentEvaluations } from '@/store/agentEvaluationStore';
import { listGeneratedResourcesForNode } from '@/store/resourceNodeStore';
import { buildCanvasContext } from '@/services/agentCanvasContext';
import { agentNodeAliasMaps } from './agentNodeAlias.mjs';
import type { AgentNode, AgentProject, JsonObject } from './agentTypes';

export { agentNodeAliasMaps, agentNodeStableAlias } from './agentNodeAlias.mjs';

interface SnapshotOptions {
  project: AgentProject;
  projectDir?: string | null;
  filePath?: string | null;
  selection?: { selectedNodeId?: string | null; selectedNodeIds?: string[] };
  route?: unknown;
  tempIds?: JsonObject;
  history?: { canUndo?: boolean; canRedo?: boolean };
  request?: JsonObject;
}

const OUTPUT_NODE_TYPES = new Set([
  'imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration', 'board', 'threeDDirector',
]);

/**
 * 先构造 Renderer 内部完整事实，再由 agentCanvasContext 按请求裁剪。
 * 完整快照仍用于旧协议和最终验收；日常模型调用应使用 summary/timeline/working。
 */
export function buildAgentCanvasSnapshot({ project, projectDir, filePath, selection, route, tempIds, history, request = {} }: SnapshotOptions) {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const rawNodes = clone(Array.isArray(project.nodes) ? project.nodes : []);
  const edges = clone(Array.isArray(project.edges) ? project.edges : []);
  const tasks = clone(Array.isArray(project.tasks) ? project.tasks : []);
  const maps = agentNodeAliasMaps(rawNodes);
  const nodes = rawNodes.map((node) => ({
    ...node,
    alias: maps.aliasById[node.id] || null,
  }));
  const fullSnapshot = {
    success: true,
    project: {
      name: project.name,
      schema: project.schema,
      settings: clone(project.settings || {}),
      updatedAt: project.updatedAt || null,
    },
    projectDir: projectDir || null,
    filePath: filePath || null,
    nodes,
    edges,
    tasks,
    assets: clone(project.assets || []),
    materials: clone(project.materials || []),
    agentBatches: clone(listAgentBatches(project).map((batch: any) => ({
      id: batch.id,
      batchId: batch.batchId,
      title: batch.title,
      source: batch.source,
      status: batch.status,
      createdNodeIds: batch.createdNodeIds,
      changedNodeIds: batch.changedNodeIds,
      startedTaskIds: batch.startedTaskIds,
      taskCounts: batch.taskCounts,
      createdAt: batch.createdAt,
    }))),
    agentSteps: clone(listAgentSteps(project).map((step: any) => ({
      id: step.id,
      stepId: step.stepId,
      title: step.title,
      source: step.source,
      status: step.status,
      actionCount: step.actionCount,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    }))),
    agentEvaluations: clone(listAgentEvaluations(project)),
    canvasHistory: {
      canUndo: Boolean(history?.canUndo),
      canRedo: Boolean(history?.canRedo),
      undoCount: Array.isArray(project.canvasHistory) ? project.canvasHistory.length : 0,
      redoCount: Array.isArray(project.canvasRedoStack) ? project.canvasRedoStack.length : 0,
    },
    generatedOutputs: Object.fromEntries(nodes
      .filter((node) => OUTPUT_NODE_TYPES.has(node.type))
      .map((node) => [node.id, clone(listGeneratedResourcesForNode(project, node.id))])),
    selectedNodeId: selection?.selectedNodeId || null,
    selectedNodeIds: [...(selection?.selectedNodeIds || [])],
    route,
    ...(tempIds || {}),
    agentSettings: {
      autoEval: settingsStore.agentAutoEval,
      autoLayout: settingsStore.agentAutoLayout,
      preferredTextModel: settingsStore.agentPreferredTextModel,
      preferredImageModel: settingsStore.agentPreferredImageModel,
      preferredVideoModel: settingsStore.agentPreferredVideoModel,
    },
    ...maps,
  };
  return buildCanvasContext(project, fullSnapshot as any, request as any);
}

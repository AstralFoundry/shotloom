/**
 * GraphValidator — 画布结构校验。
 *
 * 只检查结构问题，不涉及模型能力业务判断。
 * - 节点存在
 * - 不能自己连接自己
 * - 不允许重复的完全相同连线
 * - 必要时禁止循环
 */

import type {
  EdgeSpec,
  GraphEdge,
  GraphNode,
  GraphProject,
  NodePatch,
  NodeSpec,
  ValidationError,
  ValidationResult,
} from './GraphIR';
import { isGenerationNodeType } from './GenerationNodeContract.ts';

function nodeExists(project: GraphProject, id: string): boolean {
  return project.nodes.some((node) => node.id === id && !node.archived);
}

function nodeExistsInCreated(createdNodes: NodeSpec[], id: string): boolean {
  return createdNodes.some((node) => node.id === id || node.tempId === id);
}

function resolveId(project: GraphProject, createdNodes: NodeSpec[], id: string): string | null {
  if (nodeExists(project, id)) return id;
  if (nodeExistsInCreated(createdNodes, id)) return id;
  const persistedId = project.tempIdMap?.[id];
  if (persistedId && nodeExists(project, persistedId)) return persistedId;
  return null;
}

/**
 * 校验一组即将创建的节点和连线在项目上下文中的结构合法性。
 */
export function validateGraphMutations(
  project: GraphProject,
  createdNodes: NodeSpec[],
  createdEdges: EdgeSpec[],
  _updatedNodes: NodePatch[],
  deletedNodeIds: string[],
): ValidationResult {
  const errors: ValidationError[] = [];
  const allLiveIds = new Set([
    ...project.nodes.filter((n) => !n.archived).map((n) => n.id),
    ...createdNodes.map((n) => n.id || n.tempId || ''),
  ].filter(Boolean));
  const existingIds = new Set(project.nodes.map((node) => node.id));

  // Self-connection check
  for (const edge of createdEdges) {
    const source = resolveId(project, createdNodes, edge.source) || edge.source;
    const target = resolveId(project, createdNodes, edge.target) || edge.target;
    if (source === target) {
      errors.push({
        code: 'SELF_LOOP',
        message: `节点不能连接自身: ${edge.source}`,
        path: `edges[source=${edge.source}, target=${edge.target}]`,
      });
    }
  }

  // Source/target existence check
  for (const edge of createdEdges) {
    const sourceExists = allLiveIds.has(edge.source) || resolveId(project, createdNodes, edge.source) !== null;
    const targetExists = allLiveIds.has(edge.target) || resolveId(project, createdNodes, edge.target) !== null;

    if (!sourceExists) {
      errors.push({
        code: 'MISSING_SOURCE',
        message: `连线源节点不存在: ${edge.source}`,
        path: `edges[source=${edge.source}]`,
      });
    }
    if (!targetExists) {
      errors.push({
        code: 'MISSING_TARGET',
        message: `连线目标节点不存在: ${edge.target}`,
        path: `edges[target=${edge.target}]`,
      });
    }
  }

  // Duplicate edge check (same source → target with same kind)
  const existingPairs = new Set(
    project.edges.map((e) => `${e.source}→${e.target}::${e.kind || 'default'}`),
  );
  for (const edge of createdEdges) {
    const source = resolveId(project, createdNodes, edge.source) || edge.source;
    const target = resolveId(project, createdNodes, edge.target) || edge.target;
    const pairKey = `${source}→${target}::${edge.kind || 'default'}`;
    if (existingPairs.has(pairKey)) {
      errors.push({
        code: 'DUPLICATE_EDGE',
        message: `重复的连线: ${pairKey}`,
        path: `edges[${pairKey}]`,
      });
    }
    existingPairs.add(pairKey);
  }

  // Deleted nodes actually exist
  for (const id of deletedNodeIds) {
    if (!nodeExists(project, id)) {
      errors.push({
        code: 'MISSING_DELETE_TARGET',
        message: `待删除节点不存在: ${id}`,
        path: `deleteNodeIds[${id}]`,
      });
    }
  }

  // Created nodes must have unique IDs
  const createdIds = new Set<string>();
  for (const node of createdNodes) {
    const id = node.id || node.tempId || '';
    if (!id) continue;
    if (createdIds.has(id) || existingIds.has(id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `节点 ID 重复: ${id}`,
        path: `createdNodes[id=${id}]`,
      });
    }
    createdIds.add(id);
  }

  // New nodes must have a type
  for (let i = 0; i < createdNodes.length; i++) {
    const node = createdNodes[i];
    if (!node.type) {
      errors.push({
        code: 'MISSING_NODE_TYPE',
        message: `createdNodes[${i}] 缺少 type 字段`,
        path: `createdNodes[${i}]`,
      });
    }
    if (isGenerationNodeType(node.type)) {
      if (!String(node.prompt || '').trim()) {
        errors.push({
          code: 'MISSING_NODE_PROMPT',
          message: `生成节点 ${node.title || node.tempId || node.id || i} 缺少顶层 prompt`,
          path: `createdNodes[${i}].prompt`,
        });
      }
      if (node.config && ('prompt' in node.config || 'model' in node.config)) {
        errors.push({
          code: 'DUPLICATE_GENERATION_FIELDS',
          message: `生成节点 ${node.title || node.tempId || node.id || i} 的 config 不得包含 prompt/model`,
          path: `createdNodes[${i}].config`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 快速 DAG 循环检测，返回是否存在循环。
 */
export function hasDependencyCycle(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets) targets.add(edge.target);
  }

  const visited = new Set<string>();
  const active = new Set<string>();

  function dfs(id: string): boolean {
    if (active.has(id)) return true; // cycle detected
    if (visited.has(id)) return false;
    active.add(id);
    visited.add(id);
    for (const neighbor of adjacency.get(id) || []) {
      if (dfs(neighbor)) return true;
    }
    active.delete(id);
    return false;
  }

  for (const nodeId of adjacency.keys()) {
    if (dfs(nodeId)) return true;
  }
  return false;
}

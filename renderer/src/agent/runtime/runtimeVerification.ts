import type { AgentToolReceipt, JsonObject } from '../core/types';
import { receiptChangesProject, receiptProvesCompletion } from './toolReceipts.ts';

export interface AgentOutcome extends JsonObject {
  status: 'completed' | 'partial' | 'blocked';
  summary: string;
  evidence?: JsonObject;
  remaining?: string[];
}

export interface OutcomeVerificationInput {
  project: JsonObject;
  outcome: AgentOutcome;
  hasAppliedActions: boolean;
  toolReceipts: Map<string, AgentToolReceipt>;
  productionPlan?: JsonObject;
}

export function verifyAgentOutcome(input: OutcomeVerificationInput) {
  const { project, outcome } = input;
  const issues: string[] = [];
  const evidence = (outcome.evidence || {}) as JsonObject;
  const nodeIds = new Set(((evidence.nodeIds as string[] | undefined) || []).map(String));
  const taskIds = new Set(((evidence.taskIds as string[] | undefined) || []).map(String));
  const toolCallIds = new Set(((evidence.toolCallIds as string[] | undefined) || []).map(String));
  const nodes = new Set((((project.nodes as JsonObject[] | undefined) || []).map((node) => String(node.id))));
  const tasks = ((project.tasks as JsonObject[] | undefined) || []);
  const taskById = new Map(tasks.map((task) => [String(task.id), task]));
  const citedReceipts: AgentToolReceipt[] = [];

  if (!outcome.summary.trim()) issues.push('结果摘要不能为空');
  for (const nodeId of nodeIds) if (!nodes.has(nodeId)) issues.push(`证据节点不存在：${nodeId}`);
  for (const taskId of taskIds) if (!taskById.has(taskId)) issues.push(`证据任务不存在：${taskId}`);
  for (const callId of toolCallIds) {
    const receipt = input.toolReceipts.get(callId);
    if (!receipt?.success) {
      issues.push(`工具调用未成功或不属于本轮：${callId}`);
    } else {
      citedReceipts.push(receipt);
    }
  }

  if (outcome.status === 'completed') {
    const completionReceipts = citedReceipts.filter(receiptProvesCompletion);
    const citedWriteReceipts = citedReceipts.filter(receiptChangesProject);
    for (const receipt of citedWriteReceipts) {
      if (receipt.partial) issues.push(`工具调用仅部分成功，不能证明完整完成：${receipt.callId}`);
    }
    if (input.hasAppliedActions && completionReceipts.length === 0) {
      issues.push('本轮修改了项目，但完成声明没有提供完整成功的写入工具回执');
    }
    const receiptTaskIds = completionReceipts.flatMap((receipt) => receipt.taskIds);
    const allTaskIds = new Set([...taskIds, ...receiptTaskIds]);
    for (const taskId of allTaskIds) {
      const status = String(taskById.get(taskId)?.status || '');
      if (status !== 'completed') issues.push(`任务没有明确成功终态：${taskId}（${status || '状态为空'}）`);
    }
    const planStages = (input.productionPlan?.stages as JsonObject[] | undefined) || [];
    const unfinished = planStages.filter((stage) => String(stage.status || '') !== 'done');
    if (unfinished.length) issues.push(`制作计划仍有 ${unfinished.length} 个阶段未完成，整轮不能标记为 completed`);
  }

  if (outcome.status !== 'completed' && !(outcome.remaining || []).some((item) => String(item).trim())) {
    issues.push('部分完成或阻塞时必须说明剩余事项');
  }
  return { success: issues.length === 0, issues };
}

interface CanvasDigest extends JsonObject {
  nodes: Record<string, string>;
  edges: Record<string, string>;
}

export function captureCanvasDigest(project: any): CanvasDigest {
  return {
    nodes: Object.fromEntries((project.nodes || []).map((node: any) => [node.id, JSON.stringify({
      type: node.type, title: node.title || '', prompt: node.prompt || '', model: node.model || '',
      outputSpec: node.outputSpec || {}, config: node.config || {}, status: node.status || '',
      x: node.x, y: node.y, recipeId: node.recipeId || '',
    })])),
    edges: Object.fromEntries((project.edges || []).map((edge: any) => [edge.id, JSON.stringify({
      source: edge.source, target: edge.target, role: edge.data?.role || '', required: edge.data?.required !== false,
    })])),
  };
}

export function evaluateCanvasMutation(before: CanvasDigest, project: any) {
  const after = captureCanvasDigest(project);
  const beforeNodeIds = new Set(Object.keys(before.nodes));
  const afterNodeIds = new Set(Object.keys(after.nodes));
  const beforeEdgeIds = new Set(Object.keys(before.edges));
  const afterEdgeIds = new Set(Object.keys(after.edges));
  const addedNodeIds = [...afterNodeIds].filter((id) => !beforeNodeIds.has(id));
  const removedNodeIds = [...beforeNodeIds].filter((id) => !afterNodeIds.has(id));
  const changedNodeIds = [...afterNodeIds].filter((id) => beforeNodeIds.has(id) && before.nodes[id] !== after.nodes[id]);
  const addedEdgeIds = [...afterEdgeIds].filter((id) => !beforeEdgeIds.has(id));
  const removedEdgeIds = [...beforeEdgeIds].filter((id) => !afterEdgeIds.has(id));
  const issues: string[] = [];
  for (const nodeId of [...addedNodeIds, ...changedNodeIds]) {
    const node = (project.nodes || []).find((item: any) => item.id === nodeId);
    if (!node || !['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) continue;
    if (!String(node.prompt || '').trim()) issues.push(`${node.title || node.id} 缺少 prompt`);
    if (!String(node.model || '').trim()) issues.push(`${node.title || node.id} 缺少 model`);
    if (node.config?.prompt != null || node.config?.model != null) issues.push(`${node.title || node.id} 的 config 含重复 prompt/model`);
  }
  return {
    success: issues.length === 0,
    issues,
    delta: { addedNodeIds, removedNodeIds, changedNodeIds, addedEdgeIds, removedEdgeIds },
    changed: addedNodeIds.length + removedNodeIds.length + changedNodeIds.length + addedEdgeIds.length + removedEdgeIds.length > 0,
  };
}

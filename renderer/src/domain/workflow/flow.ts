/**
 * 模板的可视化流程：把输入、生成步骤与输出整理成从左到右的展示顺序。
 * 生成步骤用拓扑序，保证「先跑谁」与执行顺序一致。
 */
import { generationExecutionOrder } from './instance';
import type { WorkflowDefinition, WorkflowDefinitionNode, WorkflowTemplate } from './types';

export interface WorkflowFlowStage {
  role: 'input' | 'constant' | 'generation' | 'output';
  node: WorkflowDefinitionNode;
}

/**
 * 只产出「输入 + 生成步骤」两类卡片；输出本身就是某些生成步骤，
 * 由界面用 outputNodeIds 打标签，不再重复出一张卡。
 */
export function workflowFlowStages(definition: WorkflowDefinition): WorkflowFlowStage[] {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const inputs = definition.nodes
    .filter((node) => node.role === 'input' || node.role === 'constant')
    .map((node) => ({ role: node.role, node } as WorkflowFlowStage));
  const order = generationExecutionOrder(definition).order;
  const steps = order
    .map((id) => byId.get(id))
    .filter((node): node is WorkflowDefinitionNode => Boolean(node))
    .map((node) => ({ role: 'generation', node } as WorkflowFlowStage));
  return [...inputs, ...steps];
}

export function templateFlowStages(template: WorkflowTemplate): WorkflowFlowStage[] {
  return workflowFlowStages(template.definition);
}

/** 导出/分享前压缩缩略图预算：单张与总量都设上限，超出的直接丢弃。 */
export function trimNodePreviews(
  definition: WorkflowDefinition,
  { maxPerNode = 120 * 1024, maxTotal = 600 * 1024 } = {},
): WorkflowDefinition {
  let total = 0;
  const nodes = definition.nodes.map((node) => {
    const dataUrl = node.preview?.dataUrl || '';
    if (!dataUrl) return node;
    if (dataUrl.length > maxPerNode || total + dataUrl.length > maxTotal) {
      const clone = { ...node };
      delete clone.preview;
      return clone;
    }
    total += dataUrl.length;
    return node;
  });
  return { ...definition, nodes };
}

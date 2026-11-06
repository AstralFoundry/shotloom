/**
 * 修复「模型不可用」的存量节点。
 *
 * 默认模型修复只对新建节点生效；旧项目里已经写死 OpenAI 模型的节点不会自己变。
 * 这里提供一个显式动作：把没有凭据的生成节点切到同类型、同输入方式且可用的模型。
 * 会先记一步撤销，切换结果逐节点返回，便于用户核对。
 */

import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import { store, touchProject } from '@/store/projectStore';
import { ensureGenerationConfig } from '@/store/nodeStore';
import { getAvailableModelIdsByType, getModelCredentialStatus } from '@/store/settingsStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';

type AnyNode = Record<string, any>;

export interface NodeModelRepairResult {
  repaired: Array<{ nodeId: string; from: string; to: string }>;
  skipped: Array<{ nodeId: string; reason: string }>;
}

const GENERATION_TYPES = new Set(['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration']);

function needsReferenceInput(node: AnyNode): boolean {
  if (node.imageRecipe) return true;
  return ((store.project.edges || []) as AnyNode[]).some((edge) => (
    edge.target === node.id && edge.data?.inputRole === 'referenceImage'
  ));
}

function chooseModel(node: AnyNode): string {
  const available = getAvailableModelIdsByType(String(node.type));
  if (!available.length) return '';
  const wantsReference = needsReferenceInput(node);
  const preferredMode = String(node.inputMode || '');
  const candidates = available.filter((model) => {
    const modes = getGenerationInputModes(model);
    if (!modes.length) return false;
    if (wantsReference && !modes.some((mode) => mode.maxImages > 0)) return false;
    return true;
  });
  if (!candidates.length) return '';
  if (preferredMode) {
    const sameMode = candidates.find((model) => getGenerationInputModes(model).some((mode) => mode.value === preferredMode));
    if (sameMode) return sameMode;
  }
  return candidates[0] as string;
}

/**
 * 就地修复；没有任何改动时不写项目、不产生撤销记录。
 */
export function repairUnconfiguredNodeModels(): NodeModelRepairResult {
  const result: NodeModelRepairResult = { repaired: [], skipped: [] };
  const nodes = ((store.project.nodes || []) as AnyNode[]).filter((node) => !node.archived && GENERATION_TYPES.has(String(node.type)));
  const changes: AnyNode[] = [];

  for (const node of nodes) {
    const current = String(node.model || '');
    if (current && getModelCredentialStatus(current).available) continue;
    const next = chooseModel(node);
    if (!next || next === current) {
      result.skipped.push({ nodeId: String(node.id), reason: next ? 'unchanged' : 'no-available-model' });
      continue;
    }
    changes.push({ node, next });
    result.repaired.push({ nodeId: String(node.id), from: current, to: next });
  }

  if (!changes.length) return result;
  recordCanvasHistory('修复未配置的节点模型');
  for (const { node, next } of changes) {
    node.model = next;
    const modes = getGenerationInputModes(next);
    const keepMode = modes.some((mode) => mode.value === node.inputMode);
    node.inputMode = keepMode ? node.inputMode : (modes[0]?.value || node.inputMode);
    ensureGenerationConfig(node);
  }
  touchProject();
  return result;
}

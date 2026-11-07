import { t } from '@/i18n';
import { canvasNodeDimensions, type CanvasSizedNode } from '@/domain/graph/CanvasNodeDimensions';
import { defaultInputSlot } from '@/domain/graph/GenerationInputContract';
import {
  MASK_EDIT_MODE,
  composeMaskEditPrompt,
  maskEditCapabilityFor,
  maskEditInputModeValue,
} from '@/domain/graph/imageMask';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode, ensureGenerationConfig, setSelectedNodeIds } from '@/store/nodeStore';
import { showToast } from '@/store/notificationStore';
import { store, touchProject } from '@/store/projectStore';
import { runNode } from '@/store/taskStore';
import { localMediaPath, selectedNodeMedia } from '@/utils/nodeMedia';

type AnyNode = Record<string, any>;

export interface MaskEditInput {
  prompt: string;
  maskFilePath: string;
  /** 面板里选中的模型；省略时沿用源节点模型。 */
  model?: string;
  /** 面板里选中的生成参数；省略时用该模型默认值。 */
  config?: Record<string, unknown>;
}

/** 局部重绘与表情调节共享的落节点参数：两者都是「原图 + 蒙版 + 提示词」的派生编辑。 */
export interface MaskedEditNodeInput {
  prompt: string;
  maskFilePath: string;
  mode: string;
  title: (sourceName: string) => string;
  historyLabel: string;
  creationSource: string;
  model?: string;
  config?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

const MASK_NODE_GAP = 96;

function findImageNode(nodeId: string): AnyNode | null {
  return (store.project.nodes as AnyNode[])
    .find((node) => node.id === nodeId && node.type === 'imageGeneration' && !node.archived) ?? null;
}

/**
 * 把蒙版落到一张派生图片节点上：
 * - 源图仍用 referenceImage 边接入，模型拿到的是「原图 + 蒙版 + 提示词」；
 * - 蒙版与源图的路径写进节点 imageEdit，运行前再由 generationPayload 校验模型能力；
 * - 生成结果和原节点分开，源图不被覆盖。
 */
export function createMaskedEditNode(nodeId: string, input: MaskedEditNodeInput): boolean {
  const source = findImageNode(nodeId);
  const sourcePath = source ? localMediaPath(selectedNodeMedia(source, store.project)) : '';
  if (!source || !sourcePath) {
    showToast(t('imageEdit.error.source'));
    return false;
  }
  const maskFilePath = String(input.maskFilePath || '');
  if (!maskFilePath) {
    showToast(t('imageEdit.error.mask'));
    return false;
  }
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    showToast(t('imageEdit.error.prompt'));
    return false;
  }
  const model = String(input.model || source.model || '');
  const capability = maskEditCapabilityFor(model);
  if (!capability.supported) {
    showToast(t('imageEdit.error.model'));
    return false;
  }

  recordCanvasHistory(input.historyLabel);
  const derived = addNode('imageGeneration');
  const dimensions = canvasNodeDimensions(source as CanvasSizedNode);
  const sourceName = String(source.title || '').trim() || t('imageMask.fallbackName');
  derived.title = input.title(sourceName);
  derived.model = model;
  // 没有显式参数时沿用源节点的生成参数，避免派生节点悄悄换回默认尺寸。
  derived.config = input.config && typeof input.config === 'object'
    ? { ...input.config }
    : { ...(source.config || {}) };
  ensureGenerationConfig(derived);
  derived.prompt = prompt;
  derived.imageEdit = {
    mode: input.mode,
    sourceFile: sourcePath,
    maskFile: maskFilePath,
  };
  derived.generatedFrom = { nodeId: source.id, type: input.creationSource };
  derived.artifactType = source.artifactType || 'other';
  if (source.outputSpec && typeof source.outputSpec === 'object') {
    derived.outputSpec = { ...source.outputSpec };
  }
  derived.x = Math.round(Number(source.x || 0) + dimensions.width + MASK_NODE_GAP);
  derived.y = Math.round(Number(source.y || 0));
  if (input.fields && typeof input.fields === 'object') Object.assign(derived, input.fields);
  const inputMode = maskEditInputModeValue(model);
  if (inputMode) derived.inputMode = inputMode;

  const derivedId = String(derived.id);
  const edge = addCanvasEdge(store.project, String(source.id), derivedId, {
    touch: false,
    kind: 'typed-input',
    edge: {
      data: {
        inputRole: 'referenceImage',
        inputSlot: defaultInputSlot(inputMode || 'reference', 'referenceImage'),
        required: true,
        creationSource: input.creationSource,
      },
    },
  });
  if (!edge.ok) showToast(edge.error || t('imageEdit.error.source'));

  setSelectedNodeIds([derivedId]);
  touchProject();
  // runNode 自己会校验凭据、上游输入与蒙版能力。
  runNode(derived);
  return true;
}

export function applyMaskEdit(nodeId: string, input: MaskEditInput): boolean {
  if (!String(input.prompt || '').trim()) {
    showToast(t('imageMask.error.prompt'));
    return false;
  }
  return createMaskedEditNode(nodeId, {
    prompt: composeMaskEditPrompt(input.prompt),
    maskFilePath: input.maskFilePath,
    mode: MASK_EDIT_MODE,
    title: (name) => t('imageMask.derivedTitle', { name }),
    historyLabel: t('imageMask.history'),
    creationSource: 'image-mask-edit',
    ...(input.model ? { model: input.model } : {}),
    ...(input.config ? { config: input.config } : {}),
  });
}

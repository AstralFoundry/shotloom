import { t } from '@/i18n';
import { getGenerationInputModes, getModelIdsByType } from '@/domain/catalog/ModelCatalog';
import { defaultInputSlot } from '@/domain/graph/GenerationInputContract';
import { IMAGE_REVERSE_PROMPT } from '@/domain/graph/imageReversePrompt';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode, setSelectedNodeIds } from '@/store/nodeStore';
import { showToast } from '@/store/notificationStore';
import { store, touchProject } from '@/store/projectStore';
import { isModelAvailable } from '@/store/settingsStore';
import { runNode } from '@/store/taskStore';
import { localMediaPath, selectedNodeMedia } from '@/utils/nodeMedia';
import { canvasNodeDimensions, type CanvasSizedNode } from '@/domain/graph/CanvasNodeDimensions';

type AnyNode = Record<string, any>;

const REVERSE_NODE_GAP = 96;

function findImageNode(nodeId: string): AnyNode | null {
  return (store.project.nodes as AnyNode[])
    .find((node) => node.id === nodeId && node.type === 'imageGeneration' && !node.archived) ?? null;
}

function visionTextModel(): string {
  const candidates = getModelIdsByType('textGeneration')
    .filter((model) => getGenerationInputModes(model).some((mode) => mode.maxImages > 0));
  // 优先用已配置好凭据的模型；否则仍给第一个候选，让任务回执给出具体配置提示。
  return candidates.find((model) => isModelAvailable(model)) || candidates[0] || '';
}

/**
 * 反推提示词：在源图右侧派生一个带图片参考的文本节点并直接运行。
 * 文本模型必须声明 images 输入；没有声明时任务会明确失败，不会静默把图片丢掉。
 */
export function createImageReversePromptNode(nodeId: string): boolean {
  const source = findImageNode(nodeId);
  const sourcePath = source ? localMediaPath(selectedNodeMedia(source, store.project)) : '';
  if (!source || !sourcePath) {
    showToast(t('imageReverse.error.noImage'));
    return false;
  }
  const model = visionTextModel();
  if (!model) {
    showToast(t('imageReverse.error.noModel'));
    return false;
  }

  recordCanvasHistory(t('imageReverse.history'));
  const derived = addNode('textGeneration');
  const dimensions = canvasNodeDimensions(source as CanvasSizedNode);
  derived.title = t('imageReverse.derivedTitle');
  derived.model = model;
  derived.prompt = IMAGE_REVERSE_PROMPT;
  derived.reversePrompt = { sourceNodeId: source.id, mode: 'image' };
  derived.x = Math.round(Number(source.x || 0) + dimensions.width + REVERSE_NODE_GAP);
  derived.y = Math.round(Number(source.y || 0));

  const derivedId = String(derived.id);
  const edge = addCanvasEdge(store.project, String(source.id), derivedId, {
    touch: false,
    kind: 'typed-input',
    edge: {
      data: {
        inputRole: 'referenceImage',
        inputSlot: defaultInputSlot('reference', 'referenceImage'),
        required: true,
        creationSource: 'image-reverse-prompt',
      },
    },
  });
  if (!edge.ok) showToast(edge.error || t('imageReverse.error.noImage'));

  setSelectedNodeIds([derivedId]);
  touchProject();
  runNode(derived);
  return true;
}

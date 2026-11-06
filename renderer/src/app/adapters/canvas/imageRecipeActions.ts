import { t, type MessageKey } from '@/i18n';
import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import { canvasNodeDimensions, type CanvasSizedNode } from '@/domain/graph/CanvasNodeDimensions';
import {
  IMAGE_RECIPE_VERSION,
  composeImageRecipePrompt,
  createImageRecipe,
  readImageRecipe,
  type ImageRecipe,
  type ImageRecipeKind,
} from '@/domain/graph/imageRecipe';
import { defaultInputSlot } from '@/domain/graph/GenerationInputContract';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode, ensureGenerationConfig, setSelectedNodeIds } from '@/store/nodeStore';
import { showToast } from '@/store/notificationStore';
import { store, touchProject } from '@/store/projectStore';
import { runNode } from '@/store/taskStore';

type AnyNode = Record<string, any>;

/** 派生节点落在源图右侧，和裁剪、标注派生出来的图片保持同一列间距。 */
const RECIPE_NODE_GAP = 96;

const historyKey: Record<ImageRecipeKind, MessageKey> = {
  angle: 'imageRecipe.history.angle',
  lighting: 'imageRecipe.history.lighting',
};

const derivedTitleKey: Record<ImageRecipeKind, MessageKey> = {
  angle: 'imageRecipe.angle.derivedTitle',
  lighting: 'imageRecipe.lighting.derivedTitle',
};

const derivationType: Record<ImageRecipeKind, string> = {
  angle: 'image-angle',
  lighting: 'image-lighting',
};

function findImageNode(nodeId: string): AnyNode | null {
  return (store.project.nodes as AnyNode[])
    .find((node) => node.id === nodeId && node.type === 'imageGeneration' && !node.archived) ?? null;
}

/**
 * 参考图是这类编辑的唯一输入：模型连一张图片都不收，派生节点也跑不出结果，
 * 所以在建节点之前就把能力说清楚，而不是留下一个必然失败的任务。
 */
function referenceModeFor(model: string) {
  return getGenerationInputModes(model).find((mode) => mode.maxImages > 0) ?? null;
}

function storedRecipe(recipe: ImageRecipe): Record<string, unknown> {
  return { version: IMAGE_RECIPE_VERSION, kind: recipe.kind, params: recipe.params };
}

/**
 * 把「多角度 / 打光」应用到一张图片节点上。
 *
 * 同一个节点重复使用同一种编辑时就地更新参数和提示词并重新生成，
 * 换一种编辑（例如给多角度结果再打光）则派生一个新的图片节点，
 * 并用 typed-input 的 referenceImage 边把源图接进去。
 */
export function applyImageRecipe(nodeId: string, kind: ImageRecipeKind, params: unknown): boolean {
  const source = findImageNode(nodeId);
  if (!source) {
    showToast(t('imageRecipe.error.sourceMissing'));
    return false;
  }
  const recipe = createImageRecipe(kind, params);
  const mode = referenceModeFor(String(source.model || ''));
  if (!mode) {
    showToast(t('imageRecipe.error.referenceModel'));
    return false;
  }
  const prompt = composeImageRecipePrompt(recipe);
  const existing = readImageRecipe(source.imageRecipe);

  if (existing?.kind === kind) {
    recordCanvasHistory(t(historyKey[kind]));
    source.prompt = prompt;
    source.imageRecipe = storedRecipe(recipe);
    touchProject();
    // runNode 自己会校验凭据与上游输入并给出可操作提示。
    runNode(source);
    return true;
  }

  recordCanvasHistory(t(historyKey[kind]));
  const derived = addNode('imageGeneration');
  const dimensions = canvasNodeDimensions(source as CanvasSizedNode);
  const sourceName = String(source.title || '').trim() || t('imageRecipe.fallbackName');
  derived.title = t(derivedTitleKey[kind], { name: sourceName });
  derived.model = String(source.model || derived.model || '');
  ensureGenerationConfig(derived);
  derived.prompt = prompt;
  derived.imageRecipe = storedRecipe(recipe);
  derived.generatedFrom = { nodeId: source.id, type: derivationType[kind] };
  derived.artifactType = source.artifactType || 'other';
  if (source.outputSpec && typeof source.outputSpec === 'object') {
    derived.outputSpec = { ...source.outputSpec };
  }
  derived.x = Math.round(Number(source.x || 0) + dimensions.width + RECIPE_NODE_GAP);
  derived.y = Math.round(Number(source.y || 0));
  derived.inputMode = mode.value;

  const derivedId = String(derived.id);
  const edge = addCanvasEdge(store.project, String(source.id), derivedId, {
    touch: false,
    kind: 'typed-input',
    edge: {
      data: {
        inputRole: 'referenceImage',
        inputSlot: defaultInputSlot(mode.value, 'referenceImage'),
        required: true,
        creationSource: 'image-recipe',
      },
    },
  });
  if (!edge.ok) showToast(edge.error || t('imageRecipe.error.sourceMissing'));

  setSelectedNodeIds([derivedId]);
  touchProject();
  runNode(derived);
  return true;
}

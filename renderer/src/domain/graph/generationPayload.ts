import { t } from '../../i18n/index.ts';
import { inferMediaType, mediaExtension } from '../../utils/mediaType.ts';
import { selectedNodeMedia } from '../../utils/nodeMedia.ts';
import { coerceParamValue, getGenerationInputModes, getModelInputCapabilityForRoles, getModelSchema, isModelForType, resolveModeIdForInputMode, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import type { CatalogInputConstraints, ModelInputCapability, ModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import type { GenerationInputModeDescriptor, GenerationInputMode, GenerationInputSlot } from '@/domain/graph/GenerationInputContract';
import { applyCameraConfigToPrompt, normalizeCameraConfig } from '@/utils/cameraConfig';
import { applyImageStylePreset } from '@/utils/imageStylePresets.ts';
import { normalizeInputRole } from '@/utils/generationInputRole.ts';
import { defaultGenerationModel } from '@/config/defaultGenerationModels';
import { compileGenerationNodeConfig } from '@/domain/graph/GenerationNodeContract';
import { inputSlotOrder, isSlotValidForMode } from '@/domain/graph/GenerationInputContract';
import { textNodeContent } from '@/utils/textNodeContent.ts';

// 节点、任务与素材记录来自尚未类型化的 store/JS 调用方，这里按本文件真实读取的字段建模；
// 可选字段一律显式允许 undefined，避免为了通过检查而使用 any 或非空断言。
export interface UploadedFilePayload {
  name: string;
  path: string;
  url: string;
  type: string;
  size: number;
  materialId: string;
  resourceType: string;
}

interface UploadedFileLike {
  name?: string | undefined;
  path?: string | undefined;
  filePath?: string | undefined;
  url?: string | undefined;
  type?: string | undefined;
  size?: number | undefined;
  materialId?: string | undefined;
  resourceType?: string | undefined;
  duration?: number | undefined;
}

interface ImageEditLike {
  mode?: string | undefined;
  sourceFile?: string | undefined;
  maskFile?: string | undefined;
  regions?: unknown;
}

interface GenerationNodeConfig {
  inputStrategy?: string | undefined;
  cameraControl?: boolean | undefined;
  cameraConfig?: Record<string, unknown> | undefined;
  stylePresetId?: string | undefined;
  [key: string]: unknown;
}

export interface CanvasNode {
  id?: string;
  type?: string;
  title?: string;
  model?: string;
  prompt?: string;
  config?: GenerationNodeConfig | undefined;
  outputSpec?: unknown;
  uploadedFile?: UploadedFileLike | undefined;
  inputMode?: GenerationInputMode | string | undefined;
  imageEdit?: ImageEditLike | undefined;
  status?: string | undefined;
  archived?: boolean | undefined;
  selectedOutputNodeId?: string | undefined;
  directorData?: unknown;
  // 资源节点（type === 'resource'）字段
  content?: string | undefined;
  resourceType?: string | undefined;
  fileName?: string | undefined;
  filePath?: string | undefined;
  url?: string | undefined;
  previewUrl?: string | undefined;
  remoteUrl?: string | undefined;
  resourceUrl?: string | undefined;
  objectKey?: string | undefined;
  materialId?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  duration?: number | undefined;
  [key: string]: unknown;
}

interface CanvasEdge {
  id?: string;
  source?: string;
  target?: string;
  data?: Record<string, unknown> | undefined;
}

interface TaskResultLike {
  output?: unknown;
  raw?: unknown;
  archivedFiles?: MaterialRecord[];
  [key: string]: unknown;
}

interface TaskRecord {
  id?: string;
  nodeId?: string;
  createdAt?: string | number | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  result?: TaskResultLike | undefined;
  [key: string]: unknown;
}

interface MaterialRecord {
  id?: string;
  nodeId?: string;
  name?: string;
  path?: string;
  filePath?: string;
  url?: string;
  resourceUrl?: string;
  previewUrl?: string;
  remoteUrl?: string;
  objectKey?: string;
  materialId?: string;
  resourceType?: string;
  mimeType?: string;
  size?: number | undefined;
  duration?: number | undefined;
  source?: string;
  importedAt?: string | number | undefined;
  [key: string]: unknown;
}

export interface CanvasProject {
  edges?: CanvasEdge[];
  nodes?: CanvasNode[];
  tasks?: TaskRecord[];
  materials?: MaterialRecord[];
  [key: string]: unknown;
}

type InputResource = {
  nodeId?: string | undefined;
  title?: string | undefined;
  resourceType?: string | undefined;
  fileName?: string | undefined;
  filePath?: string | undefined;
  url?: string | undefined;
  previewUrl?: string | undefined;
  remoteUrl?: string | undefined;
  objectKey?: string | undefined;
  materialId?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  duration?: number | undefined;
  inputRole?: string | undefined;
  inputSlot?: string | undefined;
  required?: boolean | undefined;
};

// 候选资源与已解析输入在整条管道里只被读取，字段缺失都按空值处理。
type ModelInputResource = Partial<InputResource> & {
  selectedOutput?: SelectedOutputSummary | null;
  uploadedFile?: UploadedFilePayload | null;
};

interface SelectedOutputSummary extends Partial<InputResource> {
  content?: string;
}

export interface UpstreamInput {
  edgeId: string;
  inputRole: string;
  inputSlot: GenerationInputSlot;
  required: boolean;
  nodeId: string;
  nodeType: string;
  title: string;
  prompt: string;
  status: string;
  // 资源节点
  resourceType?: string | undefined;
  fileName?: string | undefined;
  filePath?: string | undefined;
  url?: string | undefined;
  previewUrl?: string | undefined;
  remoteUrl?: string | undefined;
  objectKey?: string | undefined;
  materialId?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  duration?: number | undefined;
  // 3D 导演台
  directorData?: unknown;
  // 生成节点
  model?: string | undefined;
  uploadedFile?: UploadedFilePayload | null;
  taskId?: string | undefined;
  result?: TaskResultLike | undefined;
  selectedOutputNodeId?: string | undefined;
  selectedOutput?: SelectedOutputSummary | null;
}

interface GenerationInputs {
  images: ModelInputResource[];
  videos: ModelInputResource[];
  audios: ModelInputResource[];
}

interface PromptReference {
  alias: string;
  nodeId: string;
}

function promptReferences(node: CanvasNode): PromptReference[] {
  return (Array.isArray(node.promptReferences) ? node.promptReferences : [])
    .filter((item): item is PromptReference => Boolean(item && typeof item.alias === 'string' && typeof item.nodeId === 'string'));
}

function mentionPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?=$|[\\s\\p{P}])`, 'gu');
}

function resolvePromptMentions(prompt: string, references: PromptReference[], inputs: GenerationInputs): string {
  const numbered = [
    ...inputs.images.map((item, index) => ({ nodeId: item.nodeId, token: `@图片${index + 1}` })),
    ...inputs.videos.map((item, index) => ({ nodeId: item.nodeId, token: `@视频${index + 1}` })),
    ...inputs.audios.map((item, index) => ({ nodeId: item.nodeId, token: `@音频${index + 1}` })),
  ];
  return [...references].sort((left, right) => right.alias.length - left.alias.length)
    .reduce((text, reference) => {
      const input = numbered.find((item) => item.nodeId === reference.nodeId);
      return input ? text.replace(mentionPattern(reference.alias), input.token) : text;
    }, prompt);
}

export interface GenerationPayload {
  nodeId?: string | undefined;
  nodeType?: string | undefined;
  model: string;
  prompt: string;
  uploadedFile: UploadedFilePayload | null;
  inputs: UpstreamInput[];
  modelContract: ModelRuntimeContract | null;
  modelInputs: GenerationInputs;
  upstreamContext: string;
  [key: string]: unknown;
}

export interface GenerationReadiness {
  ready: boolean;
  issues: string[];
  inputs?: UpstreamInput[];
}

const INPUT_SOURCE_TYPES = ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration', 'resource', 'threeDDirector'];
const GENERATION_SOURCE_TYPES = ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'];

function pickString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// 槽位来自未类型化的画布边数据，只有在这一处边界做断言归一化。
function toSlot(value: unknown): GenerationInputSlot {
  return String(value || '') as GenerationInputSlot;
}

function schemaParamsPayload(type: string | undefined, config: GenerationNodeConfig = {}, model = '', modeId = ''): Record<string, unknown> {
  return Object.fromEntries(
    (getModelSchema(type, model, modeId).params || [])
      .filter((param) => param?.key && param.key !== 'prompt' && param.key !== 'model')
      .map((param) => {
        const coerced = coerceParamValue(param, config[param.key] ?? param.default);
        const allowed = (param.options || []).map((option) => (
          option && typeof option === 'object' ? (option as { value?: unknown }).value : option
        ));
        return [param.key, allowed.length && !allowed.includes(coerced) ? param.default : coerced];
      }),
  );
}

function basePayload(node: CanvasNode, config: GenerationNodeConfig, project: CanvasProject | null | undefined): GenerationPayload {
  const inputs = collectUpstreamInputs(node, project);
  const model = pickString(node.model, defaultGenerationModel(node.type));
  const inputRoles = [
    ...inputs.map(effectiveInputRole),
    ...(node.imageEdit?.sourceFile ? ['image'] : []),
  ];
  const hasMediaInputs = inputRoles.some((role) => !['', 'auto', 'textContext'].includes(role));
  // Explicit mode is honored only when it supports the actual typed inputs.
  // Otherwise choose the compatible model mode deterministically.
  const modelContract = resolveModelRuntimeContract(
    node.type,
    model,
    inputRoles,
    hasMediaInputs ? resolveModeIdForInputMode(model, node.inputMode) : '',
  );
  const upstreamContext = inputs
    .filter((input) => input.inputRole === 'textContext'
      || (input.inputRole === 'auto' && input.nodeType === 'textGeneration'))
    .map((input) => `[${input.title}] ${input.prompt}`)
    .filter(Boolean)
    .join('\n');
  const modelInputs = collectModelInputs({
    inputs,
    uploadedFile: uploadedFilePayload(node.uploadedFile),
    capability: modelContract,
    inputStrategy: config.inputStrategy || 'auto',
  });
  const refs = promptReferences(node);
  const ownPrompt = resolvePromptMentions(pickString(node.prompt), refs, modelInputs);
  const mediaManifest = modelInputs.images.length + modelInputs.videos.length + modelInputs.audios.length > 1 || refs.length
    ? [
        ...modelInputs.images.map((image, index) => `@图片${index + 1}：${image.title || image.nodeId || '未命名图片'}${image.inputSlot && image.inputSlot !== 'reference' ? `（${image.inputSlot}）` : ''}`),
        ...modelInputs.videos.map((video, index) => `@视频${index + 1}：${video.title || video.nodeId || '未命名视频'}`),
        ...modelInputs.audios.map((audio, index) => `@音频${index + 1}：${audio.title || audio.nodeId || '未命名音频'}`),
      ].join('\n')
    : '';
  const promptWithReferences = mediaManifest
    ? `实际传入的参考素材顺序（编号按本次请求的媒体输入排列，身份以对应上游节点为准）：\n${mediaManifest}\n\n${ownPrompt}`
    : ownPrompt;
  return {
    nodeId: node.id,
    nodeType: node.type,
    model,
    prompt: node.type !== 'textGeneration' && upstreamContext
      ? `${promptWithReferences}\n\n必须继承的上游文本约束：\n${upstreamContext}`
      : promptWithReferences,
    uploadedFile: uploadedFilePayload(node.uploadedFile),
    inputs,
    modelContract,
    modelInputs,
    upstreamContext,
  };
}

function uploadedFilePayload(file: UploadedFileLike | null | undefined): UploadedFilePayload | null {
  if (!file) return null;
  return {
    name: pickString(file.name),
    path: pickString(file.path || file.filePath),
    url: pickString(file.url),
    type: pickString(file.type),
    size: file.size || 0,
    materialId: pickString(file.materialId),
    resourceType: pickString(file.resourceType),
  };
}

export function buildGenerationPayload(node: CanvasNode, project: CanvasProject | null | undefined): GenerationPayload {
  const sourceConfig: GenerationNodeConfig = { ...(node.config || {}) };
  const payload = basePayload(node, sourceConfig, project);
  const schema = getModelSchema(node.type, payload.model, payload.modelContract?.modeId || '');
  const config = compileGenerationNodeConfig(sourceConfig, schema.params, node.outputSpec) as GenerationNodeConfig;
  const schemaParams = schemaParamsPayload(node.type, config, payload.model, payload.modelContract?.modeId || '');

  if (node.type === 'imageGeneration') {
    const cameraControl = Boolean(config.cameraControl && config.cameraConfig);
    const cameraConfig = cameraControl ? normalizeCameraConfig(config.cameraConfig) : null;
    const imageEdit = payload.modelContract?.supportsMaskEditing      && node.imageEdit?.mode && node.imageEdit?.maskFile && node.imageEdit?.sourceFile
      ? {
          mode: node.imageEdit.mode,
          regions: Array.isArray(node.imageEdit.regions) ? node.imageEdit.regions : [],
          sourceFile: node.imageEdit.sourceFile,
          maskFile: node.imageEdit.maskFile,
        }
      : null;
    const styledPrompt = applyImageStylePreset(payload.prompt, config.stylePresetId);
    return {
      ...payload,
      prompt: cameraControl ? applyCameraConfigToPrompt(styledPrompt, cameraConfig) : styledPrompt,
      ...schemaParams,
      cameraControl,
      cameraConfig,
      imageEdit,
    };
  }

  if (node.type === 'videoGeneration') {
    return {
      ...payload,
      ...schemaParams,
      inputStrategy: config.inputStrategy || 'auto',
    };
  }

  if (node.type === 'audioGeneration') {
    return {
      ...payload,
      ...schemaParams,
    };
  }

  if (node.type === 'textGeneration') {
    return {
      ...payload,
      ...schemaParams,
    };
  }

  return payload;
}

function collectUpstreamInputs(node: CanvasNode, project: CanvasProject | null | undefined): UpstreamInput[] {
  if (!project || !Array.isArray(project.edges) || !Array.isArray(project.nodes)) return [];
  const edges = project.edges;
  const nodes = project.nodes;
  const linked: Array<{ edge: CanvasEdge; source: CanvasNode }> = [];
  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    if (edge.data?.skipTaskInput === true) continue;
    const source = nodes.find((item) => item.id === edge.source);
    if (!source || source.archived) continue;
    if (!INPUT_SOURCE_TYPES.includes(String(source.type))) continue;
    linked.push({ edge, source });
  }
  return linked
    .map(({ edge, source }): UpstreamInput => {
      const inputMeta = {
        edgeId: edge.id || '',
        inputRole: normalizeInputRole(edge.data?.inputRole || 'auto'),
        inputSlot: toSlot(edge.data?.inputSlot),
        required: edge.data?.required !== false,
      };
      const latestTask = latestTaskForNode(project, source.id);
      if (source.type === 'resource') {
        return {
          ...inputMeta,
          nodeId: source.id || '',
          nodeType: source.type,
          title: pickString(source.title || source.fileName, '资源'),
          prompt: pickString(source.content || source.filePath || source.url || source.previewUrl),
          status: source.status || 'completed',
          resourceType: source.resourceType || '',
          fileName: source.fileName || '',
          filePath: source.filePath || '',
          url: source.url || source.resourceUrl || '',
          previewUrl: source.previewUrl || '',
          remoteUrl: source.remoteUrl || '',
          objectKey: source.objectKey || '',
          materialId: source.materialId || '',
          mimeType: source.mimeType || '',
          size: source.size || 0,
          duration: source.duration || 0,
        };
      }
      if (source.type === 'threeDDirector') {
        return {
          ...inputMeta,
          nodeId: source.id || '',
          nodeType: source.type,
          title: pickString(source.title, '3D导演台'),
          prompt: '',
          status: 'completed',
          directorData: source.directorData || null,
        };
      }
      return {
        ...inputMeta,
        nodeId: source.id || '',
        nodeType: source.type || '',
        title: pickString(source.title, source.type),
        prompt: pickString(source.type === 'textGeneration' ? textNodeContent(source) : source.prompt),
        model: pickString(source.model),
        status: source.status || 'idle',
        uploadedFile: uploadedFilePayload(source.uploadedFile),
        taskId: latestTask?.id,
        result: latestTask?.result,
        selectedOutputNodeId: source.selectedOutputNodeId || '',
        selectedOutput: selectedOutputSummary(project, source),
      };
    })
    .sort((a, b) => inputSlotOrder(a.inputSlot) - inputSlotOrder(b.inputSlot));
}

function latestTaskForNode(project: CanvasProject | null | undefined, nodeId: string | undefined): TaskRecord | null {
  return [...(project?.tasks || [])]
    .filter((task) => task.nodeId === nodeId)
    .sort((a, b) => {
      const aTime = Date.parse(a.completedAt || a.startedAt || String(a.createdAt || 0)) || 0;
      const bTime = Date.parse(b.completedAt || b.startedAt || String(b.createdAt || 0)) || 0;
      return bTime - aTime;
    })[0] || null;
}

function selectedOutputSummary(project: CanvasProject | null | undefined, source: CanvasNode | null | undefined): SelectedOutputSummary | null {
  if (!project || !source) return null;
  const selected = selectedNodeMedia(source, project);
  if (!selected || selected === source) return null;
  return {
    ...selected,
    materialId: String(selected.materialId || ''),
    nodeId: String(source.id || ''),
    title: String(selected.title || selected.name || source.title || ''),
    fileName: String(selected.fileName || selected.name || ''),
    filePath: String(selected.filePath || selected.path || ''),
    resourceType: String(selected.resourceType || selected.mimeType || selected.type || ''),
  };

}

export function generationUpstreamReadiness(node: CanvasNode | null | undefined, project: CanvasProject | null | undefined): GenerationReadiness {
  if (!node || !project) return { ready: false, issues: [t("ui.generationPayload.text.a885af70")] };
  const inputs = collectUpstreamInputs(node, project);
  const issues: string[] = [];
  const selectedModel = String(node.model || '');
  if (!isModelForType(node.type, selectedModel)) {
    issues.push(t("ui.generationPayload.text.8c63f164", { value0: String(node.title), value1: String(selectedModel || t("ui.canvasActionShortcuts.text.55a04b58")), value2: String(node.type) }));
  }
  const requiredInputs = inputs.filter((input) => input.required !== false);
  const hasRequiredMedia = requiredInputs.some((input) => effectiveInputRole(input) !== 'textContext');
  const modeResolution = getModelInputCapabilityForRoles(
    node.type,
    selectedModel,
    requiredInputs.map(effectiveInputRole),
    hasRequiredMedia ? resolveModeIdForInputMode(selectedModel, node.inputMode) : '',
  );
  const capability = modeResolution.capability;
  const deliveredInputs = collectModelInputs({
    inputs,
    uploadedFile: uploadedFilePayload(node.uploadedFile),
    capability,
    inputStrategy: String(node.config?.inputStrategy || 'auto'),
  });
  const deliveredIds = new Set([
    ...deliveredInputs.images, ...deliveredInputs.videos, ...deliveredInputs.audios,
  ].map((item) => item.nodeId));
  for (const reference of promptReferences(node)) {
    if (!mentionPattern(reference.alias).test(String(node.prompt || ''))) continue;
    if (!inputs.some((input) => input.nodeId === reference.nodeId)) {
      issues.push(t("ui.generationPayload.text.98a622da", { value0: String(reference.alias) }));
    } else if (!deliveredIds.has(reference.nodeId)) {
      issues.push(t("ui.generationPayload.text.cfbaa83b", { value0: String(reference.alias) }));
    }
  }
  if (!modeResolution.supported) {
    issues.push(t("ui.generationPayload.text.2032d59d", { value0: String(node.title), value1: String(selectedModel) }));
  }
  const activeInputMode: GenerationInputModeDescriptor | undefined = getGenerationInputModes(selectedModel)
    .find((item) => item.value === node.inputMode);
  if (node.inputMode && !activeInputMode) {
    issues.push(t("ui.generationPayload.text.bdafd6e1", { value0: String(node.title), value1: String(selectedModel), value2: String(node.inputMode) }));
  }
  const occupiedSlots = new Set<GenerationInputSlot>();
  for (const input of requiredInputs.filter((item) => effectiveInputRole(item) !== 'textContext')) {
    const slot = input.inputSlot || '';
    if (activeInputMode && !slot) {
      issues.push(t("ui.generationPayload.text.922f911e", { value0: String(input.title) }));
      continue;
    }
    if (activeInputMode && !isSlotValidForMode(activeInputMode.value, slot, effectiveInputRole(input))) {
      issues.push(t("ui.generationPayload.text.da47096b", { value0: String(input.title), value1: String(slot), value2: String(activeInputMode.label) }));
    }
    if ((['firstFrame', 'lastFrame'] as string[]).includes(slot) && occupiedSlots.has(slot)) {
      issues.push(t("ui.generationPayload.text.95028999", { value0: String(node.title), value1: String(slot === 'firstFrame' ? t("ui.CanvasNodeToolbar.label.f19f6b6d") : t("ui.CanvasNodeToolbar.label.35b12241")) }));
    }
    occupiedSlots.add(slot);
  }
  const imageInputs = requiredInputs.filter((input) => (['image', 'referenceImage'] as string[]).includes(effectiveInputRole(input)));
  const videoInputs = requiredInputs.filter((input) => effectiveInputRole(input) === 'inputVideo');
  const audioInputs = requiredInputs.filter((input) => effectiveInputRole(input) === 'referenceAudio');
  if (imageInputs.length < (capability.minInputImages || 0)) {
    issues.push(t("ui.generationPayload.text.71ea6900", { value0: String(node.title), value1: String(capability.minInputImages) }));
  }
  if (capability.maxInputImages > 0 && imageInputs.length > capability.maxInputImages) {
    issues.push(t("ui.generationPayload.text.f80bffbb", { value0: String(node.title), value1: String(imageInputs.length), value2: String(capability.maxInputImages) }));
  }
  if (videoInputs.length < (capability.minInputVideos || 0)) {
    issues.push(t("ui.generationPayload.text.57d4c25d", { value0: String(node.title), value1: String(capability.minInputVideos) }));
  }
  if (capability.maxInputVideos >= 0 && videoInputs.length > capability.maxInputVideos) {
    issues.push(t("ui.generationPayload.text.baefe96d", { value0: String(node.title), value1: String(videoInputs.length), value2: String(capability.maxInputVideos) }));
  }
  if (audioInputs.length < (capability.minInputAudios || 0)) {
    issues.push(t("ui.generationPayload.text.6b5c9d57", { value0: String(node.title), value1: String(capability.minInputAudios) }));
  }
  if (capability.maxInputAudios >= 0 && audioInputs.length > capability.maxInputAudios) {
    issues.push(t("ui.generationPayload.text.ba0f8c92", { value0: String(node.title), value1: String(audioInputs.length), value2: String(capability.maxInputAudios) }));
  }
  const maxTotalAudioDuration = Number(capability.inputConstraints?.audios?.maxTotalDuration || 0);
  const totalAudioDuration = audioInputs.reduce((total, input) => (
    total + Number(resolvedInputResource(input).duration || 0)
  ), 0);
  if (maxTotalAudioDuration > 0 && totalAudioDuration > maxTotalAudioDuration) {
    issues.push(t("ui.generationPayload.text.90d53014", { value0: String(node.title), value1: String(maxTotalAudioDuration) }));
  }
  const audioRequirements = capability.inputConstraints?.audios?.requiresAnyOf || [];
  if (audioInputs.length && audioRequirements.length) {
    const satisfied = audioRequirements.some((kind) => (
      (kind === 'images' && imageInputs.length > 0)
      || (kind === 'videos' && videoInputs.length > 0)
      || (kind === 'audios' && audioInputs.length > 0)
    ));
    if (!satisfied) issues.push(t("ui.generationPayload.text.9de7b4bd", { value0: String(node.title), value1: String(mediaKindsLabel(audioRequirements)) }));
  }
  for (const input of inputs) {
    if (input.required === false) continue;
    const declaredRole = input.inputRole || 'auto';
    const role = effectiveInputRole(input);
    const uploadedResource = uploadedInputResource(input);
    const hasManualTextContent = input.nodeType === 'textGeneration'
      && Boolean(String(input.prompt || '').trim());
    // 节点状态是本次运行的瞬时状态：从素材库选定输出、上传文件或重载项目后都可能仍是
    // idle，但已经有可用的真实输出。能解析出 selectedOutput 就该按完成处理。
    const hasReadyOutput = input.status === 'completed'
      || Boolean(uploadedResource) || hasManualTextContent || Boolean(input.selectedOutput);
    if (GENERATION_SOURCE_TYPES.includes(input.nodeType) && !hasReadyOutput) {
      issues.push(t("ui.generationPayload.text.7b389cca", { value0: String(input.title), value1: String(role) }));
      continue;
    }
    if (role === 'textContext' && !String(input.prompt || '').trim()) {
      issues.push(t("ui.generationPayload.text.7f964d54", { value0: String(input.title) }));
    }
    if (role === 'referenceImage') {
      const selectedImage = resolvedInputResource(input);
      if (!isImageResource(selectedImage)) issues.push(t("ui.generationPayload.text.e4637eec", { value0: String(input.title) }));
      if (capability.imageValueFormat === 'http-url'
        && !String(selectedImage.remoteUrl || selectedImage.url || '').startsWith('http')) {
        issues.push(t("ui.generationPayload.text.e6c8d8bf", { value0: String(input.title) }));
      }
      if (!capability.supportsReferenceImages) issues.push(t("ui.generationPayload.text.db7506e4", { value0: String(node.title) }));
    }
    if (role === 'inputVideo') {
      if (!isVideoResource(resolvedInputResource(input))) issues.push(t("ui.generationPayload.text.309580e5", { value0: String(input.title) }));
      if (!capability.supportsInputVideo) issues.push(t("ui.generationPayload.text.067c015c", { value0: String(node.title) }));
    }
    if (role === 'referenceAudio') {
      const selectedAudio = resolvedInputResource(input);
      if (!isAudioResource(selectedAudio)) issues.push(t("ui.generationPayload.text.5492b512", { value0: String(input.title) }));
      if (!capability.supportsInputAudio) issues.push(t("ui.generationPayload.text.4ff3a133", { value0: String(node.title) }));
      const audioConstraint: Partial<NonNullable<CatalogInputConstraints['audios']>> = capability.inputConstraints?.audios || {};
      const format = mediaExtension(selectedAudio);
      if (format && audioConstraint.formats?.length && !audioConstraint.formats.includes(format)) {
        issues.push(t("ui.generationPayload.text.7b3a2a32", { value0: String(input.title), value1: String(format) }));
      }
      const size = Number(selectedAudio.size || 0);
      if (size > 0 && (audioConstraint.maxBytes || 0) > 0 && size > (audioConstraint.maxBytes || 0)) {
        issues.push(t("ui.generationPayload.text.6ae4c779", { value0: String(input.title) }));
      }
      const duration = Number(selectedAudio.duration || 0);
      if (duration > 0 && (audioConstraint.minDuration || 0) > 0 && duration < (audioConstraint.minDuration || 0)) {
        issues.push(t("ui.generationPayload.text.47e47e6f", { value0: String(input.title), value1: String(audioConstraint.minDuration) }));
      }
      if (duration > 0 && (audioConstraint.maxDuration || 0) > 0 && duration > (audioConstraint.maxDuration || 0)) {
        issues.push(t("ui.generationPayload.text.487aafba", { value0: String(input.title), value1: String(audioConstraint.maxDuration) }));
      }
    }
    if (declaredRole === 'auto' && (['imageGeneration', 'videoGeneration'] as string[]).includes(input.nodeType)
      && !input.selectedOutput && !uploadedResource) {
      issues.push(t("ui.generationPayload.text.e65951d3", { value0: String(input.title) }));
    }
  }
  return { ready: issues.length === 0, issues, inputs };
}

function isImageResource(resource: ModelInputResource = {}): boolean {
  return inferMediaType(resource) === 'image';
}

function isVideoResource(resource: ModelInputResource = {}): boolean {
  return inferMediaType(resource) === 'video';
}

function isAudioResource(resource: ModelInputResource = {}): boolean {
  return inferMediaType(resource) === 'audio';
}

function mediaKindsLabel(kinds: Array<'images' | 'videos' | 'audios'> = []): string {
  const labels: Record<string, string> = { images: t("ui.generationPayload.text.1aba0b1b"), videos: t("ui.generationPayload.text.ba5c9367"), audios: t("ui.generationPayload.text.b3448a7a") };
  return kinds.map((kind) => labels[kind] || kind).join(t("ui.generationPayload.text.30f4d7cf"));
}

function inputResourcePayload(resource: ModelInputResource = {}, source: ModelInputResource = {}): InputResource {
  return {
    nodeId: source.nodeId || resource.nodeId || '',
    title: source.title || resource.title || '',
    resourceType: resource.resourceType || '',
    fileName: resource.fileName || '',
    filePath: resource.filePath || '',
    url: resource.url || resource.previewUrl || '',
    previewUrl: resource.previewUrl || '',
    remoteUrl: resource.remoteUrl || '',
    objectKey: resource.objectKey || '',
    materialId: resource.materialId || '',
    mimeType: resource.mimeType || '',
    size: resource.size || 0,
    duration: resource.duration || 0,
    inputRole: normalizeInputRole(source.inputRole || resource.inputRole || 'auto'),
    inputSlot: source.inputSlot || resource.inputSlot || '',
    required: source.required !== false && resource.required !== false,
  };
}


// uploadedFilePayload 不携带时长，与原实现一致：候选资源时长统一按 0 处理。
function uploadedInputResource(input: UpstreamInput | ModelInputResource): ModelInputResource | null {
  const uploaded = input.uploadedFile;
  if (!uploaded || (!uploaded.path && !uploaded.url)) return null;
  return inputResourcePayload({
    title: uploaded.name || input.title || '',
    resourceType: uploaded.resourceType,
    fileName: uploaded.name,
    filePath: uploaded.path,
    url: uploaded.url,
    materialId: uploaded.materialId,
    mimeType: uploaded.type,
    size: uploaded.size || 0,
    duration: 0,
  }, input);
}

function resolvedInputResource(input: UpstreamInput | ModelInputResource = {}): ModelInputResource {
  return input.selectedOutput || uploadedInputResource(input) || input;
}

function effectiveInputRole(input: UpstreamInput | ModelInputResource = {}): string {
  const role = input.inputRole || 'auto';
  if (role !== 'auto') return role;
  const resource = resolvedInputResource(input);
  if (isImageResource(resource)) return 'image';
  if (isVideoResource(resource)) return 'inputVideo';
  if (isAudioResource(resource)) return 'referenceAudio';
  return role;
}

function collectCandidateResources(inputs: UpstreamInput[] = [], uploadedFile: UploadedFilePayload | null = null): ModelInputResource[] {
  const candidates: ModelInputResource[] = [];
  if (uploadedFile?.path || uploadedFile?.url) {
    candidates.push(inputResourcePayload({
      title: uploadedFile.name,
      resourceType: uploadedFile.resourceType,
      fileName: uploadedFile.name,
      filePath: uploadedFile.path,
      url: uploadedFile.url,
      materialId: uploadedFile.materialId,
      mimeType: uploadedFile.type,
      size: uploadedFile.size || 0,
      duration: 0,
    }));
  }
  for (const input of inputs || []) {
    if (input.uploadedFile?.path || input.uploadedFile?.url) {
      candidates.push(inputResourcePayload({
        title: input.uploadedFile.name || input.title,
        resourceType: input.uploadedFile.resourceType,
        fileName: input.uploadedFile.name,
        filePath: input.uploadedFile.path,
        materialId: input.uploadedFile.materialId,
        mimeType: input.uploadedFile.type,
        size: input.uploadedFile.size || 0,
        duration: 0,
      }, input));
    }
    if (input.selectedOutput) {
      candidates.push(inputResourcePayload(input.selectedOutput, input));
      continue;
    }
    if (input.filePath || input.remoteUrl || input.url || input.previewUrl || input.objectKey) {
      candidates.push(inputResourcePayload(input, input));
    }
  }
  return candidates;
}

function collectModelInputs({ inputs, uploadedFile, capability, inputStrategy = 'auto' }: {
  inputs: UpstreamInput[];
  uploadedFile: UploadedFilePayload | null;
  capability: ModelInputCapability | ModelRuntimeContract | null;
  inputStrategy: string;
}): GenerationInputs {
  const candidates = collectCandidateResources(inputs, uploadedFile);
  const maxImages = capability?.maxInputImages || 0;
  const resourceKey = (item: ModelInputResource = {}) => item?.filePath || item?.url || item?.previewUrl || item?.objectKey || item?.materialId || item?.nodeId || '';
  const imageCandidates = candidates
    .filter(isImageResource)
    .filter((item, index, items) => items.findIndex((candidate) => resourceKey(candidate) === resourceKey(item)) === index);
  const usedImageKeys = new Set<string>();
  const withinImageBudget = () => usedImageKeys.size < maxImages;
  const claimImage = (item: ModelInputResource): ModelInputResource | null => {
    const key = resourceKey(item);
    if (!item || !key || usedImageKeys.has(key) || !withinImageBudget()) return null;
    usedImageKeys.add(key);
    return item;
  };
  const explicitReferenceCandidates = imageCandidates.filter((item) => item.inputRole === 'referenceImage');
  const autoCandidates = imageCandidates.filter((item) => item.inputRole === 'auto');
  const images: ModelInputResource[] = [];
  if (capability?.supportsReferenceImages) {
    explicitReferenceCandidates.forEach((item) => {
      const claimed = claimImage(item);
      if (claimed) images.push(claimed);
    });
  }
  if (capability?.supportsReferenceImages && inputStrategy === 'referenceImages') {
    autoCandidates.forEach((item) => {
      const claimed = claimImage(item);
      if (claimed) images.push(claimed);
    });
  }
  if (capability?.supportsInputImages) {
    autoCandidates.forEach((item) => {
      const claimed = claimImage(item);
      if (claimed) images.push(claimed);
    });
  }
  const videos = candidates
    .filter(isVideoResource)
    .map((item) => item.inputRole === 'auto' ? { ...item, inputRole: 'inputVideo' } : item)
    .sort((a, b) => Number(b.inputRole === 'inputVideo') - Number(a.inputRole === 'inputVideo'))
    .slice(0, capability?.maxInputVideos || 0);
  const audios = candidates
    .filter(isAudioResource)
    .map((item) => item.inputRole === 'auto' ? { ...item, inputRole: 'referenceAudio' } : item)
    .sort((a, b) => Number(b.inputRole === 'referenceAudio') - Number(a.inputRole === 'referenceAudio'))
    .slice(0, capability?.maxInputAudios || 0);
  return {
    images,
    videos: capability?.supportsInputVideo ? videos : [],
    audios: capability?.supportsInputAudio ? audios : [],
  };
}

export function summarizeGenerationPayload(payload: GenerationPayload | null | undefined): Record<string, unknown> {
  const summarized: Record<string, unknown> = Object.fromEntries(
    Object.entries(payload || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  delete summarized.upstreamContext;
  const compactResource = (resource: ModelInputResource = {}) => ({
    nodeId: resource.nodeId || '',
    title: resource.title || '',
    resourceType: resource.resourceType || '',
    fileName: resource.fileName || '',
    filePath: resource.filePath || '',
    url: resource.url || '',
    previewUrl: resource.previewUrl || '',
    remoteUrl: resource.remoteUrl || '',
    objectKey: resource.objectKey || '',
    materialId: resource.materialId || '',
    mimeType: resource.mimeType || '',
    size: resource.size || 0,
    inputRole: resource.inputRole || 'auto',
    inputSlot: resource.inputSlot || '',
    duration: resource.duration || 0,
    required: resource.required !== false,
  });
  summarized.inputs = (payload?.inputs || []).map((input) => ({
    edgeId: input.edgeId || '',
    inputRole: input.inputRole || 'auto',
    inputSlot: input.inputSlot || '',
    required: input.required !== false,
    nodeId: input.nodeId || '',
    nodeType: input.nodeType || '',
    title: input.title || '',
    status: input.status || '',
    taskId: input.taskId || '',
    uploadedFile: input.uploadedFile ? compactResource(input.uploadedFile) : null,
    selectedOutput: input.selectedOutput ? compactResource(input.selectedOutput) : null,
  }));
  if (payload?.modelInputs) {
    summarized.modelInputs = {
      images: (payload.modelInputs.images || []).map(compactResource),
      videos: (payload.modelInputs.videos || []).map(compactResource),
      audios: (payload.modelInputs.audios || []).map(compactResource),
    };
  }
  return summarized;
}

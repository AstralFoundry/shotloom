import { catalogLabel, t } from '../../i18n/index';
import { isRecord } from '../../utils/typeGuards';
/**
 * ModelCatalog — 模型目录 v2 解析与查询。
 *
 * 框架无关的纯 TypeScript 模块。模型能力只来自 model-catalog-v2/ 的厂商文件。
 * 不依赖 Vue、Vue Flow 或任何 Store。
 */

import { modelCatalogV2 } from '../../config/model-catalog-v2/index';
import { systemVoiceOptionLabels } from '../../config/systemVoices';
import { defaultGenerationModel } from '@/utils/defaultGenerationModels';
import {
  GENERATION_INPUT_MODE_LABELS,
  slotsForInputMode,
  type GenerationInputMode,
  type GenerationInputModeDescriptor,
} from '../graph/GenerationInputContract';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CatalogEndpoint {
  method: string;
  path: string;
  scope: string;
}

export interface CatalogResultEndpoint extends CatalogEndpoint {
  mimeType?: string;
  fileExtension?: string;
}

export interface CatalogResultBody {
  encoding: 'binary';
  mimeType: string;
  fileExtension: string;
}

export interface CatalogParam {
  key: string;
  label: string;
  labelKey?: string;
  type: string;
  required?: boolean | undefined;
  default?: unknown;
  numeric?: boolean | undefined;
  options?: unknown[] | undefined;
  conflictsWith?: string[] | undefined;
  visibleWhen?: Record<string, unknown> | undefined;
  valueDefaults?: Record<string, Record<string, unknown>>;
  presentation?: string | {
    control: 'segmented' | 'select' | 'ratio' | 'resolution' | 'slider' | 'number' | 'toggle' | 'text' | 'voice' | 'hidden';
    group?: string;
    summary?: boolean;
    unit?: string;
    limitNoteKey?: string;
    min?: number;
    max?: number;
    step?: number;
    /** 倍率型滑杆（音量 0.1–10、语速 0.5–2）用对数轨道，否则默认值会贴着轨道左端。 */
    scale?: 'linear' | 'log';
  } | undefined;
  optionLabelKeys?: Record<string, string>;
  optionLabels?: Record<string, string> | undefined;
}

export interface CatalogInputConstraints {
  images?: { min: number; max: number; roles?: string[]; formats?: string[]; maskRequired?: boolean; valueFormat?: string };
  videos?: { min: number; max: number; roles?: string[]; formats?: string[]; maxBytes?: number };
  audios?: {
    min: number;
    max: number;
    roles?: string[];
    formats?: string[];
    minDuration?: number;
    maxDuration?: number;
    maxTotalDuration?: number;
    maxBytes?: number;
    requiresAnyOf?: Array<'images' | 'videos' | 'audios'>;
  };
  text?: { maxTokens: number };
}

export interface CatalogOutputConstraints {
  maxCount?: number;
  durations?: number[];
  defaultDuration?: number;
  fps?: number;
  formats?: string[];
  supportsStreaming?: boolean;
  supportsStructuredOutput?: boolean;
  maxTokens?: number;
}

export interface CatalogAgentProtocol {
  transport: 'provider-default' | 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages';
  supportsTools: boolean;
  endpoint?: CatalogEndpoint;
  requestOptions?: Record<string, unknown>;
}

export interface CatalogMode {
  id: string;
  label: string;
  labelKey?: string;
  endpoint: CatalogEndpoint;
  taskEndpoint?: CatalogEndpoint;
  isAsync?: boolean;
  inputFormat?: string;
  inputConstraints: CatalogInputConstraints;
  outputConstraints: CatalogOutputConstraints;
  /** Agent SDK transport is independent from canvas request compilation. */
  agent?: CatalogAgentProtocol;
  requestFields?: Record<string, string>;
  imageValueFormat?: string;
  referenceImageFormat?: string;
  pollStatusMap?: Record<string, string>;
  auth?: { type: 'bearer' | 'header' | 'body' | 'none'; name?: string; prefix?: string };
  headers?: Record<string, string>;
  requestTemplate?: unknown;
  contentTemplate?: unknown;
  taskIdPath?: string;
  taskRequestTemplate?: unknown;
  statusPath?: string;
  progressPath?: string;
  errorPath?: string;
  /**
   * 有些厂商（MiniMax 全系）把失败写在 HTTP 200 的响应体里：`base_resp.status_code` 非 0 就是失败。
   * 不声明这个路径就按“响应体里没有结果就是没结果”处理。
   */
  errorCodePath?: string;
  /**
   * body 内失败时说明文字的路径，与 errorCodePath 配对使用。
   * 异步任务另有 errorPath（如 MiniMax 的 `task.error.message`）时必须单独声明这一条，
   * 否则提交阶段的真实原因会被轮询用的路径读成空。未声明时回退到 errorPath。
   */
  errorMessagePath?: string;
  resultTextPath?: string;
  resultUrlPath?: string;
  resultBase64Path?: string;
  resultHexPath?: string;
  resultFormatPath?: string;
  resultMimeType?: string;
  resultFileExtension?: string;
  resultBody?: CatalogResultBody;
  resultEndpoint?: CatalogResultEndpoint;
  resultDownloadAuth?: boolean;
  capabilities?: string[];
  params: CatalogParam[];
  /** 画布输入的业务语义；与供应商 mode id 分离。 */
  inputMode?: GenerationInputMode;
  /** 特殊供应商可覆盖默认槽位；通常由 inputMode 推导。 */
  inputSlots?: Array<'reference' | 'firstFrame' | 'lastFrame' | 'inputVideo' | 'referenceAudio'>;
  /** 复用同一供应商协议但具有不同画布输入语义的变体。 */
  inputVariants?: Array<{
    inputMode: GenerationInputMode;
    label?: string;
    labelKey?: string;
    inputSlots: Array<'reference' | 'firstFrame' | 'lastFrame' | 'inputVideo' | 'referenceAudio'>;
    inputConstraints: CatalogInputConstraints;
    requestFields?: Record<string, string>;
  }>;
}

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  /** 目录内稳定 ID 与供应商实际请求 model 不同时显式声明。 */
  upstreamModel?: string;
  type: string;
  sortOrder: number;
  enabled: boolean;
  disabledReason?: string;
  defaultMode: string;
  modes: CatalogMode[];
}

const CATALOG_MODEL_TYPES = new Set([
  'textGeneration',
  'imageGeneration',
  'videoGeneration',
  'audioGeneration',
]);
const CATALOG_INPUT_MODES = new Set(Object.keys(GENERATION_INPUT_MODE_LABELS));
const CATALOG_INPUT_SLOTS = new Set([
  'reference',
  'firstFrame',
  'lastFrame',
  'inputVideo',
  'referenceAudio',
]);
const GENERATION_ENDPOINT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ENDPOINT_SCOPES = new Set(['origin', 'root', 'v1']);
const TASK_ENDPOINT_METHODS = new Set(['GET', 'POST']);
const AGENT_TRANSPORTS = new Set(['provider-default', 'openai-chat-completions', 'openai-responses', 'anthropic-messages']);

function isVoiceParam(param: { presentation?: CatalogParam['presentation'] }): boolean {
  const presentation = param.presentation;
  return typeof presentation === 'object' && presentation?.control === 'voice';
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value) && typeof value === 'object' &&
    Object.values(value as Record<string, unknown>).every(isJsonValue);
}

/**
 * 校验声明式协议能否被当前运行时完整执行。这里仅检查持久化和执行所需的
 * 客观契约，不判断模型质量、制作范围或应当采用哪一种输入语义。
 */
export function catalogModelValidationErrors(
  model: unknown,
  { requireProvider = false }: { requireProvider?: boolean } = {},
): string[] {
  if (!isRecord(model)) return [t('catalog.validation.objectRequired')];
  const value = model as Partial<CatalogModel>;
  const modelId = String(value.id || '').trim() || t('catalog.validation.unknownModel');
  const errors: string[] = [];
  if (typeof value.id !== 'string' || !value.id.trim()) errors.push(t('catalog.validation.idRequired'));
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push(t('catalog.validation.nameRequired', { value0: modelId }));
  if (requireProvider && (typeof value.provider !== 'string' || !value.provider.trim())) errors.push(t('catalog.validation.providerRequired', { value0: modelId }));
  if (value.upstreamModel !== undefined && (typeof value.upstreamModel !== 'string' || !value.upstreamModel.trim())) {
    errors.push(t('catalog.validation.upstreamModel', { value0: modelId }));
  }
  if (!CATALOG_MODEL_TYPES.has(String(value.type || ''))) errors.push(t('catalog.validation.type', { value0: modelId }));
  if (!Array.isArray(value.modes) || !value.modes.length) {
    errors.push(t('catalog.validation.modesRequired', { value0: modelId }));
    return errors;
  }

  const modeIds = new Set<string>();
  for (const mode of value.modes) {
    const modeId = typeof mode?.id === 'string' ? mode.id.trim() : '';
    const location = `${modelId}/${modeId || t('catalog.validation.unknownMode')}`;
    if (!modeId) errors.push(t('catalog.validation.modeIdRequired', { value0: location }));
    else if (modeIds.has(modeId)) errors.push(t('catalog.validation.duplicateMode', { value0: modelId, value1: modeId }));
    else modeIds.add(modeId);

    const method = typeof mode?.endpoint?.method === 'string' ? mode.endpoint.method.toUpperCase() : '';
    const path = typeof mode?.endpoint?.path === 'string' ? mode.endpoint.path : '';
    const scope = mode?.endpoint?.scope;
    if (!GENERATION_ENDPOINT_METHODS.has(method)) {
      errors.push(t('catalog.validation.generationMethod', { value0: location }));
    }
    if (!path.startsWith('/') || path.startsWith('//')) errors.push(t('catalog.validation.endpointPath', { value0: location }));
    if (!ENDPOINT_SCOPES.has(String(scope || ''))) errors.push(t('catalog.validation.endpointScope', { value0: location }));
    if (!isRecord(mode?.requestTemplate)) {
      errors.push(t('catalog.validation.requestTemplate', { value0: location }));
    }
    if (mode?.agent !== undefined) {
      if (!isRecord(mode.agent)) {
        errors.push(t('catalog.validation.agentObject', { value0: location }));
      } else {
        if (!AGENT_TRANSPORTS.has(String(mode.agent.transport || ''))) {
          errors.push(t('catalog.validation.agentTransport', { value0: location }));
        }
        if (mode.agent.supportsTools !== true) {
          errors.push(t('catalog.validation.agentTools', { value0: location }));
        }
        const agentPath = String(mode.agent.endpoint?.path || path);
        const agentMethod = String(mode.agent.endpoint?.method || method).toUpperCase();
        const agentScope = String(mode.agent.endpoint?.scope || scope || '');
        if (agentMethod !== 'POST' || !agentPath.startsWith('/') || agentPath.startsWith('//') || !ENDPOINT_SCOPES.has(agentScope)) {
          errors.push(t('catalog.validation.agentEndpoint', { value0: location }));
        }
        if (mode.agent.transport === 'openai-chat-completions' && !agentPath.endsWith('/chat/completions')) {
          errors.push(t('catalog.validation.chatEndpoint', { value0: location }));
        }
        if (mode.agent.transport === 'openai-responses' && !agentPath.endsWith('/responses')) {
          errors.push(t('catalog.validation.responsesEndpoint', { value0: location }));
        }
        if (mode.agent.transport === 'anthropic-messages' && !agentPath.endsWith('/messages')) {
          errors.push(t('catalog.validation.messagesEndpoint', { value0: location }));
        }
        const requestOptions = mode.agent.requestOptions;
        if (requestOptions !== undefined && (!isRecord(requestOptions) ||
          !isJsonValue(requestOptions))) {
          errors.push(t('catalog.validation.agentOptions', { value0: location }));
        }
      }
    }
    if (mode?.inputMode && !CATALOG_INPUT_MODES.has(mode.inputMode)) errors.push(t('catalog.validation.inputMode', { value0: location }));
    if (Array.isArray(mode?.params)) {
      for (const param of mode.params) {
        const paramLocation = `${location}/${String(param?.key || t('catalog.validation.unknownParameter'))}`;
        if (!param?.key || typeof param.key !== 'string') errors.push(t('catalog.validation.parameterKey', { value0: paramLocation }));
        if ((param?.numeric === true || param?.type === 'number') && !(param.options || []).length && param.presentation) {
          const presentation = typeof param.presentation === 'object' ? param.presentation : null;
          const min = Number(presentation?.min);
          const max = Number(presentation?.max);
          if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
            errors.push(t('catalog.validation.numericBounds', { value0: paramLocation }));
          }
          if (param.default !== undefined) {
            const defaultValue = Number(param.default);
            if (!Number.isFinite(defaultValue) || (Number.isFinite(min) && defaultValue < min) || (Number.isFinite(max) && defaultValue > max)) {
              errors.push(t('catalog.validation.numericDefault', { value0: paramLocation }));
            }
          }
        }
      }
    }
    if (mode?.inputSlots !== undefined && !Array.isArray(mode.inputSlots)) {
      errors.push(t('catalog.validation.inputSlots', { value0: location }));
    } else {
      for (const slot of mode?.inputSlots || []) {
        if (!CATALOG_INPUT_SLOTS.has(slot)) errors.push(t('catalog.validation.invalidSlot', { value0: location, value1: slot }));
      }
    }

    const variantModes = new Set<string>();
    if (mode?.inputVariants !== undefined && !Array.isArray(mode.inputVariants)) {
      errors.push(t('catalog.validation.inputVariants', { value0: location }));
    }
    for (const variant of Array.isArray(mode?.inputVariants) ? mode.inputVariants : []) {
      const inputMode = String(variant?.inputMode || '');
      if (!CATALOG_INPUT_MODES.has(inputMode)) errors.push(t('catalog.validation.invalidVariant', { value0: location, value1: inputMode || t('catalog.validation.unnamed') }));
      else if (variantModes.has(inputMode)) errors.push(t('catalog.validation.duplicateVariant', { value0: location, value1: inputMode }));
      else variantModes.add(inputMode);
      if (!Array.isArray(variant?.inputSlots) || !variant.inputSlots.length) {
        errors.push(t('catalog.validation.variantSlots', { value0: location, value1: inputMode || 'inputVariant' }));
      } else {
        for (const slot of variant.inputSlots) {
          if (!CATALOG_INPUT_SLOTS.has(slot)) errors.push(t('catalog.validation.variantInvalidSlot', { value0: location, value1: inputMode, value2: slot }));
        }
      }
      if (!isRecord(variant?.inputConstraints)) {
        errors.push(t('catalog.validation.variantConstraints', { value0: location, value1: inputMode || 'inputVariant' }));
      }
    }

    if (mode?.isAsync === true) {
      const taskPath = String(mode.taskEndpoint?.path || '');
      const taskMethod = String(mode.taskEndpoint?.method || '').toUpperCase();
      const taskScope = String(mode.taskEndpoint?.scope || '');
      if (!taskPath.startsWith('/') || taskPath.startsWith('//')) {
        errors.push(t('catalog.validation.taskPath', { value0: location }));
      }
      if (!TASK_ENDPOINT_METHODS.has(taskMethod)) errors.push(t('catalog.validation.taskMethod', { value0: location }));
      if (!ENDPOINT_SCOPES.has(taskScope)) errors.push(t('catalog.validation.taskScope', { value0: location }));
      const taskTemplateContainsId = JSON.stringify(mode.taskRequestTemplate || {}).includes('{{taskId}}');
      if (!taskPath.includes('{taskId}') && !taskTemplateContainsId) {
        errors.push(t('catalog.validation.taskId', { value0: location }));
      }
      if (!String(mode.taskIdPath || '').trim()) errors.push(t('catalog.validation.taskIdPath', { value0: location }));
      if (!String(mode.statusPath || '').trim()) errors.push(t('catalog.validation.statusPath', { value0: location }));
    }
    if (!mode?.resultTextPath && !mode?.resultUrlPath && !mode?.resultBase64Path && !mode?.resultHexPath && !mode?.resultBody && !mode?.resultEndpoint) {
      errors.push(t('catalog.validation.resultSource', { value0: location }));
    }
  }
  if (typeof value.defaultMode !== 'string' || !value.defaultMode.trim() || !modeIds.has(value.defaultMode)) {
    errors.push(t('catalog.validation.defaultMode', { value0: modelId }));
  }
  return errors;
}

export interface ModelRuntimeContract {
  catalogVersion: number;
  nodeType: string;
  modelId: string;
  upstreamModel: string;
  modeId: string;
  inputMode: GenerationInputMode | null;
  inputSlots: string[];
  provider: string;
  endpoint: CatalogEndpoint;
  taskEndpoint: CatalogEndpoint | null;
  isAsync: boolean;
  inputFormat: string;
  requestFields: Record<string, string>;
  inputConstraints: CatalogInputConstraints;
  outputConstraints: CatalogOutputConstraints;
  agent?: CatalogAgentProtocol | undefined;
  // Capability flags
  supportsInputImages: boolean;
  minInputImages: number;
  maxInputImages: number;
  inputImageRoles: string[];
  imageRole: string;
  supportsReferenceImages: boolean;
  referenceImageFormat: string;
  imageValueFormat: string;
  supportsMaskEditing: boolean;
  supportsImageStreaming: boolean;
  maskFormat: string;
  supportsInputVideo: boolean;
  minInputVideos: number;
  maxInputVideos: number;
  inputVideoRoles: string[];
  supportsInputAudio: boolean;
  minInputAudios: number;
  maxInputAudios: number;
  inputAudioRoles: string[];
  allowedDurations: number[];
  defaultDuration: number | null;
  supportedTextSubtasks: string[];
  pollStatusMap?: Record<string, string> | undefined;
  auth?: CatalogMode['auth'] | undefined;
  headers?: Record<string, string> | undefined;
  requestTemplate?: unknown;
  contentTemplate?: unknown;
  taskIdPath?: string | undefined;
  taskRequestTemplate?: unknown;
  statusPath?: string | undefined;
  progressPath?: string | undefined;
  errorPath?: string | undefined;
  /** 厂商用响应体内的非 0 状态码报错时声明该码的路径。 */
  errorCodePath?: string | undefined;
  /** body 内失败说明文字的路径；缺省回退到 errorPath。 */
  errorMessagePath?: string | undefined;
  resultTextPath?: string | undefined;
  resultUrlPath?: string | undefined;
  resultBase64Path?: string | undefined;
  resultHexPath?: string | undefined;
  resultFormatPath?: string | undefined;
  resultMimeType?: string | undefined;
  resultFileExtension?: string | undefined;
  resultBody?: CatalogResultBody | undefined;
  resultEndpoint?: CatalogResultEndpoint | undefined;
  resultDownloadAuth?: boolean | undefined;
}

export interface ModelSchema {
  models: string[];
  params: Array<{
    key: string;
    label: string;
  labelKey?: string;
    type: string;
    numeric: boolean;
    default: unknown;
    options: unknown[];
    visibleWhen?: Record<string, unknown>;
    valueDefaults?: Record<string, Record<string, unknown>>;
    presentation?: CatalogParam['presentation'];
    optionLabelKeys?: Record<string, string>;
  optionLabels?: Record<string, string>;
  }>;
}

export interface TypeMeta {
  value: string;
  label: string;
  labelKey?: string;
  defaultModel: string;
  icon: string;
}

// ── Singleton Catalog ────────────────────────────────────────────────────────

const defaultTextTypeMeta: TypeMeta = { value: 'textGeneration', label: t("ui.taskAdapter.textGeneration.9612898b"), defaultModel: defaultGenerationModel('textGeneration'), icon: 'chat' };

// capabilityFromMode / defaultCap 的推断形状是运行时契约的组成部分（contractFor 直接展开它），
// 因此把它固化成显式契约；字段缺失时消费方会退回 defaultCap 的取值。
export interface ModelInputCapability {
  inputConstraints: CatalogInputConstraints;
  supportsInputImages: boolean;
  minInputImages: number;
  maxInputImages: number;
  inputImageRoles: string[];
  imageRole: string;
  supportsReferenceImages: boolean;
  referenceImageFormat: string;
  imageValueFormat: string;
  supportsMaskEditing: boolean;
  supportsImageStreaming: boolean;
  maskFormat: string;
  supportsInputVideo: boolean;
  minInputVideos: number;
  maxInputVideos: number;
  inputVideoRoles: string[];
  supportsInputAudio: boolean;
  minInputAudios: number;
  maxInputAudios: number;
  inputAudioRoles: string[];
  endpointPath: string;
  endpointScope: string;
  taskEndpointPath: string;
  taskEndpointScope: string;
  allowedDurations: number[];
  defaultDuration: number | null;
  supportedTextSubtasks: string[];
  pollStatusMap?: Record<string, string> | undefined;
  auth?: CatalogMode['auth'] | undefined;
  headers?: Record<string, string> | undefined;
  requestTemplate?: unknown;
  taskIdPath?: string | undefined;
  taskRequestTemplate?: unknown;
  statusPath?: string | undefined;
  progressPath?: string | undefined;
  errorPath?: string | undefined;
  errorCodePath?: string | undefined;
  errorMessagePath?: string | undefined;
  resultTextPath?: string | undefined;
  resultUrlPath?: string | undefined;
  resultBase64Path?: string | undefined;
  resultHexPath?: string | undefined;
  resultFormatPath?: string | undefined;
  resultMimeType?: string | undefined;
  resultFileExtension?: string | undefined;
  resultBody?: CatalogResultBody | undefined;
  resultEndpoint?: CatalogResultEndpoint | undefined;
  resultDownloadAuth?: boolean | undefined;
}

const defaultCap: ModelInputCapability = {
  inputConstraints: {} as CatalogInputConstraints,
  supportsInputImages: false, minInputImages: 0, maxInputImages: 0, inputImageRoles: [], imageRole: 'none',
  supportsReferenceImages: false,
  referenceImageFormat: 'string', imageValueFormat: 'data-url-or-url',
  supportsMaskEditing: false, supportsImageStreaming: false, maskFormat: 'alpha',
  supportsInputVideo: false, minInputVideos: 0, maxInputVideos: 0, inputVideoRoles: [],
  supportsInputAudio: false, minInputAudios: 0, maxInputAudios: 0, inputAudioRoles: [],
  endpointPath: '', endpointScope: 'v1', taskEndpointPath: '', taskEndpointScope: 'v1',
  allowedDurations: [], defaultDuration: null,
  supportedTextSubtasks: ['text-generation'],
};

class ModelCatalog {
  models: CatalogModel[];
  private modelMap: Map<string, CatalogModel>;

  constructor() {
    const raw = modelCatalogV2 as unknown as { version: number; models: CatalogModel[] };
    if (raw.version !== 2) throw new Error(t('catalog.validation.version'));
    this.models = (raw.models || []).filter((m) => m.enabled !== false);

    // 目录声明与运行时消费同一份客观执行契约；一条声明不完整就不能启动。
    for (const model of this.models) {
      const errors = catalogModelValidationErrors(model, { requireProvider: true });
      if (errors.length) throw new Error(errors.join('\n'));
    }

    this.modelMap = new Map(this.models.map((m) => [m.id, m]));
  }

  getModels(providerId = ''): CatalogModel[] {
    return this.models.filter((model) => !providerId || model.provider === providerId);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getModel(modelId: string): CatalogModel | undefined {
    return this.modelMap.get(modelId);
  }

  getModeConfig(modelId: string, modeId?: string): CatalogMode | null {
    const model = this.modelMap.get(modelId);
    if (!model) return null;
    const resolved = modeId || model.defaultMode;
    return this.expandedModes(model).find((m) => m.id === resolved) || null;
  }

  getModelModes(modelId: string): CatalogMode[] {
    const model = this.modelMap.get(modelId);
    return model ? model.modes.map(mode => ({ ...mode, label: catalogLabel(mode.label, mode.labelKey) })) : [];
  }

  getGenerationInputModes(modelId: string): GenerationInputModeDescriptor[] {
    const model = this.modelMap.get(modelId);
    if (!model) return [];
    const byMode = new Map<GenerationInputMode, GenerationInputModeDescriptor>();
    for (const mode of this.expandedModes(model)) {
      const semanticMode = this.semanticInputMode(mode, model.type);
      if (!semanticMode) continue;
      const input = mode.inputConstraints || {};
      byMode.set(semanticMode, {
        value: semanticMode,
        label: GENERATION_INPUT_MODE_LABELS[semanticMode],
        modeId: mode.id,
        slots: [...(mode.inputSlots || slotsForInputMode(semanticMode))],
        maxImages: input.images?.max || 0,
        maxVideos: input.videos?.max || 0,
        maxAudios: input.audios?.max || 0,
      });
    }
    return [...byMode.values()];
  }

  resolveModeIdForInputMode(modelId: string, inputMode?: string): string {
    if (!inputMode) return '';
    const model = this.modelMap.get(modelId);
    return model ? this.expandedModes(model).find((mode) => this.semanticInputMode(mode, model.type) === inputMode)?.id || '' : '';
  }

  private expandedModes(model: CatalogModel): CatalogMode[] {
    return model.modes.flatMap((mode) => [
      mode,
      ...(mode.inputVariants || []).map((variant) => ({
        ...mode,
        id: `${mode.id}::${variant.inputMode}`,
        label: catalogLabel(variant.label || GENERATION_INPUT_MODE_LABELS[variant.inputMode], variant.labelKey),
        inputMode: variant.inputMode,
        inputSlots: [...variant.inputSlots],
        inputConstraints: structuredClone(variant.inputConstraints),
        requestFields: { ...(mode.requestFields || {}), ...(variant.requestFields || {}) },
        inputVariants: [],
      })),
    ]);
  }

  private semanticInputMode(mode: CatalogMode, modelType = 'videoGeneration'): GenerationInputMode | null {
    if (mode.inputMode) return mode.inputMode;
    const images = mode.inputConstraints?.images?.max || 0;
    const videos = mode.inputConstraints?.videos?.max || 0;
    const audios = mode.inputConstraints?.audios?.max || 0;
    // Compatibility inference is deliberately local to the catalog. New/custom
    // providers should declare inputMode explicitly instead of leaking protocol
    // guesses into the canvas, Agent, or payload compiler.
    if (modelType !== 'videoGeneration' && (images > 0 || videos > 0 || audios > 0)) return 'reference';
    if (videos > 0 || audios > 0 || images > 1) return 'reference';
    if (images === 1) return 'firstFrame';
    return null;
  }

  getModelIdsByType(nodeType: string): string[] {
    return this.models
      .filter((m) => m.type === nodeType)
      .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99))
      .map((m) => m.id);
  }

  getModelInfo(modelId: string): { name: string; provider: string; type: string; upstreamModel: string } | null {
    const model = this.modelMap.get(modelId);
    return model ? {
      name: model.name,
      provider: model.provider,
      type: model.type,
      upstreamModel: model.upstreamModel || model.id,
    } : null;
  }

  isModelForType(nodeType: string, modelId: string): boolean {
    const model = this.modelMap.get(String(modelId || ''));
    return Boolean(model && model.type === nodeType);
  }

  getAllModelNames(): string[] {
    return this.models.map((m) => m.id);
  }

  // ── Mode Resolution ────────────────────────────────────────────────────────

  resolveModeConfig(modelId: string, inputRoles: string[] = [], requestedMode?: string): CatalogMode | null {
    const model = this.modelMap.get(modelId);
    if (!model) return null;
    const requested = requestedMode
      ? this.expandedModes(model).find((mode) => mode.id === requestedMode)
      : null;
    if (requestedMode) return requested && this.modeSupportsRoles(requested, inputRoles) ? requested : null;
    return this.expandedModes(model).find((mode) => this.modeSupportsRoles(mode, inputRoles)) || null;
  }

  private modeSupportsRoles(mode: CatalogMode, inputRoles: string[] = []): boolean {
    const roles = inputRoles.filter((r) => !['', 'auto', 'textContext'].includes(r));
    const imageRoles = roles.filter((r) =>
      ['image', 'referenceImage'].includes(r),
    );
    const videoRoles = roles.filter((r) => r === 'inputVideo');
    const audioRoles = roles.filter((r) => r === 'referenceAudio');
    const img = (mode.inputConstraints?.images || {}) as { min?: number; max?: number; roles?: string[] };
    const vid = (mode.inputConstraints?.videos || {}) as { min?: number; max?: number; roles?: string[] };
    const aud = (mode.inputConstraints?.audios || {}) as { min?: number; max?: number; roles?: string[] };
    const allowedImg = new Set(img.roles || []);
    const allowedVid = new Set(vid.roles || []);
    const allowedAud = new Set(aud.roles || []);
    const supportsImageRole = (role: string) => role === 'image'
      ? (img.max || 0) > 0
      : allowedImg.has(role);
    // Mode selection answers "which protocol can consume this input kind?".
    // Cardinality is checked later by generationUpstreamReadiness so an excess
    // input produces a useful limit error instead of the misleading "no mode".
    const imageKindSupported = imageRoles.length
      ? (img.max || 0) > 0 && imageRoles.every(supportsImageRole)
      : (img.min || 0) === 0;
    const videoKindSupported = videoRoles.length
      ? (vid.max || 0) > 0 && videoRoles.every((r) => !allowedVid.size || allowedVid.has(r))
      : (vid.min || 0) === 0;
    const audioKindSupported = audioRoles.length
      ? (aud.max || 0) > 0 && audioRoles.every((r) => !allowedAud.size || allowedAud.has(r))
      : (aud.min || 0) === 0;
    return imageKindSupported && videoKindSupported && audioKindSupported;
  }

  // ── Runtime Contract ───────────────────────────────────────────────────────

  resolveRuntimeContract(
    type: string,
    modelId: string,
    inputRoles: string[] = [],
    requestedMode?: string,
  ): ModelRuntimeContract | null {
    const model = this.modelMap.get(String(modelId || ''));
    if (!model || model.type !== type) return null;
    const mode = this.resolveModeConfig(model.id, inputRoles, requestedMode);
    return mode ? this.contractFor(model, mode) : null;
  }

  /** 从未保存的外部模型直接编译运行时契约，供试跑等场景使用。 */
  buildRuntimeContract(model: CatalogModel, modeId?: string): ModelRuntimeContract | null {
    if (!model || !model.type || !model.provider || !Array.isArray(model.modes) || !model.modes.length) return null;
    const expanded = this.expandedModes(model);
    const mode = expanded.find((item) => item.id === (modeId || model.defaultMode)) || expanded[0];
    return mode ? this.contractFor(model, mode) : null;
  }

  private contractFor(model: CatalogModel, mode: CatalogMode): ModelRuntimeContract {
    const cap = this.capabilityFromMode(mode);
    return {
      catalogVersion: 2,
      nodeType: model.type,
      modelId: model.id,
      upstreamModel: model.upstreamModel || model.id,
      modeId: mode.id,
      inputMode: this.semanticInputMode(mode, model.type),
      inputSlots: mode.inputSlots
        ? [...mode.inputSlots]
        : (this.semanticInputMode(mode, model.type) ? slotsForInputMode(this.semanticInputMode(mode, model.type)!) : []),
      provider: model.provider,
      endpoint: { ...mode.endpoint },
      taskEndpoint: mode.taskEndpoint ? { ...mode.taskEndpoint } : null,
      isAsync: mode.isAsync === true,
      inputFormat: mode.inputFormat || 'fields',
      requestFields: { ...mode.requestFields },
      contentTemplate: mode.contentTemplate === undefined ? undefined : structuredClone(mode.contentTemplate),
      outputConstraints: structuredClone(mode.outputConstraints || {}),
      agent: mode.agent ? structuredClone(mode.agent) : undefined,
      ...cap,
    };
  }

  private capabilityFromMode(mode: CatalogMode | null): ModelInputCapability {
    if (!mode) return { ...defaultCap };
    const input = mode.inputConstraints || {};
    const output = mode.outputConstraints || {};
    return {
      ...defaultCap,
      inputConstraints: structuredClone(input),
      supportsInputImages: (input.images?.max || 0) > 0,
      minInputImages: input.images?.min || 0,
      maxInputImages: input.images?.max || 0,
      inputImageRoles: [...(input.images?.roles || [])],
      imageRole: (input.images?.roles || []).join(',') || 'none',
      supportsReferenceImages: (input.images?.roles || []).some((r: string) => r === 'referenceImage'),
      referenceImageFormat: mode.referenceImageFormat || defaultCap.referenceImageFormat,
      imageValueFormat: mode.imageValueFormat || defaultCap.imageValueFormat,
      supportsInputVideo: (input.videos?.max || 0) > 0,
      minInputVideos: input.videos?.min || 0,
      maxInputVideos: input.videos?.max || 0,
      inputVideoRoles: [...(input.videos?.roles || [])],
      supportsInputAudio: (input.audios?.max || 0) > 0,
      minInputAudios: input.audios?.min || 0,
      maxInputAudios: input.audios?.max || 0,
      inputAudioRoles: [...(input.audios?.roles || [])],
      supportsMaskEditing: input.images?.maskRequired || false,
      allowedDurations: output.durations || [],
      defaultDuration: output.defaultDuration || null,
      endpointPath: mode.endpoint?.path || '',
      endpointScope: mode.endpoint?.scope || 'v1',
      taskEndpointPath: mode.taskEndpoint?.path || '',
      taskEndpointScope: mode.taskEndpoint?.scope || 'v1',
      supportedTextSubtasks: mode.id ? [mode.id] : ['text-generation'],
      pollStatusMap: mode.pollStatusMap,
      auth: mode.auth ? { ...mode.auth } : undefined,
      headers: { ...mode.headers },
      requestTemplate: mode.requestTemplate === undefined ? undefined : structuredClone(mode.requestTemplate),
      taskIdPath: mode.taskIdPath,
      taskRequestTemplate: mode.taskRequestTemplate === undefined ? undefined : structuredClone(mode.taskRequestTemplate),
      statusPath: mode.statusPath,
      progressPath: mode.progressPath,
      errorPath: mode.errorPath,
      errorCodePath: mode.errorCodePath,
      errorMessagePath: mode.errorMessagePath,
      resultTextPath: mode.resultTextPath,
      resultUrlPath: mode.resultUrlPath,
      resultBase64Path: mode.resultBase64Path,
      resultHexPath: mode.resultHexPath,
      resultFormatPath: mode.resultFormatPath,
      resultMimeType: mode.resultMimeType,
      resultFileExtension: mode.resultFileExtension,
      resultBody: mode.resultBody ? { ...mode.resultBody } : undefined,
      resultEndpoint: mode.resultEndpoint ? { ...mode.resultEndpoint } : undefined,
      resultDownloadAuth: mode.resultDownloadAuth,
    };
  }

  getModelInputCapability(modelId: string, modeId?: string): ModelInputCapability {
    return this.capabilityFromMode(this.getModeConfig(modelId, modeId));
  }

  getInputCapabilityForRoles(modelId: string, inputRoles: string[] = [], requestedMode?: string) {
    const mode = this.resolveModeConfig(modelId, inputRoles, requestedMode);
    return {
      supported: Boolean(mode),
      modeId: mode?.id || '',
      capability: mode ? this.getModelInputCapability(modelId, mode.id) : { ...defaultCap },
    };
  }

  // ── Schema / UI helpers ────────────────────────────────────────────────────

  getModelSchema(type: string, modelId?: string, modeId?: string): ModelSchema {
    const modeConfig = this.getModeConfig(modelId || '', modeId);
    const models = this.getModelIdsByType(type);
    if (modeConfig && modeConfig.params?.length) {
      return {
        models: models.length ? models : [modelId].filter(Boolean) as string[],
        params: modeConfig.params.map((p) => ({
          key: p.key,
          label: catalogLabel(p.label || p.key, p.labelKey),
          type: p.type || 'select',
          numeric: Boolean(p.numeric),
          default: p.default,
          options: (p.options || []).map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>).value : o)),
          ...(p.visibleWhen ? { visibleWhen: { ...p.visibleWhen } } : {}),
          ...(p.valueDefaults ? { valueDefaults: structuredClone(p.valueDefaults) } : {}),
          ...(p.presentation ? { presentation: p.presentation } : {}),
          // 音色参数只声明 control=voice，具体清单属于系统音色库，不在每个厂商模式里重复一遍。
          ...(isVoiceParam(p) && !p.optionLabels ? { optionLabels: systemVoiceOptionLabels } : {}),
          ...(p.optionLabels ? { optionLabels: Object.fromEntries(Object.entries(p.optionLabels).map(([value, label]) => [value, catalogLabel(String(label), p.optionLabelKeys?.[value])])) } : {}),
        })),
      };
    }
    return { models: models.length ? models : [modelId].filter(Boolean) as string[], params: [] };
  }

  /**
   * 文本模型在目录里声明的思考程度档位。界面与 Agent 循环共用这一份判定：
   * 没有声明档位、或只声明了一档（没有可选余地）就没有这个开关，代码不去猜厂商支持哪些级别。
   */
  getModelReasoningEffortParam(modelId: string): ModelSchema['params'][number] | null {
    const param = this.getModelSchema('textGeneration', modelId).params
      .find((item) => item.key === 'reasoningEffort');
    return param && param.options.length > 1 ? param : null;
  }

  /**
   * 用户没有选档位时 Agent 通道真正发出的那一档。目录可以在 agent.requestOptions 里为 Agent 固定
   * 一个与界面参数默认不同的推理档位（例如中转服务把 Agent 固定为关闭），否则回落到参数默认。
   * 界面用它写"不选择时使用哪一档"，循环用它补默认值，两边说的必须是同一个数。
   */
  getAgentReasoningDefault(modelId: string): string {
    const param = this.getModelReasoningEffortParam(modelId);
    if (!param) return '';
    const declared = this.getModeConfig(modelId)?.agent?.requestOptions?.reasoningEffort;
    const candidate = typeof declared === 'string' ? declared : param.default;
    if (param.options.some((option) => String(option) === String(candidate))) return String(candidate);
    return String(param.options[0]);
  }

  defaultConfigForType(type: string, modelId?: string): Record<string, unknown> {
    return Object.fromEntries(
      this.getModelSchema(type, modelId).params
        .filter((p) => p.key !== 'prompt' && p.key !== 'model')
        .map((p) => [p.key, p.default]),
    );
  }

  getAgentCatalog() {
    const types = ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'];
    return types.map((type) => {
      const typeModels = this.models
        .filter((m) => m.type === type)
        .filter((m) => type !== 'textGeneration' || this.getModeConfig(m.id, m.defaultMode)?.agent?.supportsTools === true)
        .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
      return {
        type,
        label: type,
        defaultModel: typeModels[0]?.id || '',
        models: typeModels.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          defaultMode: m.defaultMode,
          inputModes: this.getGenerationInputModes(m.id),
          modes: structuredClone(m.modes),
        })),
      };
    });
  }

  // ── Type meta ──────────────────────────────────────────────────────────────

  static readonly GENERATION_TYPES: TypeMeta[] = [
    { value: 'imageGeneration', label: t("ui.taskAdapter.imageGeneration.1f6a9dab"), defaultModel: defaultGenerationModel('imageGeneration'), icon: 'image' },
    { value: 'videoGeneration', label: t("ui.taskAdapter.videoGeneration.19978a8d"), defaultModel: defaultGenerationModel('videoGeneration'), icon: 'play' },
    { value: 'audioGeneration', label: t("ui.taskAdapter.audioGeneration.d371481a"), defaultModel: '', icon: 'waveform' },
    defaultTextTypeMeta,
  ];

  getTypeMeta(type: string): TypeMeta {
    return ModelCatalog.GENERATION_TYPES.find((t) => t.value === type) || defaultTextTypeMeta;
  }

  static coerceParamValue(param: CatalogParam, value: unknown): unknown {
    if (value === '' || value === null || value === undefined) return param.default;
    if (param.type === 'boolean') return Boolean(value);
    if (param.numeric) {
      const n = Number(value);
      if (!Number.isFinite(n)) return param.default;
      const presentation = typeof param.presentation === 'object' ? param.presentation : null;
      const min = Number(presentation?.min);
      const max = Number(presentation?.max);
      let normalized = n;
      if (Number.isFinite(min)) normalized = Math.max(min, normalized);
      if (Number.isFinite(max)) normalized = Math.min(max, normalized);
      return normalized;
    }
    return value;
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const modelCatalog = new ModelCatalog();
export const getCatalogModels = (providerId = '') => modelCatalog.getModels(providerId);

// Re-export query functions for drop-in compatibility
export const getModelModeConfig = (modelId: string, modeId?: string) => modelCatalog.getModeConfig(modelId, modeId);
export const getModelModes = (modelId: string) => modelCatalog.getModelModes(modelId);
export const getGenerationInputModes = (modelId: string) => modelCatalog.getGenerationInputModes(modelId);
export const resolveModeIdForInputMode = (modelId: string, inputMode?: string) =>
  modelCatalog.resolveModeIdForInputMode(modelId, inputMode);
export const getModelIdsByType = (nodeType: string) => modelCatalog.getModelIdsByType(nodeType);
export const getModelInfo = (modelId: string) => modelCatalog.getModelInfo(modelId);
export const getModelReasoningEffortParam = (modelId: string) => modelCatalog.getModelReasoningEffortParam(modelId);
export const getAgentReasoningDefault = (modelId: string) => modelCatalog.getAgentReasoningDefault(modelId);
export const isModelForType = (nodeType: string | undefined, modelId: string) => modelCatalog.isModelForType(String(nodeType || ''), modelId);
export const getAllModelNames = () => modelCatalog.getAllModelNames();
export const resolveModelModeConfig = (modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.resolveModeConfig(modelId, inputRoles, requestedMode);
export const resolveModelRuntimeContract = (type: string | undefined, modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.resolveRuntimeContract(String(type || ''), modelId, inputRoles, requestedMode);
export const buildRuntimeContractForModel = (model: CatalogModel, modeId?: string) =>
  modelCatalog.buildRuntimeContract(model, modeId);
export const getModelInputCapabilityForRoles = (_type: string | undefined, modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.getInputCapabilityForRoles(modelId, inputRoles, requestedMode);
export const getModelSchema = (type: string | undefined, modelId?: string, modeId?: string) =>
  modelCatalog.getModelSchema(String(type || ''), modelId, modeId);
export const defaultConfigForType = (type: string, modelId?: string) =>
  modelCatalog.defaultConfigForType(type, modelId);
export const getAgentModelCatalog = () => modelCatalog.getAgentCatalog();
export const getTypeMeta = (type: string) => modelCatalog.getTypeMeta(type);
export const coerceParamValue = (param: CatalogParam, value: unknown) => ModelCatalog.coerceParamValue(param, value);
export const GENERATION_TYPES = ModelCatalog.GENERATION_TYPES;

export { modelCatalog as default };

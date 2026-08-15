/**
 * ModelCatalog — 模型目录 v2 解析与查询。
 *
 * 框架无关的纯 TypeScript 模块。model-catalog-v2.json 是唯一模型能力来源。
 * 不依赖 Vue、Vue Flow 或任何 Store。
 */

import modelCatalogV2 from '../../config/model-catalog-v2.json';
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
  type: string;
  required?: boolean;
  default?: unknown;
  numeric?: boolean;
  options?: unknown[];
  conflictsWith?: string[];
  visibleWhen?: Record<string, unknown>;
  presentation?: string | {
    control: 'segmented' | 'select' | 'ratio' | 'resolution' | 'slider' | 'number' | 'toggle' | 'text' | 'hidden';
    group?: string;
    summary?: boolean;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
  };
  optionLabels?: Record<string, string>;
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
  supportsToolCalls?: boolean;
  supportsStructuredOutput?: boolean;
  maxTokens?: number;
}

export interface CatalogMode {
  id: string;
  label: string;
  endpoint: CatalogEndpoint;
  taskEndpoint?: CatalogEndpoint;
  isAsync?: boolean;
  inputFormat?: string;
  inputConstraints: CatalogInputConstraints;
  outputConstraints: CatalogOutputConstraints;
  requestFields?: Record<string, string>;
  imageValueFormat?: string;
  referenceImageFormat?: string;
  pollStatusMap?: Record<string, string>;
  auth?: { type: 'bearer' | 'header' | 'none'; name?: string; prefix?: string };
  headers?: Record<string, string>;
  requestTemplate?: unknown;
  taskIdPath?: string;
  statusPath?: string;
  progressPath?: string;
  errorPath?: string;
  resultTextPath?: string;
  resultUrlPath?: string;
  resultBase64Path?: string;
  resultHexPath?: string;
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
    inputSlots: Array<'reference' | 'firstFrame' | 'lastFrame' | 'inputVideo' | 'referenceAudio'>;
    inputConstraints: CatalogInputConstraints;
    requestFields?: Record<string, string>;
  }>;
}

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  type: string;
  sortOrder: number;
  enabled: boolean;
  disabledReason?: string;
  defaultMode: string;
  modes: CatalogMode[];
  /** 用户在设置中基于同 ID 内置模型保存的本机覆盖。 */
  overridesBuiltIn?: boolean;
}

export interface ModelRuntimeContract {
  catalogVersion: number;
  nodeType: string;
  modelId: string;
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
  pollStatusMap?: Record<string, string>;
  auth?: CatalogMode['auth'];
  headers?: Record<string, string>;
  requestTemplate?: unknown;
  taskIdPath?: string;
  statusPath?: string;
  progressPath?: string;
  errorPath?: string;
  resultTextPath?: string;
  resultUrlPath?: string;
  resultBase64Path?: string;
  resultHexPath?: string;
  resultMimeType?: string;
  resultFileExtension?: string;
  resultBody?: CatalogResultBody;
  resultEndpoint?: CatalogResultEndpoint;
  resultDownloadAuth?: boolean;
}

export interface ModelSchema {
  models: string[];
  params: Array<{
    key: string;
    label: string;
    type: string;
    numeric: boolean;
    default: unknown;
    options: unknown[];
    visibleWhen?: Record<string, unknown>;
    presentation?: CatalogParam['presentation'];
    optionLabels?: Record<string, string>;
  }>;
}

export interface TypeMeta {
  value: string;
  label: string;
  defaultModel: string;
  icon: string;
}

// ── Singleton Catalog ────────────────────────────────────────────────────────

const defaultCap = {
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
  private readonly builtInModels: CatalogModel[];
  private modelMap: Map<string, CatalogModel>;

  constructor() {
    const raw = modelCatalogV2 as { version: number; models: CatalogModel[] };
    if (raw.version !== 2) throw new Error('model-catalog-v2.json version must be 2');
    this.builtInModels = (raw.models || []).filter((m) => m.enabled !== false);
    this.models = [...this.builtInModels];

    // Validate
    for (const model of this.models) {
      if (!model.id || !model.type || !Array.isArray(model.modes) || !model.modes.length) {
        throw new Error(`Invalid v2 model entry: ${model.id || '<missing id>'}`);
      }
      if (!model.modes.some((mode) => mode.id === model.defaultMode)) {
        throw new Error(`${model.id}: defaultMode ${model.defaultMode} does not exist`);
      }
      for (const mode of model.modes) {
        if (!mode.id || !mode.endpoint?.path || !mode.endpoint?.method || mode.requestTemplate === undefined) {
          throw new Error(`${model.id}/${mode.id || '<missing mode>'}: declarative endpoint and requestTemplate are required`);
        }
        if (mode.isAsync === true && !mode.taskEndpoint?.path) {
          throw new Error(`${model.id}/${mode.id}: async mode requires taskEndpoint`);
        }
        if (mode.inputMode && !Object.hasOwn(GENERATION_INPUT_MODE_LABELS, mode.inputMode)) {
          throw new Error(`${model.id}/${mode.id}: unknown inputMode ${mode.inputMode}`);
        }
        for (const variant of mode.inputVariants || []) {
          if (!Object.hasOwn(GENERATION_INPUT_MODE_LABELS, variant.inputMode) || !variant.inputSlots?.length) {
            throw new Error(`${model.id}/${mode.id}: invalid input variant ${variant.inputMode || '<missing>'}`);
          }
        }
      }
    }

    this.modelMap = new Map(this.models.map((m) => [m.id, m]));
  }

  /** 替换设置中声明的外部模型；只有显式标记的条目可以覆盖同 ID 内置模型。 */
  setExternalModels(models: CatalogModel[] = []): void {
    const builtInById = new Map(this.builtInModels.map((model) => [model.id, model]));
    const overrides = new Map<string, CatalogModel>();
    const external: CatalogModel[] = [];
    const occupied = new Set<string>();
    for (const model of models) {
      if (!model?.id || occupied.has(model.id)) continue;
      if (!model.type || !model.provider || !model.modes?.length) continue;
      const validModes = model.modes.filter((mode) => (
        Boolean(mode?.id && mode.endpoint?.path && mode.endpoint?.method && mode.requestTemplate !== undefined)
        && (mode.isAsync !== true || Boolean(mode.taskEndpoint?.path))
        && (!mode.inputMode || Object.hasOwn(GENERATION_INPUT_MODE_LABELS, mode.inputMode))
      ));
      if (!validModes.length) continue;
      occupied.add(model.id);
      const normalized = {
        ...model,
        enabled: true,
        defaultMode: validModes.some((mode) => mode.id === model.defaultMode)
          ? model.defaultMode
          : validModes[0].id,
        modes: validModes,
      };
      const builtIn = builtInById.get(model.id);
      if (builtIn) {
        // A cross-provider duplicate is necessarily a routing override: keeping
        // the built-in provider would make the saved external model unreachable.
        if (model.overridesBuiltIn === true || model.provider !== builtIn.provider) {
          overrides.set(model.id, normalized);
        }
        continue;
      }
      external.push(normalized);
    }
    this.models = [
      ...this.builtInModels.map(model => overrides.get(model.id) || model),
      ...external,
    ];
    this.modelMap = new Map(this.models.map((model) => [model.id, model]));
  }

  getBuiltInModels(providerId = ''): CatalogModel[] {
    return this.builtInModels.filter((model) => !providerId || model.provider === providerId);
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
    return model ? model.modes : [];
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
        label: variant.label || GENERATION_INPUT_MODE_LABELS[variant.inputMode],
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

  getModelInfo(modelId: string): { name: string; provider: string; type: string } | null {
    const model = this.modelMap.get(modelId);
    return model ? { name: model.name, provider: model.provider, type: model.type } : null;
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
    if (!mode) return null;
    const cap = this.capabilityFromMode(mode);
    return {
      catalogVersion: 2,
      nodeType: type,
      modelId: model.id,
      modeId: mode.id,
      inputMode: this.semanticInputMode(mode, model.type),
      inputSlots: [...(mode.inputSlots || (this.semanticInputMode(mode, model.type) ? slotsForInputMode(this.semanticInputMode(mode, model.type)!) : []))],
      provider: model.provider,
      endpoint: { ...mode.endpoint },
      taskEndpoint: mode.taskEndpoint ? { ...mode.taskEndpoint } : null,
      isAsync: mode.isAsync === true,
      inputFormat: mode.inputFormat || 'fields',
      requestFields: { ...mode.requestFields },
      outputConstraints: structuredClone(mode.outputConstraints || {}),
      ...cap,
    };
  }

  private capabilityFromMode(mode: CatalogMode | null) {
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
      statusPath: mode.statusPath,
      progressPath: mode.progressPath,
      errorPath: mode.errorPath,
      resultTextPath: mode.resultTextPath,
      resultUrlPath: mode.resultUrlPath,
      resultBase64Path: mode.resultBase64Path,
      resultHexPath: mode.resultHexPath,
      resultMimeType: mode.resultMimeType,
      resultFileExtension: mode.resultFileExtension,
      resultBody: mode.resultBody ? { ...mode.resultBody } : undefined,
      resultEndpoint: mode.resultEndpoint ? { ...mode.resultEndpoint } : undefined,
      resultDownloadAuth: mode.resultDownloadAuth,
    };
  }

  getModelInputCapability(modelId: string, modeId?: string) {
    return this.capabilityFromMode(this.getModeConfig(modelId, modeId));
  }

  getInputCapabilityForRoles(type: string, modelId: string, inputRoles: string[] = [], requestedMode?: string) {
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
          label: p.label || p.key,
          type: p.type || 'select',
          numeric: Boolean(p.numeric),
          default: p.default,
          options: (p.options || []).map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>).value : o)),
          ...(p.visibleWhen ? { visibleWhen: { ...p.visibleWhen } } : {}),
          ...(p.presentation ? { presentation: p.presentation } : {}),
          ...(p.optionLabels ? { optionLabels: { ...p.optionLabels } } : {}),
        })),
      };
    }
    return { models: models.length ? models : [modelId].filter(Boolean) as string[], params: [] };
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
        .filter((m) => type !== 'textGeneration' || m.modes.some((mode) => mode.outputConstraints.supportsToolCalls === true))
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
    { value: 'imageGeneration', label: '图片生成', defaultModel: 'gpt-image-2', icon: 'image' },
    { value: 'videoGeneration', label: '视频生成', defaultModel: 'grok-imagine-video', icon: 'play' },
    { value: 'audioGeneration', label: '音频生成', defaultModel: '', icon: 'waveform' },
    { value: 'textGeneration', label: '文本生成', defaultModel: 'gpt-5.4', icon: 'chat' },
  ];

  getTypeMeta(type: string): TypeMeta {
    return ModelCatalog.GENERATION_TYPES.find((t) => t.value === type) || ModelCatalog.GENERATION_TYPES[3];
  }

  static coerceParamValue(param: CatalogParam, value: unknown): unknown {
    if (param.type === 'boolean') return Boolean(value);
    if (param.numeric) {
      const n = Number(value);
      return Number.isFinite(n) ? n : param.default;
    }
    return value;
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const modelCatalog = new ModelCatalog();
export const setExternalCatalogModels = (models: CatalogModel[]) => modelCatalog.setExternalModels(models);
export const getBuiltInCatalogModels = (providerId = '') => modelCatalog.getBuiltInModels(providerId);

// Re-export query functions for drop-in compatibility
export const getModelModeConfig = (modelId: string, modeId?: string) => modelCatalog.getModeConfig(modelId, modeId);
export const getModelModes = (modelId: string) => modelCatalog.getModelModes(modelId);
export const getGenerationInputModes = (modelId: string) => modelCatalog.getGenerationInputModes(modelId);
export const resolveModeIdForInputMode = (modelId: string, inputMode?: string) =>
  modelCatalog.resolveModeIdForInputMode(modelId, inputMode);
export const getModelIdsByType = (nodeType: string) => modelCatalog.getModelIdsByType(nodeType);
export const getModelInfo = (modelId: string) => modelCatalog.getModelInfo(modelId);
export const isModelForType = (nodeType: string, modelId: string) => modelCatalog.isModelForType(nodeType, modelId);
export const getAllModelNames = () => modelCatalog.getAllModelNames();
export const resolveModelModeConfig = (modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.resolveModeConfig(modelId, inputRoles, requestedMode);
export const resolveModelRuntimeContract = (type: string, modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.resolveRuntimeContract(type, modelId, inputRoles, requestedMode);
export const getModelInputCapability = (type: string, modelId: string, modeId?: string) =>
  modelCatalog.getModelInputCapability(modelId, modeId);
export const getModelInputCapabilityForRoles = (type: string, modelId: string, inputRoles?: string[], requestedMode?: string) =>
  modelCatalog.getInputCapabilityForRoles(type, modelId, inputRoles, requestedMode);
export const getModelSchema = (type: string, modelId?: string, modeId?: string) =>
  modelCatalog.getModelSchema(type, modelId, modeId);
export const defaultConfigForType = (type: string, modelId?: string) =>
  modelCatalog.defaultConfigForType(type, modelId);
export const getAgentModelCatalog = () => modelCatalog.getAgentCatalog();
export const getTypeMeta = (type: string) => modelCatalog.getTypeMeta(type);
export const coerceParamValue = (param: CatalogParam, value: unknown) => ModelCatalog.coerceParamValue(param, value);
export const GENERATION_TYPES = ModelCatalog.GENERATION_TYPES;

export { modelCatalog as default };

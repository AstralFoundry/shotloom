const GENERATION_NODE_TYPES = new Set([
  'imageGeneration',
  'videoGeneration',
  'audioGeneration',
  'textGeneration',
]);

type UnknownRecord = Record<string, unknown>;

export interface GenerationConfigParam {
  key: string;
  type?: string;
  numeric?: boolean;
  default?: unknown;
  options?: unknown[];
}

/** 本地编排控制，不会原样发送给模型供应商。 */
const LOCAL_CONFIG_KEYS = new Set([
  'mode', 'inputStrategy', 'cameraControl', 'cameraConfig', 'stylePresetId', 'textSubtask',
]);

const OUTPUT_SPEC_KEYS_BY_TYPE: Record<string, Set<string>> = {
  imageGeneration: new Set(['aspectRatio', 'generationCount', 'quality']),
  videoGeneration: new Set(['aspectRatio', 'duration', 'resolution', 'generateAudio', 'quality']),
  audioGeneration: new Set(['duration', 'quality']),
  textGeneration: new Set(),
};

export function isGenerationNodeType(type: unknown): boolean {
  return GENERATION_NODE_TYPES.has(String(type || ''));
}

/** 画布 config 只保存模型参数；prompt/model 属于节点顶层字段。 */
export function generationNodeConfig(value: unknown): UnknownRecord {
  const config = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as UnknownRecord) }
    : {};
  const duplicateFields = ['prompt', 'model'].filter((field) => field in config);
  if (duplicateFields.length) {
    throw new Error(`生成节点 config 不得包含 ${duplicateFields.join('/')}，请使用节点顶层字段`);
  }
  return config;
}

function optionValue(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
    ? (value as UnknownRecord).value
    : value;
}

function coerceParam(param: GenerationConfigParam, value: unknown): unknown {
  let next = value === undefined ? param.default : value;
  if (param.type === 'boolean') next = Boolean(next);
  if (param.numeric) {
    const number = Number(next);
    next = Number.isFinite(number) ? number : param.default;
  }
  const allowed = (param.options || []).map(optionValue);
  return allowed.length && !allowed.includes(next) ? param.default : next;
}

function ratioValue(value: unknown): number | null {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function closestSize(aspectRatio: unknown, options: unknown[]): unknown {
  const requested = ratioValue(aspectRatio);
  if (!requested) return undefined;
  return options
    .map(optionValue)
    .map((value) => ({ value, ratio: ratioValue(value) }))
    .filter((item): item is { value: unknown; ratio: number } => item.ratio !== null)
    .sort((a, b) => Math.abs(a.ratio - requested) - Math.abs(b.ratio - requested))[0]?.value;
}

/**
 * 把 Agent 的稳定输出意图编译成当前模型 mode 的真实参数。
 * 这是纯同步操作：只做 schema 白名单、默认值和枚举归一化。
 */
export function compileGenerationNodeConfig(
  value: unknown,
  params: GenerationConfigParam[] = [],
  outputSpecValue: unknown = {},
): UnknownRecord {
  const source = generationNodeConfig(value);
  const outputSpec = outputSpecValue && typeof outputSpecValue === 'object' && !Array.isArray(outputSpecValue)
    ? outputSpecValue as UnknownRecord
    : {};
  const byKey = new Map(params
    .filter((param) => param?.key && !['prompt', 'model'].includes(param.key))
    .map((param) => [param.key, param]));
  const compiled: UnknownRecord = {};

  for (const [key, next] of Object.entries(source)) {
    if (LOCAL_CONFIG_KEYS.has(key)) compiled[key] = next;
  }
  for (const [key, param] of byKey) {
    let next = source[key] ?? outputSpec[key];
    if (key === 'size') {
      next = source.size
        ?? source.imageSize
        ?? closestSize(outputSpec.aspectRatio ?? source.aspectRatio, param.options || []);
    }
    if (next === undefined && key === 'aspectRatio') next = outputSpec.aspectRatio;
    if (next === undefined && key === 'generationCount') next = outputSpec.generationCount;
    if (next === undefined && key === 'generateAudio') next = outputSpec.generateAudio;
    compiled[key] = coerceParam(param, next);
  }
  return compiled;
}

/** 从 action 中保留跨模型稳定的创作意图；它不是供应商请求参数。 */
export function generationOutputSpec(
  nodeType: unknown,
  configValue: unknown,
  outputSpecValue: unknown = {},
): UnknownRecord {
  const config = generationNodeConfig(configValue);
  const explicit = outputSpecValue && typeof outputSpecValue === 'object' && !Array.isArray(outputSpecValue)
    ? outputSpecValue as UnknownRecord
    : {};
  const allowed = OUTPUT_SPEC_KEYS_BY_TYPE[String(nodeType || '')] || new Set<string>();
  return Object.fromEntries([...allowed]
    .filter((key) => explicit[key] !== undefined || config[key] !== undefined)
    .map((key) => [key, explicit[key] ?? config[key]]));
}

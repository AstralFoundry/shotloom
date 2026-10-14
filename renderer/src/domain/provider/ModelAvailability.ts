import {
  GENERATION_TYPES,
  getAgentModelCatalog,
  getCatalogModels,
  getModelIdsByType,
  getModelInfo,
  getTypeMeta,
  type CatalogInputConstraints,
  type CatalogModel,
} from '../catalog/ModelCatalog';
import { findProviderAdapter, resolveProviderBaseUrl } from './adapters';
import type { ProviderConfigs } from './ProviderConfig';

export interface ModelCredentialStatus {
  available: boolean;
  modelId: string;
  providerId: string;
  providerName: string;
  message: string;
}

export function isProviderConfigured(providerId: string, configs: ProviderConfigs = {}): boolean {
  const adapter = findProviderAdapter(providerId);
  if (!adapter) return false;
  const config = configs?.[providerId];
  const baseUrl = resolveProviderBaseUrl(adapter, config || {});
  return Boolean(String(config?.apiKey || '').trim() && (!adapter.baseUrlRequired || baseUrl));
}

export function getModelCredentialStatus(
  modelId: string,
  configs: ProviderConfigs = {},
): ModelCredentialStatus {
  const info = getModelInfo(modelId);
  const providerId = String(info?.provider || '');
  const providerName = findProviderAdapter(providerId)?.name || providerId || '未知厂商';
  const available = Boolean(info && providerId && isProviderConfigured(providerId, configs));
  return {
    available,
    modelId,
    providerId,
    providerName,
    message: info
      ? `${providerName} API Key 未配置`
      : `模型 ${modelId || '未知模型'} 不在模型目录中`,
  };
}

export function getConfiguredModelIdsByType(
  nodeType: string,
  configs: ProviderConfigs = {},
): string[] {
  return getModelIdsByType(nodeType)
    .filter((modelId) => getModelCredentialStatus(modelId, configs).available);
}

export function getConfiguredAgentModelCatalog(configs: ProviderConfigs = {}) {
  return getAgentModelCatalog()
    .map((entry) => {
      const models = entry.models.filter((model) => isProviderConfigured(model.provider, configs));
      return { ...entry, defaultModel: models[0]?.id || '', models };
    })
    .filter((entry) => entry.models.length > 0);
}

export interface ProviderModelRow {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  /** 目录真实声明的媒体输入；用来区分纯文本模型与图生视频、音频驱动等多模态模型。 */
  inputs: Array<'image' | 'video' | 'audio'>;
  agentReady: boolean;
}

const MODEL_INPUT_KINDS = ['image', 'video', 'audio'] as const;

function acceptsInput(constraint: CatalogInputConstraints | undefined, key: 'images' | 'videos' | 'audios') {
  return Number(constraint?.[key]?.min || 0) > 0 || Number(constraint?.[key]?.max || 0) > 0;
}

function declaredInputs(model: CatalogModel): ProviderModelRow['inputs'] {
  const constraints: CatalogInputConstraints[] = [];
  for (const mode of model.modes) {
    constraints.push(mode.inputConstraints);
    for (const variant of mode.inputVariants || []) constraints.push(variant.inputConstraints);
  }
  const keys = { image: 'images', video: 'videos', audio: 'audios' } as const;
  return MODEL_INPUT_KINDS.filter((kind) =>
    constraints.some((constraint) => acceptsInput(constraint, keys[kind])));
}

let agentModelIds: Set<string> | null = null;
function isAgentModel(modelId: string) {
  if (!agentModelIds) {
    agentModelIds = new Set(
      getAgentModelCatalog().flatMap((entry) => entry.models.map((model) => model.id)),
    );
  }
  return agentModelIds.has(modelId);
}

const MODEL_TYPE_ORDER = new Map(GENERATION_TYPES.map((meta, index) => [meta.value, index]));

/** 厂商在代码里声明的全部模型，按生成类型和目录顺序排列，供界面直接展示。 */
export function getProviderModelRows(providerId: string): ProviderModelRow[] {
  return getCatalogModels(providerId)
    .sort((a, b) =>
      (MODEL_TYPE_ORDER.get(a.type) ?? MODEL_TYPE_ORDER.size) -
        (MODEL_TYPE_ORDER.get(b.type) ?? MODEL_TYPE_ORDER.size) ||
      (a.sortOrder || 99) - (b.sortOrder || 99))
    .map((model) => ({
      id: model.id,
      name: model.name,
      type: model.type,
      typeLabel: getTypeMeta(model.type).label,
      inputs: declaredInputs(model),
      agentReady: isAgentModel(model.id),
    }));
}

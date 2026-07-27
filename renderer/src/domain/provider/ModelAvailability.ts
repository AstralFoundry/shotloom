import {
  getAgentModelCatalog,
  getModelIdsByType,
  getModelInfo,
} from '../catalog/ModelCatalog';
import { getProviderDefinition } from './ProviderRegistry';
import type { ProviderConfig } from './ProviderRegistry';

export type ProviderConfigs = Record<string, ProviderConfig>;

export interface ModelCredentialStatus {
  available: boolean;
  modelId: string;
  providerId: string;
  providerName: string;
  message: string;
}

function isModelDisabled(providerId: string, modelId: string, configs: ProviderConfigs): boolean {
  return (configs?.[providerId]?.disabledModelIds || []).includes(modelId);
}

export function isProviderConfigured(providerId: string, configs: ProviderConfigs = {}): boolean {
  const config = configs?.[providerId];
  const definition = getProviderDefinition(providerId);
  const requiresBaseUrl = !definition || definition.credentials.some((field) => field.key === 'baseUrl' && field.required);
  const resolvedBaseUrl = String(config?.baseUrl || definition?.defaultBaseUrl || '').trim();
  return Boolean(String(config?.apiKey || '').trim() && (!requiresBaseUrl || resolvedBaseUrl));
}

export function getModelCredentialStatus(
  modelId: string,
  configs: ProviderConfigs = {},
): ModelCredentialStatus {
  const info = getModelInfo(modelId);
  const providerId = String(info?.provider || '');
  const providerName = configs?.[providerId]?.displayName || getProviderDefinition(providerId)?.name || providerId || '未知厂商';
  const disabled = Boolean(info && providerId && isModelDisabled(providerId, modelId, configs));
  const available = Boolean(info && providerId && !disabled && isProviderConfigured(providerId, configs));
  return {
    available,
    modelId,
    providerId,
    providerName,
    message: info
      ? disabled
        ? `${info.name} 已在 ${providerName} 设置中停用`
        : `${providerName} API Key 未配置`
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
      const models = entry.models.filter((model) => (
        isProviderConfigured(model.provider, configs)
        && !isModelDisabled(model.provider, model.id, configs)
      ));
      return { ...entry, defaultModel: models[0]?.id || '', models };
    })
    .filter((entry) => entry.models.length > 0);
}

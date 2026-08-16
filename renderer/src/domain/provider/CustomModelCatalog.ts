import type { CatalogModel } from '../catalog/ModelCatalog';
import type {
  ProviderConfig,
} from './ProviderRegistry';
import { clonePlainData } from '../../utils/plainDataClone.mjs';

function toCatalogModel(provider: string, model: CatalogModel, index: number): CatalogModel | null {
  const id = String(model.id || '').trim();
  if (!id || !Array.isArray(model.modes) || !model.modes.length) return null;
  return {
    ...clonePlainData(model),
    id,
    name: String(model.name || id).trim() || id,
    provider,
    sortOrder: Number(model.sortOrder) || 900 + index,
    enabled: model.enabled !== false,
  };
}

export function buildCustomCatalogModels(configs: Record<string, ProviderConfig> = {}): CatalogModel[] {
  return Object.entries(configs).flatMap(([provider, config]) => (
    (Array.isArray(config?.models) ? config.models : [])
      .map((model, index) => toCatalogModel(provider, model, index))
      .filter((model): model is CatalogModel => Boolean(model?.enabled))
  ));
}

export function findDuplicateCustomModelIds(
  configs: Record<string, ProviderConfig> = {},
): Array<{ modelId: string; providers: string[] }> {
  const owners = new Map<string, Set<string>>();
  for (const [provider, config] of Object.entries(configs)) {
    for (const model of Array.isArray(config?.models) ? config.models : []) {
      const modelId = String(model?.id || '').trim();
      if (!modelId || model?.enabled === false) continue;
      const providers = owners.get(modelId) || new Set<string>();
      providers.add(provider);
      owners.set(modelId, providers);
    }
  }
  return [...owners.entries()]
    .filter(([, providers]) => providers.size > 1)
    .map(([modelId, providers]) => ({ modelId, providers: [...providers] }));
}

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

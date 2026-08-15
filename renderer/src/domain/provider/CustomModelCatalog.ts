import {
  getBuiltInAdapterTemplates,
  type CatalogModel,
} from "../catalog/ModelCatalog";
import type { ProviderConfig } from "./ProviderRegistry";
import type { ProviderProtocolAdapter } from "./ProviderAdapterContract";
import { clonePlainData } from "../../utils/plainDataClone.mjs";
import { compileProviderModels } from "./ProviderAdapterContract";

export function buildCustomCatalogModels(
  configs: Record<string, ProviderConfig> = {},
  protocolAdapters: ProviderProtocolAdapter[] = [],
): CatalogModel[] {
  const adapterMap = new Map(
    getBuiltInAdapterTemplates().map(({ adapter }) => [adapter.id, adapter]),
  );
  clonePlainData(protocolAdapters).forEach((adapter: ProviderProtocolAdapter) =>
    adapterMap.set(adapter.id, adapter),
  );
  const adapters = [...adapterMap.values()];
  return Object.entries(configs).flatMap(([provider, config]) =>
    compileProviderModels(
      provider,
      adapters,
      clonePlainData(config?.modelBindings || []),
    ).filter((model) => model.enabled),
  );
}

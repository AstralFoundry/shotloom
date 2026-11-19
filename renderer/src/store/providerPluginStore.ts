import { reactive } from './domainReactivity';
import { desktopApi } from '../services/desktopApi';
import { catalogModelValidationErrors } from '../domain/catalog/ModelCatalog';
import {
  allProviderPlugins, registeredProviders, registeredModels,
  providerManifestErrors, provisionPluginConnections, expandProviderModels, providerPluginSnapshot, setProviderPluginSnapshot,
  type ProviderPluginManifest, type ProviderPluginSnapshot, type ProviderConnection,
} from '../domain/provider/plugins/ProviderPlugins';

export const providerPluginStore = reactive({ revision: 0, loading: false, error: '' });
function validateRegistry(next: ProviderPluginSnapshot) {
  const old = providerPluginSnapshot();
  try {
    setProviderPluginSnapshot(next);
    const identities = new Map<string, string>();
    for (const plugin of allProviderPlugins()) for (const id of [plugin.manifest.id, ...(plugin.manifest.legacyProviders || []).map(alias => alias.pluginId)]) {
      if (identities.has(id) && identities.get(id) !== plugin.manifest.id) throw new Error(`Plugin identity already belongs to another package: ${id}`);
      identities.set(id, plugin.manifest.id);
    }
    const providerIds = new Set<string>();
    for (const provider of registeredProviders()) {
      if (providerIds.has(provider.id)) throw new Error(`Duplicate provider or connection id: ${provider.id}`);
      providerIds.add(provider.id);
    }
    const modelIds = new Set<string>();
    for (const model of registeredModels()) {
      if (modelIds.has(model.id)) throw new Error(`Duplicate model id: ${model.id}`);
      modelIds.add(model.id);
      const errors = catalogModelValidationErrors(model, { requireProvider: true });
      if (errors.length) throw new Error(errors.join('\n'));
    }
  } finally { setProviderPluginSnapshot(old); }
}
function apply(snapshot: ProviderPluginSnapshot) {
  validateRegistry(snapshot);
  setProviderPluginSnapshot(snapshot); providerPluginStore.revision++;
}
let subscribed = false;
export async function loadProviderPlugins() {
  if (!subscribed) { subscribed = true; desktopApi.providerPlugins.onChanged(() => { void loadProviderPlugins(); }); }
  providerPluginStore.loading = true;
  try { apply(await desktopApi.providerPlugins.manage('list')); providerPluginStore.error = ''; }
  catch (error) { providerPluginStore.error = String(error); }
  finally { providerPluginStore.loading = false; }
}
export function validateProviderPackage(manifest: ProviderPluginManifest) {
  const errors = providerManifestErrors(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  if (manifest.kind === 'protocol') {
    for (const operation of manifest.protocols.filter(operation => !manifest.capabilities?.some(capability => capability.operation === operation.id))) {
      const model = { id: `${manifest.id}.${operation.id}`, name: manifest.name, provider: 'protocol', type: manifest.category,
        sortOrder: 1, enabled: true, defaultMode: operation.mode.id, modes: [operation.mode] };
      errors.push(...catalogModelValidationErrors(model, { requireProvider: true }));
    }
  }
  const ids = new Set<string>();
  for (const preset of manifest.providers) {
    const models = expandProviderModels({ ...preset, presetId: preset.id, plugin: { id: manifest.id, version: manifest.version, providerId: preset.id } }, manifest);
    for (const model of models) {
      if (ids.has(model.id)) errors.push(`Duplicate model id: ${model.id}`);
      ids.add(model.id);
      errors.push(...catalogModelValidationErrors(model, { requireProvider: true }));
    }
  }
  const next = structuredClone(providerPluginSnapshot());
  next.plugins = next.plugins.filter(plugin => plugin.manifest.id !== manifest.id);
  next.plugins.push({ manifest, enabled: true, digest: '', source: '', trustedCode: false, installedAt: '', history: [] });
  provisionPluginConnections(next, manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  validateRegistry(next);
}
export async function inspectProviderPackage(source: string, registry = 'npm') {
  const result = await desktopApi.providerPlugins.manage('inspect', { source, registry });
  validateProviderPackage(result.manifest);
  return result as { manifest: ProviderPluginManifest; digest: string; hasCode: boolean; resolvedSource?: string };
}
export async function installProviderPackage(source: string, digest: string, trustedCode: boolean, registry = 'npm') {
  const inspection = await inspectProviderPackage(source, registry);
  if (inspection.digest !== digest) throw new Error('Package changed since inspection');
  apply(await desktopApi.providerPlugins.manage('install', { source, digest, trustedCode, registry }));
}
export async function mutateProviderPlugin(operation: 'enable' | 'remove' | 'rollback', args: Record<string, unknown>) {
  apply(await desktopApi.providerPlugins.manage(operation, args));
}
export async function configureProviderPlugins(patch: Partial<Pick<ProviderPluginSnapshot, 'connections' | 'registryUrl' | 'disabledBuiltins'>>) {
  const next = { ...structuredClone(providerPluginSnapshot()), ...patch };
  const connectionIds = new Set<string>();
  for (const connection of next.connections) {
    if ((!/^connection\.[a-z0-9._-]+$/.test(connection.id) && !providerPluginSnapshot().connections.some(item => item.id === connection.id)) || connectionIds.has(connection.id) || !connection.name.trim()) throw new Error('Invalid or duplicate connection identity');
    connectionIds.add(connection.id);
    const plugin = allProviderPlugins().find(plugin => plugin.manifest.id === connection.pluginId);
    const manifest = plugin?.manifest;
    if (manifest?.kind === 'vendor') {
      for (const model of connection.models || []) {
        if (model.protocolPlugin && model.protocolPlugin !== manifest.id) throw new Error('Models must use their vendor plugin');
        if (!Object.keys(model.protocolModes || {}).length || Object.values(model.protocolModes || {}).some(operation => !manifest.protocols.some(item => item.id === operation))) throw new Error('Unknown internal model operation');
      }
    } else if (manifest?.kind === 'protocol') {
      for (const model of connection.models || []) {
        const bound = allProviderPlugins().find(item => item.manifest.id === (model.protocolPlugin || connection.pluginId))?.manifest;
        if (!bound || bound.kind !== 'protocol' || bound.category !== model.type) throw new Error('Model references an incompatible protocol plugin');
        for (const operation of Object.values(model.protocolModes || {})) if (!bound.protocols.some(item => item.id === operation)) throw new Error(`Unknown protocol operation: ${operation}`);
        if (!Object.keys(model.protocolModes || {}).length) throw new Error('Model must select a protocol operation');
        if (model.upstreamModel !== undefined && !model.upstreamModel.trim()) throw new Error('Enter the upstream model id');
        const expanded = expandProviderModels({ id: connection.id, name: connection.name, baseUrl: connection.baseUrl || '', models: [model], preserveModelIds: true, presetId: 'protocol', plugin: { id: bound.id, version: bound.version, providerId: 'protocol' } }, bound);
        const errors = expanded.flatMap(item => catalogModelValidationErrors(item, { requireProvider: true }));
        if (errors.length) throw new Error(errors.join('\n'));
      }
    } else if (!manifest?.providers.some(provider => provider.id === connection.presetId)) throw new Error('Connection references an unknown provider preset');
  }
  validateRegistry(next);
  apply(await desktopApi.providerPlugins.manage('configure', next));
}
export async function setProviderPluginEnabled(id: string, enabled: boolean) {
  return mutateProviderPlugin('enable', { id, enabled });
}
export async function saveProviderConnection(connection: ProviderConnection) {
  const connections = providerPluginSnapshot().connections.filter(item => item.id !== connection.id);
  connections.push(connection); await configureProviderPlugins({ connections });
}
export async function pluginUpdateIndex(url: string) {
  const index = await desktopApi.providerPlugins.manage('index', { url });
  if (index?.apiVersion !== 1 || !Array.isArray(index.plugins)) throw new Error('Invalid plugin index');
  for (const plugin of index.plugins) {
    if (!plugin || typeof plugin.id !== 'string' || typeof plugin.version !== 'string' || !/^[a-f0-9]{64}$/.test(plugin.sha256) || typeof plugin.url !== 'string') throw new Error('Invalid plugin index entry');
  }
  return index as { apiVersion: 1; plugins: Array<{ id: string; name: string; version: string; url: string; sha256: string; description?: string }> };
}

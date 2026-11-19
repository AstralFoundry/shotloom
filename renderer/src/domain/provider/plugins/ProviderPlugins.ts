import { localizePluginMetadata, pluginI18nErrors, type PluginI18n } from '../../../../../shared/pluginI18n';
import { pluginIconPath, pluginIconSource } from '../../../../../shared/pluginIcon';
import { vendorMigrationErrors, type VendorMigration } from '../../../../../shared/vendorPluginMigration';
import { setPluginToolbarTools, type NodeToolbarScope, type NodeToolDefinition } from '../../../utils/canvasNodeToolbar';
import { pluginCapabilityErrors, type PluginCapability } from '../../../../../shared/pluginCapabilities';
import { satisfies, valid, validRange } from 'semver';
import appPackage from '../../../../../package.json';
import { catalogLabel, getLocale } from '../../../i18n/index.ts';
import type { CatalogMode, CatalogModel } from '../../catalog/ModelCatalog';

export interface PluginReference { id: string; version: string; providerId: string; }
export interface PluginModel extends Omit<CatalogModel, 'provider' | 'modes'> {
  provider?: string;
  modes?: CatalogMode[];
  protocol?: string;
  protocolPlugin?: string;
  protocolModes?: Record<string, string>;
}
export interface ProviderPreset {
  id: string;
  name: string;
  description?: string;
  nameKey?: string;
  descriptionKey?: string;
  iconId?: string;
  baseUrl: string;
  baseUrlRequired?: boolean;
  authRequired?: boolean;
  engine?: 'declarative' | 'module';
  supportsCancel?: boolean;
  models: PluginModel[];
}
export interface ProviderPluginManifest {
  i18n?: PluginI18n;
  nameKey?: string;
  descriptionKey?: string;
  apiVersion: 1 | 2;
  capabilities?: PluginCapability[];
  kind?: 'vendor' | 'protocol';
  vendorMigration?: VendorMigration;
  category?: string;
  iconId?: string;
  /** Relative path to a bundled raster icon, at most 64 KiB. */
  icon?: string;
  /** Derived by the package loader for display; never a remote URL. */
  iconData?: string;
  engine?: 'declarative' | 'module';
  supportsCancel?: boolean;
  id: string;
  name: string;
  version: string;
  shotloom: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Packaged README, rendered as text/Markdown without executing HTML. */
  readme?: string;
  license?: string;
  /** Code plugins are self-contained ES modules, executed only after explicit trust. */
  runtime?: { entry: string };
  protocols: Array<{ id: string; description?: string; mode: CatalogMode }>;
  providers: ProviderPreset[];
  /** Optional connection/model presets, installed once with the package. */
  defaultConnections?: ProviderConnection[];
  /** Historical adapter identities for saved contracts; never active catalog entries. */
  legacyProviders?: Array<{ pluginId: string; version: string; provider: ProviderPreset }>;
}
export interface InstalledProviderPlugin {
  manifest: ProviderPluginManifest;
  enabled: boolean;
  removed?: boolean;
  retired?: boolean;
  digest: string;
  source: string;
  trustedCode: boolean;
  installedAt: string;
  /** Previous versions remain installed for in-flight tasks and rollback. */
  history: Array<{ manifest: ProviderPluginManifest; digest: string; trustedCode: boolean; source?: string }>;
}
export interface ProviderConnection {
  description?: string;
  descriptionKey?: string;
  id: string;
  name: string;
  pluginId: string;
  presetId: string;
  /** Optional custom models; omit to inherit the preset's model list. */
  models?: PluginModel[];
  enabled?: boolean;
  preserveModelIds?: boolean;
  sortOrder?: number;
  baseUrl?: string;
  iconId?: string;
  authRequired?: boolean;
}
export interface ProviderPluginSnapshot {
  plugins: InstalledProviderPlugin[];
  /** Read only during migration from the former built-in registry. */
  disabledBuiltins?: string[];
  connections: ProviderConnection[];
  registryUrl: string;
  legacyConnections?: ProviderConnection[];
}
export interface RegisteredProvider extends ProviderPreset {
  plugin: PluginReference;
  presetId: string;
  preserveModelIds?: boolean;
}

export function providerConnections(): ProviderConnection[] { return snapshot.connections; }

/** Seed only newly installed packages. Existing connection values and models win. */
export function provisionPluginConnections(state: ProviderPluginSnapshot, manifest: ProviderPluginManifest) {
  for (const seed of manifest.defaultConnections || []) {
    const existing = state.connections.find(connection => connection.id === seed.id);
    if (!existing) state.connections.push(structuredClone(seed));
    else {
      const models = existing.models ||= [];
      for (const model of seed.models || []) if (!models.some(item => item.id === model.id)) models.push(structuredClone(model));
    }
  }
  state.connections.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

let snapshot: ProviderPluginSnapshot = { plugins: [], disabledBuiltins: [], connections: [], registryUrl: '' };
let revision = 0;
export const providerPluginRevision = () => revision;
export const providerPluginSnapshot = () => snapshot;
export function setProviderPluginSnapshot(next: ProviderPluginSnapshot) {
  snapshot = structuredClone(next);
  const tools: Partial<Record<NodeToolbarScope, NodeToolDefinition[]>> = {};
  for (const plugin of allProviderPlugins().filter(p => p.enabled && !p.removed && !p.retired)) for (const capability of plugin.manifest.capabilities || []) {
    if (!capability.surfaces.includes('toolbar')) continue;
    for (const scope of new Set(capability.inputs.map(slot => slot.type))) {
      if (scope !== 'image' && scope !== 'video' && scope !== 'audio') continue;
      (tools[scope] ||= []).push({ id: `plugin:${plugin.manifest.id}:${capability.id}`, label: `${capability.name} · ${plugin.manifest.name}`, icon: 'blocks', interaction: 'opens_dialog' });
    }
  }
  setPluginToolbarTools(tools);
  revision++;
}
const localizedManifests = new WeakMap<ProviderPluginManifest, { locale: string; manifest: ProviderPluginManifest }>();
export function localizeProviderPluginManifest(manifest: ProviderPluginManifest): ProviderPluginManifest {
  const locale = getLocale();
  const cached = localizedManifests.get(manifest);
  if (cached?.locale === locale) return cached.manifest;
  const localized = localizePluginMetadata(manifest, manifest.i18n, locale);
  localizedManifests.set(manifest, { locale, manifest: localized });
  return localized;
}
export function allProviderPlugins() { return snapshot.plugins.map(plugin => ({ ...plugin, manifest: localizeProviderPluginManifest(plugin.manifest) })); }
export function pluginManifestAt(ref: PluginReference): ProviderPluginManifest | undefined {
  const installed = snapshot.plugins.find(plugin => plugin.manifest.id === ref.id);
  const manifest = [installed?.manifest, ...(installed?.history || []).map(item => item.manifest)]
    .find(manifest => manifest?.version === ref.version);
  return manifest && localizeProviderPluginManifest(manifest);
}

function legacyProviderAt(ref: PluginReference): RegisteredProvider | undefined {
  const aliases = snapshot.plugins.flatMap(plugin => [plugin.manifest, ...plugin.history.map(item => item.manifest)])
    .flatMap(manifest => manifest.legacyProviders || []);
  const alias = aliases.find(item => item.pluginId === ref.id && item.version === ref.version && item.provider.id === ref.providerId);
  return alias && { ...alias.provider, plugin: ref, presetId: alias.provider.id };
}

function presets(manifest: ProviderPluginManifest): RegisteredProvider[] {
  return manifest.providers.map(preset => ({ ...preset,
    name: catalogLabel(preset.name, preset.nameKey),
    description: catalogLabel(preset.description || '', preset.descriptionKey),
    plugin: { id: manifest.id, version: manifest.version, providerId: preset.id }, presetId: preset.id,
  }));
}
export function registeredProviders(): RegisteredProvider[] {
  const active = allProviderPlugins().filter(plugin => plugin.enabled && !plugin.removed && !plugin.retired);
  const oldPresets = active.filter(plugin => !plugin.manifest.kind).flatMap(plugin => presets(plugin.manifest));
  const connections = providerConnections().filter(connection => connection.enabled !== false).flatMap(rawConnection => {
    const owner = active.find(plugin => plugin.manifest.id === rawConnection.pluginId)?.manifest;
    const connection = localizePluginMetadata(rawConnection, owner?.i18n, getLocale());
    if (owner?.kind === 'vendor') return [{ id: connection.id, name: connection.name, baseUrl: connection.baseUrl || '',
      iconId: connection.iconId || owner.iconId || 'custom', description: connection.description || owner.description || '',
      authRequired: connection.authRequired, baseUrlRequired: connection.baseUrl === '', models: connection.models || [], presetId: 'vendor',
      preserveModelIds: connection.preserveModelIds === true, engine: owner.engine || 'declarative', supportsCancel: owner.supportsCancel,
      plugin: { id: owner.id, version: owner.version, providerId: 'vendor' },
    } as RegisteredProvider];
    // Older installed packages and saved custom connections remain readable.
    const legacy = oldPresets.find(provider => provider.plugin.id === connection.pluginId && provider.id === connection.presetId)
      || legacyProviderAt({ id: connection.pluginId, version: '1.0.0', providerId: connection.presetId });
    if (legacy) {
      const models = connection.models ?? providerConnections().find(item => item.id === legacy.id)?.models ?? legacy.models;
      return [{ ...legacy, id: connection.id, name: connection.name, models }];
    }
    const fallback = active.find(plugin => plugin.manifest.id === connection.pluginId)?.manifest;
    const models = (connection.models || []).filter(model => active.some(plugin => plugin.manifest.id === (model.protocolPlugin || fallback?.id)));
    if (!models.length) return [];
    const manifest = active.find(plugin => plugin.manifest.id === (models[0]?.protocolPlugin || fallback?.id))!.manifest;
    return [{ id: connection.id, name: connection.name, baseUrl: connection.baseUrl || '', iconId: connection.iconId || manifest.iconId || 'custom',
      description: catalogLabel(connection.description || '', connection.descriptionKey), baseUrlRequired: connection.baseUrl === '', authRequired: connection.authRequired, models: models.map(model => ({ ...model, protocolPlugin: model.protocolPlugin || manifest.id })),
      presetId: 'protocol', preserveModelIds: connection.preserveModelIds === true,
      plugin: { id: manifest.id, version: manifest.version, providerId: 'protocol' }, engine: manifest.engine || 'declarative',
    } as RegisteredProvider];
  });
  return [...oldPresets, ...connections];
}
export function resolvePluginProvider(ref: PluginReference): RegisteredProvider | undefined {
  const manifest = pluginManifestAt(ref);
  if (manifest?.kind === 'vendor' && ['vendor', 'tools'].includes(ref.providerId)) return {
    id: ref.providerId, presetId: ref.providerId, name: manifest.name, description: manifest.description || '',
    iconId: manifest.iconId || 'custom', baseUrl: '', models: [],
    engine: ref.providerId === 'tools' ? 'module' : manifest.engine || 'declarative', supportsCancel: manifest.supportsCancel, plugin: ref,
  } as RegisteredProvider;
  if (manifest?.kind === 'protocol' && ref.providerId === 'protocol') return {
    id: 'protocol', presetId: 'protocol', name: manifest.name, description: manifest.description || '', iconId: manifest.iconId || 'custom',
    baseUrl: '', models: [], engine: manifest.engine || 'declarative', supportsCancel: manifest.supportsCancel, plugin: ref,
  } as RegisteredProvider;
  return (manifest && presets(manifest).find(provider => provider.id === ref.providerId)) || legacyProviderAt(ref);
}
export function expandProviderModels(provider: RegisteredProvider, manifest: ProviderPluginManifest): CatalogModel[] {
  return provider.models.map(rawModel => {
    const model = localizePluginMetadata(rawModel, manifest.i18n, getLocale());
    if (model.protocolPlugin || (manifest.kind === 'vendor' && model.protocolModes)) {
      const protocolManifest = manifest.kind === 'vendor' ? manifest : allProviderPlugins().find(plugin => plugin.manifest.id === model.protocolPlugin)?.manifest;
      if (!protocolManifest || !['protocol', 'vendor'].includes(protocolManifest.kind || '')) throw new Error(`Missing protocol plugin: ${model.protocolPlugin}`);
      const modes = Object.entries(model.protocolModes || {}).map(([id, operation]) => {
        const wire = protocolManifest.protocols.find(protocol => protocol.id === operation)?.mode;
        if (!wire) throw new Error(`Unknown protocol operation: ${operation}`);
        const capability = model.modes?.find(mode => mode.id === id) || {};
        // Connections may override model capabilities; transport contracts stay inside the owning package.
        const allowed = ['label','labelKey','inputConstraints','outputConstraints','params','inputMode','inputSlots','inputVariants','capabilities'];
        return { ...wire, ...Object.fromEntries(Object.entries(capability).filter(([key]) => allowed.includes(key))), id } as CatalogMode;
      });
      return { ...model, id: provider.preserveModelIds ? model.id : `${provider.id}::${model.id}`, provider: provider.id,
        upstreamModel: model.upstreamModel || model.id, modes,
        pluginRef: { id: protocolManifest.id, version: protocolManifest.version, providerId: protocolManifest.kind === 'vendor' ? 'vendor' : 'protocol' },
      } as CatalogModel;
    }
    const protocol = model.protocol ? manifest.protocols.find(item => item.id === model.protocol) : undefined;
    const isConnection = provider.id !== provider.presetId;
    return { ...model,
      id: isConnection ? `${provider.id}::${model.id}` : model.id,
      upstreamModel: model.upstreamModel || model.id,
      provider: provider.id,
      modes: model.modes || (protocol ? [protocol.mode] : []),
    } as CatalogModel;
  });
}
export function registeredModels(): CatalogModel[] {
  return registeredProviders().flatMap(provider => {
    const manifest = pluginManifestAt(provider.plugin) || { protocols: [] } as unknown as ProviderPluginManifest;
    return expandProviderModels(provider, manifest);
  });
}

const safeId = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value);
export function providerManifestErrors(value: unknown, appVersion = appPackage.version): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Plugin manifest must be an object'];
  const m = value as ProviderPluginManifest;
  const errors: string[] = [];
  if (m.icon !== undefined && !pluginIconPath(m.icon)) errors.push('Plugin icon must be a relative raster asset path');
  if (m.iconData !== undefined && !pluginIconSource(m.iconData)) errors.push('Invalid resolved plugin icon');
  errors.push(...pluginI18nErrors(m), ...pluginCapabilityErrors(m), ...vendorMigrationErrors(m));
  for (const key of ['description', 'author', 'homepage', 'license', 'readme'] as const) {
    if (m[key] !== undefined && typeof m[key] !== 'string') errors.push(`${key} must be a string`);
  }
  if (typeof m.readme === 'string' && new TextEncoder().encode(m.readme).length > 512 * 1024) errors.push('Plugin README exceeds 512 KiB');
  if (!safeId(m.id)) errors.push('Invalid plugin id');
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('Missing plugin name');
  if (!valid(m.version)) errors.push('Invalid semantic version');
  if (typeof m.shotloom !== 'string' || !validRange(m.shotloom.replace(/,/g, ' '))) errors.push('Invalid Shotloom compatibility range');
  else if (!satisfies(appVersion, m.shotloom.replace(/,/g, ' '), { includePrerelease: true })) errors.push('Plugin is incompatible with this Shotloom version');
  if (!Array.isArray(m.protocols)) errors.push('protocols must be an array');
  if (!Array.isArray(m.providers) || (!m.kind && !m.providers.length)) return [...errors, 'providers must be a non-empty array'];
  if (m.runtime && (!/^runtime\/[a-zA-Z0-9_./-]+\.mjs$/.test(m.runtime.entry || '') || m.runtime.entry.split('/').includes('..'))) errors.push('Runtime entry must be an ES module inside runtime/');
  const protocolIds = new Set<string>();
  for (const protocol of Array.isArray(m.protocols) ? m.protocols : []) {
    if (!protocol || !safeId(protocol.id) || protocolIds.has(protocol.id) || !protocol.mode || typeof protocol.mode !== 'object') errors.push('Invalid or duplicate protocol');
    else protocolIds.add(protocol.id);
  }
  if (m.kind && !['vendor', 'protocol'].includes(m.kind)) errors.push('Unsupported plugin kind');
  if (m.kind === 'vendor') {
    if (m.providers.length) errors.push('Vendor models belong in defaultConnections');
    if (!m.defaultConnections?.length) errors.push('Vendor plugin requires a default connection');
    for (const connection of m.defaultConnections || []) {
      if (connection.pluginId !== m.id || connection.presetId !== 'vendor') errors.push('Vendor connection must belong to its package');
      for (const model of connection.models || []) {
        if (!Object.keys(model.protocolModes || {}).length) errors.push('Vendor model requires internal operations');
        for (const operation of Object.values(model.protocolModes || {})) if (!protocolIds.has(operation)) errors.push(`Unknown internal operation: ${operation}`);
      }
    }
    if (m.engine && !['declarative', 'module'].includes(m.engine)) errors.push('Unsupported vendor engine');
    if ((m.engine === 'module' || m.capabilities?.length) && !m.runtime) errors.push('Vendor code capabilities require runtime');
  }
  if (m.kind === 'protocol') {
    if (!['textGeneration','imageGeneration','videoGeneration','audioGeneration'].includes(m.category || '')) errors.push('Protocol plugin requires a media category');
    if (!m.protocols?.length) errors.push('Protocol plugin must declare operations');
    if (m.providers.length) errors.push('Protocol plugins do not contain provider configurations');
    if (m.engine && !['declarative','module'].includes(m.engine)) errors.push('Unsupported protocol engine');
    if (m.engine === 'module' && !m.runtime) errors.push('Module protocol requires runtime');
  }
  if (m.legacyProviders !== undefined && !Array.isArray(m.legacyProviders)) errors.push('legacyProviders must be an array');
  for (const alias of Array.isArray(m.legacyProviders) ? m.legacyProviders : []) {
    if (!alias || !safeId(alias.pluginId) || !valid(alias.version) || !safeId(alias.provider?.id) || typeof alias.provider?.name !== 'string') errors.push('Invalid historical provider identity');
  }
  if (m.defaultConnections !== undefined && !Array.isArray(m.defaultConnections)) errors.push('defaultConnections must be an array');
  for (const connection of Array.isArray(m.defaultConnections) ? m.defaultConnections : []) {
    if (!safeId(connection.id) || !connection.name?.trim() || !Array.isArray(connection.models)) errors.push('Invalid default connection');
    for (const model of connection.models || []) if ((m.kind === 'vendor' && model.protocolPlugin && model.protocolPlugin !== m.id) || (m.kind !== 'vendor' && model.protocolPlugin !== m.id)) errors.push('Default models must reference their own package');
  }
  const ids = new Set<string>();
  for (const p of m.providers) {
    if (!p || typeof p !== 'object') { errors.push('Invalid provider'); continue; }
    if (!safeId(p.id) || ids.has(p.id)) errors.push(`Invalid or duplicate provider id: ${p.id}`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`Missing provider name: ${p.id}`);
    if (typeof p.baseUrl !== 'string' || (p.baseUrl && !/^https?:\/\//.test(p.baseUrl))) errors.push(`Invalid base URL: ${p.id}`);
    if (p.engine && !['declarative', 'module'].includes(p.engine)) errors.push(`Unsupported engine: ${p.engine}`);
    if (p.engine === 'module' && !m.runtime) errors.push(`Missing runtime for ${p.id}`);
    if (!Array.isArray(p.models)) errors.push(`models must be an array: ${p.id}`);
    else for (const model of p.models) {
      if (!model || typeof model !== 'object') { errors.push(`Invalid model in ${p.id}`); continue; }
      if (model.protocol && !m.protocols?.some(protocol => protocol.id === model.protocol)) errors.push(`Unknown protocol: ${model.protocol}`);
    }
  }
  return errors;
}

/** Bind explicit protocol operations to a model while keeping its capabilities in the connection. */
export function bindProtocolModel(manifest: ProviderPluginManifest, operations: string[], source?: PluginModel): PluginModel {
  if (manifest.kind !== 'protocol') throw new Error('Select a protocol plugin');
  const modes: CatalogMode[] = [];
  const protocolModes: Record<string, string> = {};
  for (const operation of operations) {
    const definition = manifest.protocols.find(item => item.id === operation);
    if (!definition) throw new Error(`Unknown protocol operation: ${operation}`);
    const previousId = Object.entries(source?.protocolModes || {}).find(([, value]) => value === operation)?.[0];
    const initial = previousId || definition.mode.id;
    const id = protocolModes[initial] ? `${initial}-${modes.length + 1}` : initial;
    const previous = source?.protocolPlugin === manifest.id ? source.modes?.find(mode => mode.id === id) : undefined;
    const defaults = previous || definition.mode;
    const capabilityKeys = ['label', 'labelKey', 'inputConstraints', 'outputConstraints', 'params', 'inputMode', 'inputSlots', 'inputVariants', 'capabilities'];
    modes.push({ ...Object.fromEntries(Object.entries(defaults).filter(([key]) => capabilityKeys.includes(key))), id } as CatalogMode);
    protocolModes[id] = operation;
  }
  return { id: source?.id || `model.${crypto.randomUUID()}`, name: source?.name || '', upstreamModel: source?.upstreamModel || '',
    sortOrder: 1, enabled: true, ...source, type: manifest.category!, protocolPlugin: manifest.id, protocolModes, modes,
    defaultMode: modes.some(mode => mode.id === source?.defaultMode) ? source!.defaultMode : modes[0]?.id || '',
  };
}

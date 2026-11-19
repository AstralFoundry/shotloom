/** Package-declared upgrade mappings. No vendor names or transport rules live in the host. */
export interface VendorMigration {
  bindings: Array<{ pluginId: string; operations: Record<string, string> }>;
  mergeConnections?: Array<{ from: string; into: string }>;
}
type Model = { id: string; enabled?: boolean; protocolPlugin?: string; protocolModes?: Record<string, string> };
type Connection = { id: string; name: string; pluginId: string; presetId: string; models?: Model[]; baseUrl?: string; enabled?: boolean };
type Plugin = { manifest: { id: string; kind?: string; vendorMigration?: VendorMigration; capabilities?: Array<{ id: string; operation: string }>; defaultConnections?: Connection[] }; source?: string; enabled: boolean; removed?: boolean; retired?: boolean };
export type VendorMigrationState = { plugins: Plugin[]; connections: Connection[]; legacyConnections?: Connection[] };
export type VendorMigrationSettings = { canvasToolbarCustomization?: { pinned?: Record<string, string[]> }; providerConfigs?: Record<string, { apiKey?: string; baseUrl?: string }> };

/** Mutates once, retaining old identities for pinned tasks and every credential for recovery. */
export function migrateVendorPlugins(state: VendorMigrationState, settings: VendorMigrationSettings = {}): boolean {
  let changed = false;
  const remember = (connection: Connection) => {
    const history = state.legacyConnections ||= [];
    if (!history.some(item => item.id === connection.id && item.pluginId === connection.pluginId)) history.push(structuredClone(connection));
  };
  for (const plugin of state.plugins) {
    const { manifest } = plugin;
    if (manifest.kind !== 'vendor' || !manifest.vendorMigration || !plugin.source?.startsWith('distribution:')) continue;
    const { bindings, mergeConnections = [] } = manifest.vendorMigration;
    const pinned = settings.canvasToolbarCustomization?.pinned;
    if (pinned) for (const [scope, ids] of Object.entries(pinned)) {
      const next = ids.map(id => {
        for (const capability of manifest.capabilities || []) for (const binding of bindings) {
          if (Object.values(binding.operations).includes(capability.operation) && id === `plugin:${binding.pluginId}:${capability.id}`) return `plugin:${manifest.id}:${capability.id}`;
        }
        return id;
      });
      if (next.some((id, index) => id !== ids[index])) { pinned[scope] = [...new Set(next)]; changed = true; }
    }
    for (const connection of [...state.connections]) {
      if (connection.pluginId === manifest.id || mergeConnections.some(item => item.from === connection.id)) continue;
      const owner = state.plugins.find(item => item.manifest.kind === 'vendor' && item.manifest.defaultConnections?.some(seed => seed.id === connection.id));
      if (owner && owner.manifest.id !== manifest.id) continue;
      const seed = manifest.defaultConnections?.find(item => item.id === connection.id);
      const sources = connection.models?.map(model => model.protocolPlugin || connection.pluginId) || [];
      const binding = bindings.find(item => item.pluginId === connection.pluginId);
      // A named default identifies its vendor; custom connections migrate only when all
      // transports can be owned by this package. Mixed third-party connections stay intact.
      if (!seed && !(binding && sources.every(id => bindings.some(item => item.pluginId === id)))) continue;
      if (!binding) continue;
      const models = structuredClone(connection.models || []);
      let compatible = true;
      for (const model of models) {
        const wire = bindings.find(item => item.pluginId === (model.protocolPlugin || connection.pluginId));
        const oldPlugin = state.plugins.find(item => item.manifest.id === (model.protocolPlugin || connection.pluginId));
        if (oldPlugin && (!oldPlugin.enabled || oldPlugin.removed) && !oldPlugin.retired) model.enabled = false;
        const preset = seed?.models?.find(item => item.id === model.id);
        if (wire && model.protocolModes) {
          const modes = Object.entries(model.protocolModes);
          if (modes.some(([, id]) => !wire.operations[id])) { compatible = false; break; }
          model.protocolModes = Object.fromEntries(modes.map(([id, operation]) => [id, wire.operations[operation]!]));
          delete model.protocolPlugin;
        } else if (preset) {
          if (preset.protocolModes) model.protocolModes = structuredClone(preset.protocolModes);
          delete model.protocolPlugin;
        } else { compatible = false; break; }
      }
      if (!compatible) continue;
      remember(connection);
      connection.models = models;
      connection.pluginId = manifest.id;
      connection.presetId = 'vendor';
      changed = true;
    }
    for (const merge of mergeConnections) {
      const from = state.connections.find(item => item.id === merge.from);
      const into = state.connections.find(item => item.id === merge.into && item.pluginId === manifest.id);
      if (!from || !into || from.pluginId === manifest.id) continue;
      if (!bindings.some(binding => binding.pluginId === from.pluginId) || from.models?.length) continue;
      const configs = settings.providerConfigs ||= {};
      const source = configs[merge.from];
      const target = configs[merge.into];
      // Distinct credentials remain a separate connection within the same vendor plugin.
      const origin = (url: string | undefined) => { try { return url ? new URL(url).origin : ''; } catch { return url || ''; } };
      const sourceHost = origin(source?.baseUrl || from.baseUrl);
      const targetHost = origin(target?.baseUrl || into.baseUrl);
      if ((source?.apiKey && target?.apiKey && source.apiKey !== target.apiKey) || (sourceHost && targetHost && sourceHost !== targetHost) || from.enabled === false || into.enabled === false) {
        remember(from); from.pluginId = manifest.id; from.presetId = 'vendor'; changed = true;
        continue;
      }
      remember(from);
      if (source?.apiKey && !target?.apiKey) configs[merge.into] = { ...target, apiKey: source.apiKey, baseUrl: target?.baseUrl || into.baseUrl || source.baseUrl || '' };
      state.connections.splice(state.connections.indexOf(from), 1);
      changed = true;
    }
  }
  // Installed old packages remain on disk for pinned tasks, outside the active catalog.
  const sources = new Set(state.plugins.filter(p => p.manifest.kind === 'vendor' && p.source?.startsWith('distribution:')).flatMap(p => p.manifest.vendorMigration?.bindings.map(b => b.pluginId) || []));
  for (const plugin of state.plugins) {
    if (!sources.has(plugin.manifest.id) || state.connections.some(c => c.pluginId === plugin.manifest.id || c.models?.some(m => m.protocolPlugin === plugin.manifest.id))) continue;
    if (!plugin.retired) { plugin.retired = true; plugin.enabled = false; changed = true; }
  }
  return changed;
}

/** Respect an existing user's removals and deleted default connections on consolidation. */
export function vendorInstallState(state: VendorMigrationState, manifest: Plugin['manifest']) {
  const previous = state.plugins.filter(plugin => manifest.vendorMigration?.bindings.some(binding => binding.pluginId === plugin.manifest.id));
  return {
    enabled: !previous.length || previous.some(plugin => plugin.enabled && !plugin.removed),
    removed: previous.length > 0 && previous.every(plugin => plugin.removed),
    connections: (manifest.defaultConnections || []).filter(seed => !previous.some(plugin => plugin.manifest.defaultConnections?.some(connection => connection.id === seed.id)) || state.connections.some(connection => connection.id === seed.id)),
  };
}

export function vendorMigrationErrors(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const manifest = input as { id?: unknown; vendorMigration?: unknown; protocols?: unknown };
  if (manifest.vendorMigration === undefined) return [];
  const value = manifest.vendorMigration as VendorMigration;
  const safe = (id: unknown) => typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(id);
  if (!value || typeof value !== 'object' || !Array.isArray(value.bindings)) return ['Invalid vendor migration bindings'];
  const ids = new Set<string>();
  const operations = Array.isArray(manifest.protocols) ? manifest.protocols as Array<{ id: string }> : [];
  for (const binding of value.bindings) {
    if (!binding || !safe(binding.pluginId) || binding.pluginId === manifest.id || ids.has(binding.pluginId)
      || !binding.operations || typeof binding.operations !== 'object' || Array.isArray(binding.operations)
      || Object.entries(binding.operations).some(([from, into]) => !safe(from) || !operations.some(operation => operation.id === into))) return ['Invalid vendor migration binding'];
    ids.add(binding.pluginId);
  }
  if (value.mergeConnections !== undefined && (!Array.isArray(value.mergeConnections) || value.mergeConnections.some(item => !item || !safe(item.from) || !safe(item.into) || item.from === item.into))) return ['Invalid vendor connection merge'];
  return [];
}

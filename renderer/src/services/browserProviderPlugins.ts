import { withNpmPluginIcons } from '../../../shared/npmPluginIcons';
import { packagedPluginIcon } from '../../../shared/pluginIcon';
import { migrateVendorPlugins, vendorInstallState } from '../../../shared/vendorPluginMigration';
import { unzipSync, strFromU8 } from 'fflate';
import { npmSearchUrl } from './npmPluginMarketplace';
import { providerManifestErrors, provisionPluginConnections } from '../domain/provider/plugins/ProviderPlugins';
import type { ProviderPluginSnapshot } from '../domain/provider/plugins/ProviderPlugins';

/** Browser preview supports declarative packages only; executable plugins require the native host. */
export function createBrowserProviderPlugins({ loadDistribution = async () => {
  const response = await fetch(new URL('provider-plugins/index.json', document.baseURI));
  if (!response.ok) throw new Error('Default plugin distribution is unavailable');
  const index = await response.json();
  if (index.apiVersion !== 1 || !Array.isArray(index.plugins)) throw new Error('Invalid default plugin distribution');
  return Promise.all(index.plugins.map(async (entry: any) => {
    if (!/^[a-z0-9._-]+\.shotloom-plugin$/.test(entry.file)) throw new Error('Invalid default plugin path');
    const response = await fetch(new URL(`provider-plugins/${entry.file}`, document.baseURI));
    if (!response.ok) throw new Error('Default plugin download failed');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== entry.sha256) throw new Error('Default plugin digest mismatch');
    const files = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    if (manifest.id !== entry.id || manifest.version !== entry.version) throw new Error('Default plugin identity mismatch');
    if (manifest.icon !== undefined) manifest.iconData = packagedPluginIcon(manifest.icon, files[manifest.icon]);
    if (files['README.md']) manifest.readme = strFromU8(files['README.md']);
    return { manifest, digest, files };
  }));
} }: { loadDistribution?: () => Promise<Array<{ manifest: any; digest: string; files: Record<string, Uint8Array> }>> } = {}) {
  const key = 'shotloom-provider-plugins';
  const read = (): ProviderPluginSnapshot => JSON.parse(localStorage.getItem(key) || 'null') || { plugins: [], disabledBuiltins: [], connections: [], registryUrl: '' };
  const write = (state: ProviderPluginSnapshot) => { localStorage.setItem(key, JSON.stringify(state)); return state; };
  const artifactFiles = new Map<string, Record<string, Uint8Array>>();
  let provisioning: Promise<ProviderPluginSnapshot> | undefined;
  async function installed() {
    if (!provisioning) provisioning = (async () => {
      const packages = await loadDistribution();
      const state = read();
      const protectedConnections = structuredClone(state.connections);
      for (const item of packages) {
        const errors = providerManifestErrors(item.manifest);
        if (errors.length) throw new Error(errors.join('\n'));
        artifactFiles.set(`${item.manifest.id}@${item.digest}`, item.files);
        if (state.plugins.some(plugin => plugin.manifest.id === item.manifest.id)) continue;
        const prior = vendorInstallState(state, item.manifest);
        state.plugins.push({ manifest: item.manifest, digest: item.digest, source: `distribution:${item.manifest.id}@${item.manifest.version}`, enabled: prior.enabled && !state.disabledBuiltins?.includes(item.manifest.id), removed: prior.removed, trustedCode: false, installedAt: new Date().toISOString(), history: [] });
        provisionPluginConnections(state, item.manifest.kind === 'vendor' ? { ...item.manifest, defaultConnections: prior.connections } : item.manifest);
      }
      for (const connection of protectedConnections) state.connections[state.connections.findIndex(item => item.id === connection.id)] = connection;
      for (const connection of state.connections) if (state.disabledBuiltins?.includes(`builtin.${connection.id}`)) connection.enabled = false;
      delete state.disabledBuiltins;
      const settings = JSON.parse(localStorage.getItem('shotloom-settings') || 'null') || {};
      if (migrateVendorPlugins(state, settings)) localStorage.setItem('shotloom-settings', JSON.stringify(settings));
      return write(state);
    })().catch(error => { provisioning = undefined; throw error; });
    await provisioning;
    return read();
  }
  async function inspect(source: string) {
    if (source.startsWith('npm:')) throw new Error('npm plugin installation requires the Shotloom desktop app');
    const content = source.trim().startsWith('{') ? source : await (await fetch(source)).text();
    const manifest = JSON.parse(content);
    const errors = providerManifestErrors(manifest);
    if (errors.length) throw new Error(errors.join('\n'));
    if (manifest.runtime) throw new Error('Code plugins require the Shotloom desktop app');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { manifest, digest, hasCode: false };
  }
  return {
    onChanged: (_callback: () => void) => () => {},
    selectPackage: async () => null,
    cancel: async (_requestId: string) => {},
    call: async (_args: unknown) => { throw new Error('Code plugins require the Shotloom desktop app'); },
    manage: async (operation: string, args: any = {}): Promise<any> => {
      if (operation === 'search') {
        const response = await fetch(npmSearchUrl(args.query || '', args.registry || 'npm', args.offset || 0));
        if (!response.ok) throw new Error(`npm search failed: ${response.status}`);
        const base = new URL(npmSearchUrl('', args.registry || 'npm', 0)).origin;
        return withNpmPluginIcons(await response.json(), base, async (url, limit) => {
          const asset = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!asset.ok) throw new Error('Plugin metadata or icon unavailable');
          const bytes = new Uint8Array(await asset.arrayBuffer());
          if (bytes.length > limit) throw new Error('Plugin metadata or icon exceeds limit');
          return bytes;
        });
      }
      if (operation === 'list') return installed();
      if (operation === 'documentation') {
        await installed();
        if (!/^[a-zA-Z0-9_./-]+\.md$/.test(args.path) || args.path.split('/').some((part: string) => !part || part === '..')) throw new Error('Invalid Markdown path');
        const plugin = read().plugins.find(item => item.manifest.id === args.id);
        const file = plugin?.source.startsWith('distribution:') ? artifactFiles.get(`${args.id}@${plugin.digest}`)?.[args.path] : undefined;
        if (!file) throw new Error('Documentation is not available in browser preview');
        return { content: strFromU8(file) };
      }
      if (operation === 'inspect') return inspect(args.source);
      if (operation === 'index') return (await fetch(args.url)).json();
      const state = read();
      if (operation === 'install') {
        const checked = await inspect(args.source);
        if (checked.digest !== args.digest) throw new Error('Package changed since inspection');
        const existing = state.plugins.find(plugin => plugin.manifest.id === checked.manifest.id);
        if (existing && [existing, ...existing.history].some(old => old.manifest.version === checked.manifest.version && old.digest !== checked.digest)) throw new Error('Plugin versions are immutable');
        const history = (existing?.history || []).filter(old => old.manifest.version !== checked.manifest.version);
        if (existing && existing.digest !== checked.digest) history.push({ manifest: existing.manifest, digest: existing.digest, trustedCode: false, source: existing.source });
        state.plugins = state.plugins.filter(plugin => plugin.manifest.id !== checked.manifest.id);
        if (!existing) provisionPluginConnections(state, checked.manifest);
        state.plugins.push({ manifest: checked.manifest, digest: checked.digest, trustedCode: false, source: args.source, enabled: true, installedAt: new Date().toISOString(), history });
      } else if (operation === 'configure') {
        Object.assign(state, { connections: args.connections, registryUrl: args.registryUrl });
      } else {
        const plugin = state.plugins.find(plugin => plugin.manifest.id === args.id);
        if (!plugin) throw new Error('Plugin not installed');
        if (operation === 'rollback') {
          const previous = plugin.history.find(item => item.manifest.version === args.version);
          if (!previous) throw new Error('Version not installed');
          const current = { manifest: plugin.manifest, digest: plugin.digest, trustedCode: plugin.trustedCode, source: plugin.source };
          plugin.history = plugin.history.filter(item => item !== previous);
          plugin.history.push(current); Object.assign(plugin, previous, { enabled: true });
        } else if (operation === 'enable' || operation === 'remove') { plugin.enabled = operation === 'enable' && args.enabled; plugin.removed = operation === 'remove'; }
        else throw new Error('Unknown plugin operation');
      }
      return write(state);
    },
  };
}

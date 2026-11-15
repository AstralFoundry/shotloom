import { t } from '../../../i18n/index.ts';
import type { ProviderAdapter } from '../ProviderAdapter';
import { DeclarativeAdapter } from './declarative';
import { ModuleProviderAdapter } from '../plugins/ModuleProviderAdapter';
import { registeredProviders, resolvePluginProvider, providerConnections, providerPluginRevision, type PluginReference, type RegisteredProvider } from '../plugins/ProviderPlugins';

let cachedRevision = -1;
let adapters: ProviderAdapter[] = [];
function buildAdapter(provider: RegisteredProvider): ProviderAdapter {
  if (provider.engine === 'module') return new ModuleProviderAdapter(provider);
  return new DeclarativeAdapter({ ...provider, description: provider.description || '', iconId: provider.iconId || 'custom' });
}
export function getProviderAdapters(): readonly ProviderAdapter[] {
  if (cachedRevision !== providerPluginRevision()) {
    adapters = registeredProviders().map(buildAdapter); cachedRevision = providerPluginRevision();
  }
  return adapters;
}
export function findProviderAdapter(id: string): ProviderAdapter | undefined {
  return getProviderAdapters().find(adapter => adapter.id === id);
}
export function getProviderAdapter(id: string, pinned?: PluginReference): ProviderAdapter {
  if (pinned) {
    const provider = resolvePluginProvider(pinned);
    if (!provider) throw new Error(`Pinned provider plugin is not installed: ${pinned.id}@${pinned.version}`);
    const connection = pinned.providerId === 'protocol' ? providerConnections().find(item => item.id === id) : undefined;
    return buildAdapter({ ...provider, id, baseUrl: connection?.baseUrl || provider.baseUrl });
  }
  const adapter = findProviderAdapter(id);
  if (!adapter) throw new Error(t('errors.3a6d62bd16', { value0: id || t('errors.d9c32a4c3d') }));
  return adapter;
}
export function resolveProviderBaseUrl(adapter: ProviderAdapter, config: { baseUrl?: string } = {}): string {
  return (String(config.baseUrl || '').trim() || adapter.baseUrl.trim()).replace(/\/+$/, '');
}

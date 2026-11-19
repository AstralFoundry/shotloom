import { PluginMarketplace } from './PluginMarketplace';
import { ProviderPluginDetails } from './ProviderPluginDetails';
import { Button, Checkbox, Empty, Input, Modal, Select, Segmented, Switch } from 'antd';
import { useState, useSyncExternalStore } from 'react';
import { t, catalogLabel } from '@/i18n';
import { IconSymbol, type IconName } from '../components/IconSymbol';
import { ProviderBrandIcon } from '../components/ProviderBrandIcon';
import { SearchInput } from '../components/SearchInput';
import { desktopApi } from '../../services/desktopApi';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { showSuccessToast } from '../../store/notificationStore';
import { settingsStore, saveAppSettings } from '../../store/settingsStore';
import {
  allProviderPlugins, providerConnections, localizeProviderPluginManifest, type PluginModel, type ProviderConnection,
} from '../../domain/provider/plugins/ProviderPlugins';
import {
  providerPluginStore, inspectProviderPackage, installProviderPackage, mutateProviderPlugin,
  setProviderPluginEnabled, saveProviderConnection, loadProviderPlugins,
} from '../../store/providerPluginStore';

type Inspection = Awaited<ReturnType<typeof inspectProviderPackage>>;
const categories: Array<{ id: string; label: 'plugins.all' | 'plugins.text' | 'plugins.image' | 'plugins.video' | 'plugins.audio'; icon: IconName }> = [
  { id: 'all', label: 'plugins.all', icon: 'package' },
  { id: 'textGeneration', label: 'plugins.text', icon: 'chat' },
  { id: 'imageGeneration', label: 'plugins.image', icon: 'image' },
  { id: 'videoGeneration', label: 'plugins.video', icon: 'film' },
  { id: 'audioGeneration', label: 'plugins.audio', icon: 'waveform' },
];

export function ProviderPluginsPanel({ standalone = false }: { standalone?: boolean }) {
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const plugins = allProviderPlugins().filter(plugin => !plugin.removed && !plugin.retired);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [npmRegistry, setNpmRegistry] = useState('npm');
  const [status, setStatus] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [installOpen, setInstallOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [source, setSource] = useState('');
  const [installMethod, setInstallMethod] = useState('npm');
  const [selectedView, setSelectedView] = useState('details');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectedSource, setInspectedSource] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selected = plugins.find(plugin => plugin.manifest.id === selectedId);
  const connections = providerConnections();
  const linked = (pluginId: string) => connections.filter(connection => connection.models?.some(model => model.protocolPlugin === pluginId) || connection.pluginId === pluginId);
  const pluginTypes = (plugin: typeof plugins[number]) => new Set([...(plugin.manifest.kind === 'protocol' ? [plugin.manifest.category!] : [...plugin.manifest.providers.flatMap(provider => provider.models), ...(plugin.manifest.defaultConnections || []).flatMap(connection => connection.models || [])].map(model => model.type)), ...(plugin.manifest.capabilities || []).flatMap(capability => [...capability.inputs, ...capability.outputs].map(slot => `${slot.type}Generation`))]);
  const descriptionFor = (plugin: typeof plugins[number]) => plugin.manifest.description || (plugin.manifest.kind === 'protocol' ? t('plugins.protocolDescription') : plugin.manifest.providers.map(provider => catalogLabel(provider.description || provider.name, provider.descriptionKey)).join(' · '));
  const visible = plugins.filter(plugin => {
    const search = `${plugin.manifest.name} ${descriptionFor(plugin)} ${plugin.manifest.author || ''} ${(plugin.manifest.defaultConnections || []).flatMap(connection => connection.models || []).map(model => model.name).join(' ')} ${(plugin.manifest.capabilities || []).map(capability => capability.name).join(' ')} ${plugin.manifest.providers.map(provider => provider.name).join(' ')}`.toLocaleLowerCase();
    return (!query.trim() || search.includes(query.trim().toLocaleLowerCase()))
      && (category === 'all' || pluginTypes(plugin).has(category))
      && (status === 'all' || plugin.enabled === (status === 'enabled'))
      && (origin === 'all' || (plugin.source.startsWith('distribution:')) === (origin === 'bundled'));
  });
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function inspect(nextSource: string) {
    const result = await inspectProviderPackage(nextSource, npmRegistry);
    setInspection({ ...result, manifest: localizeProviderPluginManifest(result.manifest) }); setInspectedSource(result.resolvedSource || nextSource); setTrusted(false);
  }
  function openSettings(plugin: typeof plugins[number], view = 'settings') {
    setSelectedView(view);
    setSelectedId(plugin.manifest.id); setConfirmRemove(false); setError('');
    if (view === 'settings') editConnection(linked(plugin.manifest.id)[0], plugin);
    else setEditing(null);
  }
  function editConnection(connection?: ProviderConnection, plugin = selected) {
    if (!connection && !plugin) return;
    const next = structuredClone(connection || { name: plugin!.manifest.name, ...structuredClone(plugin!.manifest.defaultConnections?.[0] || {}), id: `connection.${crypto.randomUUID()}`, pluginId: plugin!.manifest.id, presetId: plugin!.manifest.kind === 'vendor' ? 'vendor' : 'protocol', preserveModelIds: false, enabled: true });
    next.models ??= structuredClone(plugin?.manifest.providers.find(provider => provider.id === next.presetId)?.models || []);
    setEditing(next);
    const config = settingsStore.providerConfigs[next.id];
    setApiKey(config?.apiKey || ''); setBaseUrl(config?.baseUrl || next.baseUrl || ''); setError('');
  }
  function updateModel(index: number, model: PluginModel) {
    if (!editing) return;
    setEditing({ ...editing, models: editing.models?.map((item, i) => i === index ? model : item) || [] });
  }
  const errorMessage = error || providerPluginStore.error;
  const errorNotice = errorMessage ? <p className="provider-plugin-error" role="alert">{errorMessage}</p> : null;
  return <section className={`provider-plugin-center${standalone ? ' provider-plugin-page' : ''}`}>
    {standalone && <header className="provider-plugin-heading"><h1>{t('plugins.title')}</h1><p>{t('plugins.description')}</p></header>}
    <nav className="provider-plugin-tabs" aria-label={t('plugins.categories')}>
      {categories.map(item => <Button key={item.id} type="text" className={category === item.id ? 'is-active' : ''} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
        <IconSymbol name={item.icon} /><span>{t(item.label)}</span><small>{plugins.filter(plugin => item.id === 'all' || pluginTypes(plugin).has(item.id)).length}</small>
      </Button>)}
      <Button type="text" className={category === 'market' ? 'is-active' : ''} aria-pressed={category === 'market'} onClick={() => setCategory('market')}><IconSymbol name="blocks" /><span>{t('plugins.marketplace')}</span></Button>
    </nav>
    {category === 'market' ? <PluginMarketplace registry={npmRegistry} onRegistryChange={setNpmRegistry} onInstall={nextSource => {
      setInstallMethod('npm'); setSource(nextSource.replace(/^npm:/, '')); setInspection(null); setInstallOpen(true); setError('');
      void run(() => inspect(nextSource));
    }} /> : <>
    <div className="provider-plugin-toolbar">
      <div className="provider-plugin-search"><SearchInput value={query} onChange={setQuery} placeholder={t('plugins.search')} /></div>
      <Select aria-label={t('plugins.statusFilter')} value={status} onChange={setStatus} options={[
        { value: 'all', label: t('plugins.allStatuses') }, { value: 'enabled', label: t('plugins.enabled') }, { value: 'disabled', label: t('plugins.disabled') },
      ]} />
      <Select aria-label={t('plugins.sourceFilter')} value={origin} onChange={setOrigin} options={[
        { value: 'all', label: t('plugins.allSources') }, { value: 'bundled', label: t('plugins.bundled') }, { value: 'installed', label: t('plugins.userInstalled') },
      ]} />
      <div className="provider-plugin-toolbar-actions">
        <Button type="primary" onClick={() => { setInstallOpen(true); setError(''); }}><IconSymbol name="plus" />{t('plugins.installTitle')}</Button>
        <Button disabled={busy} onClick={() => void run(loadProviderPlugins)} aria-label={t('plugins.refresh')} title={t('plugins.refresh')}><IconSymbol name="refresh" /></Button>
      </div>
    </div>
    {!installOpen && !selected && errorNotice}
    <div className="provider-plugin-results"><span>{t('plugins.resultCount', { count: visible.length })}</span></div>
    <div className="provider-plugin-grid">
      {visible.map(plugin => {
        const models = [...plugin.manifest.providers.flatMap(provider => provider.models), ...(plugin.manifest.defaultConnections || []).flatMap(connection => connection.models || [])];
        const types = pluginTypes(plugin);
        return <article className="provider-plugin-card" key={plugin.manifest.id} tabIndex={0}
          onDoubleClick={() => openSettings(plugin, 'details')}
          onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') openSettings(plugin, 'details'); }}>
          <div className="provider-plugin-card-heading">
            <div className="provider-plugin-card-icon"><ProviderBrandIcon src={plugin.manifest.iconData} icon={plugin.manifest.iconId || plugin.manifest.providers[0]?.iconId || 'custom'} /></div>
            <div><h2 title={plugin.manifest.name}>{plugin.manifest.name}</h2><span className="provider-plugin-version">v{plugin.manifest.version} · {plugin.source.startsWith('distribution:') ? t('plugins.bundled') : t('plugins.userInstalled')}</span></div>
          </div>
          <p className="provider-plugin-card-description">{descriptionFor(plugin)}</p>
          <div className="provider-plugin-capabilities">{categories.filter(item => types.has(item.id)).map(item => <span key={item.id}><IconSymbol name={item.icon} />{t(item.label)}</span>)}</div>
          <div className="provider-plugin-card-meta"><span>{t(plugin.manifest.kind === 'protocol' ? 'plugins.operationCount' : 'plugins.modelCount', { count: plugin.manifest.kind === 'protocol' ? plugin.manifest.protocols.length : models.length })}</span>{Boolean(plugin.manifest.capabilities?.length) && <span>{t('plugins.toolCount', { count: plugin.manifest.capabilities!.length })}</span>}</div>
          <footer className="provider-plugin-card-footer" onDoubleClick={event => event.stopPropagation()}>
            <span className={`provider-plugin-state${plugin.enabled ? ' is-enabled' : ''}`}><i />{t(plugin.enabled ? 'plugins.enabled' : 'plugins.disabled')}</span>
            <Switch size="small" checked={plugin.enabled} disabled={busy} aria-label={plugin.manifest.name} onChange={enabled => void run(async () => { await setProviderPluginEnabled(plugin.manifest.id, enabled); await saveAppSettings(); })} />
            <Button onClick={() => openSettings(plugin)}><IconSymbol name="sliders" />{t('plugins.settings')}</Button>
          </footer>
        </article>;
      })}
    </div>
    {!visible.length && <Empty description={t('plugins.noResults')} />}
    </>}


    <Modal title={t('plugins.installTitle')} open={installOpen} onCancel={() => { if (!busy) setInstallOpen(false); }} footer={null} centered width={760}>
      <div className="provider-plugin-dialog provider-plugin-install">
        <Segmented value={installMethod} onChange={value => { setInstallMethod(value); setSource(''); setInspection(null); }} options={[{ value: 'npm', label: t('plugins.npmPackage') }, { value: 'file', label: t('plugins.fileOrUrl') }]} />
        <p>{t(installMethod === 'npm' ? 'plugins.npmHint' : 'plugins.installHint')}</p>
        <label>{t(installMethod === 'npm' ? 'plugins.npmPackage' : 'plugins.packageAddress')}<Input value={source} onChange={event => { setSource(event.target.value); setInspection(null); }} placeholder={installMethod === 'npm' ? '@scope/shotloom-plugin-example@latest' : t('plugins.sourcePlaceholder')} /></label>
        <div className="provider-plugin-actions">{installMethod === 'file' && <Button disabled={busy} onClick={() => void run(async () => { const path = await desktopApi.providerPlugins.selectPackage(); if (path) { setSource(path); await inspect(path); } })}><IconSymbol name="folder" />{t('plugins.chooseFile')}</Button>}<Button disabled={busy || !source.trim()} loading={busy} onClick={() => void run(() => inspect(installMethod === 'npm' ? `npm:${source.trim().replace(/^npm:/, '')}` : source.trim()))}>{t('plugins.inspect')}</Button></div>
        {inspection && <div className="provider-plugin-inspection">
          <strong>{inspection.manifest.name} · v{inspection.manifest.version}</strong><small>{inspectedSource}</small><p>{inspection.manifest.description}</p>
          <span>{inspection.manifest.kind === 'protocol' ? inspection.manifest.protocols.map(operation => catalogLabel(operation.mode.label, operation.mode.labelKey)).join(' · ') : inspection.manifest.providers.map(provider => provider.name).join(' · ')}</span>
          {inspection.hasCode && <Checkbox checked={trusted} onChange={event => setTrusted(event.target.checked)}>{t('plugins.trustCode')}</Checkbox>}
          <Button type="primary" disabled={busy || (inspection.hasCode && !trusted)} onClick={() => void run(async () => {
            await installProviderPackage(inspectedSource, inspection.digest, trusted, npmRegistry); await saveAppSettings(); setInspection(null); setInstallOpen(false);
          })}>{t('plugins.confirmInstall')}</Button>
        </div>}
        {errorNotice}
      </div>
    </Modal>

    <Modal className="provider-plugin-settings-modal" centered title={selected ? <div className="provider-plugin-settings-title"><ProviderBrandIcon src={selected.manifest.iconData} icon={selected.manifest.iconId || selected.manifest.providers[0]?.iconId || 'custom'} /><span>{selected.manifest.name}<small>v{selected.manifest.version}</small></span></div> : t('plugins.settings')} open={Boolean(selected)} onCancel={() => { if (!busy) { setSelectedId(''); setEditing(null); } }} footer={selectedView === 'settings' && editing ? <div className="provider-plugin-settings-footer">{errorNotice}<Button disabled={busy} onClick={() => { setEditing(null); setSelectedId(''); }}>{t('plugins.cancel')}</Button><Button type="primary" loading={busy} disabled={busy || !editing.name.trim()} onClick={() => void run(async () => {
      await saveProviderConnection({ ...editing, name: editing.name.trim(), baseUrl, pluginId: editing.pluginId, presetId: editing.presetId });
      await saveAppSettings({ providerConfigs: { ...settingsStore.providerConfigs, [editing.id]: { apiKey, baseUrl } } });
      showSuccessToast(t('plugins.saved'));
    })}>{t('plugins.save')}</Button></div> : null} width={1000}>
      {selected && <div className="provider-plugin-dialog provider-plugin-inspector">
        {selectedView === 'details' ? <ProviderPluginDetails key={`${selected.manifest.id}@${selected.manifest.version}`} plugin={selected} connections={linked(selected.manifest.id)} /> : <>
      {editing && <div className="provider-plugin-settings-content">
        <section className="provider-plugin-connection-panel">
          <div className="provider-plugin-connection-heading"><div><h3>{t('plugins.providerConnections')}</h3><p>{t('plugins.connectionHint')}</p></div>
            <label className="provider-plugin-enabled-field">{t(editing.enabled !== false ? 'plugins.enabled' : 'plugins.disabled')}<Switch size="small" checked={editing.enabled !== false} disabled={busy} onChange={enabled => setEditing({ ...editing, enabled })} /></label>
          </div>
          {linked(selected.manifest.id).length > 1 && <Select className="provider-plugin-connection-select" aria-label={t('plugins.providerConnections')} value={linked(selected.manifest.id).some(connection => connection.id === editing.id) ? editing.id : undefined} disabled={busy} options={linked(selected.manifest.id).map(connection => ({ value: connection.id, label: connection.name }))} onChange={id => editConnection(linked(selected.manifest.id).find(connection => connection.id === id))} />}
        <div className="provider-plugin-credentials">
        <label>{t('plugins.connectionName')}<Input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>{t('plugins.endpoint')}<Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
        <label className="provider-plugin-key-field">API Key<Input.Password value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" /></label>
        </div>
        </section>

        <section className="provider-plugin-models-panel"><div className="provider-plugin-section-heading"><h3>{t('plugins.availableModels')}</h3><span className="provider-plugin-count">{editing.models?.length || 0}</span></div>
          <div className="provider-plugin-model-grid">
          {editing.models?.map((model, i) => <div className="provider-plugin-model-card" key={model.id}>
            <span className="provider-plugin-model-name" title={model.name}>{model.name || t('plugins.newModel')}</span>
            <Switch size="small" checked={model.enabled !== false} disabled={busy} aria-label={`${model.name} ${t('plugins.enabled')}`} onChange={enabled => updateModel(i, { ...model, enabled })} />
          </div>)}
          </div>
        </section>
        {Boolean(selected.manifest.capabilities?.length) && <section className="provider-plugin-tools-panel"><div className="provider-plugin-section-heading"><h3>{t('pluginActions.menu')}</h3><span className="provider-plugin-count">{selected.manifest.capabilities!.length}</span></div><div className="provider-plugin-tool-grid">{selected.manifest.capabilities!.map(capability => <div className="provider-plugin-tool-card" key={capability.id}><IconSymbol name="blocks" /><div><strong>{capability.name}</strong><p>{capability.description}</p></div></div>)}</div></section>}
        <section className="provider-plugin-advanced"><div className="provider-plugin-advanced-header"><div><h3>{t('plugins.advanced')}</h3><small>{selected.manifest.id} · v{selected.manifest.version}</small></div><Button danger disabled={busy} onClick={() => setConfirmRemove(true)}>{t('plugins.remove')}</Button></div><p>{t('plugins.retentionHint')}</p>
          {selected.history.length > 0 && <Select aria-label={t('plugins.rollback')} placeholder={t('plugins.rollback')} value={undefined} disabled={busy} options={selected.history.map(item => ({ value: item.manifest.version, label: item.manifest.version }))} onChange={version => void run(async () => { await mutateProviderPlugin('rollback', { id: selected.manifest.id, version }); await saveAppSettings(); })} />}
        </section>
      </div>}
        </>}
        {!editing && errorNotice}
      </div>}
    </Modal>


    <Modal
      centered
      title={t('plugins.remove')}
      open={confirmRemove && Boolean(selected)}
      okText={t('plugins.remove')}
      cancelText={t('plugins.cancel')}
      okButtonProps={{ danger: true }}
      confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      onCancel={() => { if (!busy) setConfirmRemove(false); }}
      onOk={() => {
        if (!selected || busy) return;
        void run(async () => {
          await mutateProviderPlugin('remove', { id: selected.manifest.id });
          setConfirmRemove(false); setSelectedId(''); setEditing(null);
        });
      }}
    >
      <p>{selected?.manifest.name}</p>
      <p>{t('plugins.removeHint')}</p>
      {errorNotice}
    </Modal>

  </section>;
}

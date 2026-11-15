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
  allProviderPlugins, providerConnections, bindProtocolModel, type PluginModel, type ProviderConnection,
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
  const plugins = allProviderPlugins().filter(plugin => !plugin.removed);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [npmRegistry, setNpmRegistry] = useState('npmmirror');
  const [status, setStatus] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [installOpen, setInstallOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [section, setSection] = useState('protocols');
  const [source, setSource] = useState('');
  const [installMethod, setInstallMethod] = useState('npm');
  const [selectedView, setSelectedView] = useState('details');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectedSource, setInspectedSource] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [modelJson, setModelJson] = useState('');
  const [modelIndex, setModelIndex] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selected = plugins.find(plugin => plugin.manifest.id === selectedId);
  const connections = providerConnections();
  const enabledProtocols = plugins.filter(plugin => plugin.enabled && plugin.manifest.kind === 'protocol');
  const linked = (pluginId: string) => connections.filter(connection => connection.models?.some(model => model.protocolPlugin === pluginId) || connection.pluginId === pluginId);
  const pluginTypes = (plugin: typeof plugins[number]) => new Set(plugin.manifest.kind === 'protocol' ? [plugin.manifest.category!] : plugin.manifest.providers.flatMap(provider => provider.models.map(model => model.type)));
  const descriptionFor = (plugin: typeof plugins[number]) => plugin.manifest.description || (plugin.manifest.kind === 'protocol' ? t('plugins.protocolDescription') : plugin.manifest.providers.map(provider => catalogLabel(provider.description || provider.name, provider.descriptionKey)).join(' · '));
  const visible = plugins.filter(plugin => {
    const search = `${plugin.manifest.name} ${descriptionFor(plugin)} ${plugin.manifest.author || ''} ${plugin.manifest.providers.map(provider => provider.name).join(' ')}`.toLocaleLowerCase();
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
    setInspection(result); setInspectedSource(result.resolvedSource || nextSource); setTrusted(false);
  }
  function openSettings(plugin: typeof plugins[number], view = 'settings') {
    setSelectedView(view);
    setSelectedId(plugin.manifest.id); setConfirmRemove(false); setError('');
  }
  function editConnection(connection?: ProviderConnection) {
    const plugin = selected || enabledProtocols[0];
    if (!connection && !plugin) return;
    const next = structuredClone(connection || { id: `connection.${crypto.randomUUID()}`, name: '', pluginId: plugin!.manifest.id, presetId: 'protocol', models: [], enabled: true });
    setEditing(next); setModelIndex(null);
    const config = settingsStore.providerConfigs[next.id];
    setApiKey(config?.apiKey || ''); setBaseUrl(config?.baseUrl || next.baseUrl || ''); setError('');
  }
  function updateModel(index: number, model: PluginModel) {
    if (!editing) return;
    setEditing({ ...editing, models: editing.models?.map((item, i) => i === index ? model : item) || [] });
  }
  function addModel() {
    if (!editing) return;
    const plugin = selected?.manifest.kind === 'protocol' && selected.enabled ? selected : enabledProtocols[0];
    if (!plugin) return;
    const model = bindProtocolModel(plugin.manifest, plugin.manifest.protocols[0] ? [plugin.manifest.protocols[0].id] : []);
    setEditing({ ...editing, models: [...editing.models || [], model] });
  }
  const errorMessage = error || providerPluginStore.error;
  const errorNotice = errorMessage ? <p className="provider-plugin-error" role="alert">{errorMessage}</p> : null;
  return <section className={`provider-plugin-center${standalone ? ' provider-plugin-page' : ''}`}>
    {standalone && <header className="provider-plugin-heading"><h1>{t('plugins.title')}</h1><p>{t('plugins.description')}</p></header>}
    <Segmented className="provider-plugin-sections" value={section} onChange={setSection} options={[{ value: 'protocols', label: t('plugins.protocols') }, { value: 'connections', label: t('plugins.providerConnections') }]} />
    {section === 'protocols' && <>
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
        const models = plugin.manifest.providers.flatMap(provider => provider.models);
        const types = pluginTypes(plugin);
        const connections = linked(plugin.manifest.id);
        return <article className="provider-plugin-card" key={plugin.manifest.id} tabIndex={0}
          onDoubleClick={() => openSettings(plugin, 'details')}
          onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') openSettings(plugin, 'details'); }}>
          <div className="provider-plugin-card-heading">
            <div className="provider-plugin-card-icon"><ProviderBrandIcon icon={plugin.manifest.iconId || plugin.manifest.providers[0]?.iconId || 'custom'} /></div>
            <div><h2 title={plugin.manifest.name}>{plugin.manifest.name}</h2><span className="provider-plugin-version">v{plugin.manifest.version} · {plugin.source.startsWith('distribution:') ? t('plugins.bundled') : t('plugins.userInstalled')}</span></div>
          </div>
          <p className="provider-plugin-card-description">{descriptionFor(plugin)}</p>
          <div className="provider-plugin-capabilities">{categories.filter(item => types.has(item.id)).map(item => <span key={item.id}><IconSymbol name={item.icon} />{t(item.label)}</span>)}</div>
          <div className="provider-plugin-card-meta"><span>{t(plugin.manifest.kind === 'protocol' ? 'plugins.operationCount' : 'plugins.modelCount', { count: plugin.manifest.kind === 'protocol' ? plugin.manifest.protocols.length : models.length })}</span>{connections.length > 0 && <span>{t('plugins.connectionCount', { count: connections.length })}</span>}</div>
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
    </>}
    {section === 'connections' && <>
      <div className="provider-plugin-section-heading"><p>{t('plugins.connectionHint')}</p><Button type="primary" disabled={!enabledProtocols.length} onClick={() => { setSelectedId(''); editConnection(); }}><IconSymbol name="plus" />{t('plugins.addConnection')}</Button></div>
      <div className="provider-plugin-grid">{connections.map(connection => <article className="provider-plugin-card" key={connection.id}>
        <div className="provider-plugin-card-heading"><div className="provider-plugin-card-icon"><ProviderBrandIcon icon={connection.iconId || 'custom'} /></div><h2>{connection.name}</h2></div>
        <p className="provider-plugin-card-description">{settingsStore.providerConfigs[connection.id]?.baseUrl || connection.baseUrl}</p>
        <div className="provider-plugin-card-meta">{t('plugins.modelCount', { count: connection.models?.length || 0 })}</div>
        <footer className="provider-plugin-card-footer"><span className="provider-plugin-state">{t(connection.enabled !== false ? 'plugins.enabled' : 'plugins.disabled')}</span><Switch size="small" aria-label={connection.name} checked={connection.enabled !== false} disabled={busy} onChange={enabled => void run(() => saveProviderConnection({ ...connection, enabled }))} /><Button onClick={() => editConnection(connection)}>{t('plugins.settings')}</Button></footer>
      </article>)}</div>
      {errorNotice}
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
          <details><summary>{t('plugins.packageDetails')}</summary><small>SHA-256: {inspection.digest}</small><small>{inspection.manifest.id}</small></details>
          {inspection.hasCode && <Checkbox checked={trusted} onChange={event => setTrusted(event.target.checked)}>{t('plugins.trustCode')}</Checkbox>}
          <Button type="primary" disabled={busy || (inspection.hasCode && !trusted)} onClick={() => void run(async () => {
            await installProviderPackage(inspectedSource, inspection.digest, trusted, npmRegistry); await saveAppSettings(); setInspection(null); setInstallOpen(false);
          })}>{t('plugins.confirmInstall')}</Button>
        </div>}
        {errorNotice}
      </div>
    </Modal>

    <Modal title={selected?.manifest.name || t('plugins.settings')} open={Boolean(selected)} onCancel={() => { if (!busy) setSelectedId(''); }} footer={null} width={1100}>
      {selected && <div className="provider-plugin-dialog provider-plugin-inspector">
        {selectedView === 'details' ? <ProviderPluginDetails key={`${selected.manifest.id}@${selected.manifest.version}`} plugin={selected} connections={linked(selected.manifest.id)} /> : <>
        <p>{descriptionFor(selected)}</p>
        {selected.manifest.kind === 'protocol' && <section className="provider-plugin-detail-section"><h3>{t('plugins.operations')}</h3>{selected.manifest.protocols.map(operation => <div className="provider-plugin-row" key={operation.id}><strong>{catalogLabel(operation.mode.label, operation.mode.labelKey)}</strong><small>{operation.description || operation.mode.endpoint.path}</small></div>)}</section>}
        <section className="provider-plugin-detail-section"><div className="provider-plugin-section-heading"><h3>{t('plugins.providerConnections')}</h3><Button size="small" disabled={busy || !selected.enabled} onClick={() => editConnection()}><IconSymbol name="plus" />{t('plugins.addConnection')}</Button></div><p>{t('plugins.connectionHint')}</p>
          {linked(selected.manifest.id).map(connection => <div className="provider-plugin-row" key={connection.id}><strong>{connection.name}</strong><Button size="small" onClick={() => editConnection(connection)}>{t('plugins.settings')}</Button></div>)}
        </section>
        <details className="provider-plugin-advanced"><summary>{t('plugins.advanced')}</summary><p>{t('plugins.retentionHint')}</p><small>{selected.manifest.id} · v{selected.manifest.version}</small>
          {selected.history.length > 0 && <Select aria-label={t('plugins.rollback')} placeholder={t('plugins.rollback')} value={undefined} disabled={busy} options={selected.history.map(item => ({ value: item.manifest.version, label: item.manifest.version }))} onChange={version => void run(async () => { await mutateProviderPlugin('rollback', { id: selected.manifest.id, version }); await saveAppSettings(); })} />}
          {<Button danger disabled={busy} onClick={() => setConfirmRemove(true)}>{t('plugins.remove')}</Button>}
          {confirmRemove && <div className="provider-plugin-confirm"><p>{t('plugins.removeHint')}</p><Button onClick={() => setConfirmRemove(false)}>{t('plugins.cancel')}</Button><Button danger disabled={busy} onClick={() => void run(async () => { await mutateProviderPlugin('remove', { id: selected.manifest.id }); setSelectedId(''); })}>{t('plugins.remove')}</Button></div>}
        </details>
        </>}
        {!editing && errorNotice}
      </div>}
    </Modal>

    <Modal title={editing?.name || t('plugins.addConnection')} open={Boolean(editing)} onCancel={() => { if (!busy) setEditing(null); }} footer={null} width={600}>
      {editing && <div className="provider-plugin-dialog">
        <label>{t('plugins.connectionName')}<Input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>{t('plugins.endpoint')}<Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
        <label>API Key<Input.Password value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" /></label>
        <section className="provider-plugin-detail-section"><div className="provider-plugin-section-heading"><h3>{t('plugins.availableModels')}</h3><Button size="small" disabled={!enabledProtocols.length} onClick={addModel}><IconSymbol name="plus" />{t('plugins.addModel')}</Button></div>
          {editing.models?.map((model, i) => {
            const protocol = plugins.find(plugin => plugin.manifest.id === model.protocolPlugin);
            return <details className="provider-plugin-model-editor" key={model.id}><summary>{model.name || t('plugins.newModel')} · {protocol?.manifest.name || t('plugins.protocol')}</summary>
              <div className="provider-plugin-section-heading"><strong>{model.name || t('plugins.newModel')}</strong><Button size="small" danger onClick={() => setEditing({ ...editing, models: editing.models?.filter((_, index) => index !== i) || [] })}>{t('plugins.deleteModel')}</Button></div>
              <label>{t('plugins.modelName')}<Input value={model.name} onChange={event => updateModel(i, { ...model, name: event.target.value })} /></label>
              <label>{t('plugins.upstreamModel')}<Input value={model.upstreamModel ?? model.id} onChange={event => updateModel(i, { ...model, upstreamModel: event.target.value })} /></label>
              <label>{t('plugins.protocol')}<Select value={model.protocolPlugin || null} options={plugins.filter(plugin => plugin.manifest.kind === 'protocol').map(plugin => ({ value: plugin.manifest.id, label: plugin.manifest.name, disabled: !plugin.enabled }))} onChange={id => {
                const manifest = plugins.find(plugin => plugin.manifest.id === id)!.manifest;
                updateModel(i, bindProtocolModel(manifest, manifest.protocols[0] ? [manifest.protocols[0].id] : [], model));
              }} /></label>
              {protocol && <label>{t('plugins.operations')}<Select mode="multiple" value={Object.values(model.protocolModes || {})} options={protocol.manifest.protocols.map(operation => ({ value: operation.id, label: `${catalogLabel(operation.mode.label, operation.mode.labelKey)} · ${operation.description || operation.mode.endpoint.path}` }))} onChange={operations => updateModel(i, bindProtocolModel(protocol.manifest, operations, model))} /></label>}
              <Button type="text" size="small" onClick={() => { setModelIndex(i); setModelJson(JSON.stringify(model, null, 2)); }}>{t('plugins.modelCapabilities')}</Button>
            </details>;
          })}
        </section>
        {errorNotice}
        <div className="provider-plugin-actions"><Button onClick={() => setEditing(null)}>{t('plugins.cancel')}</Button><Button type="primary" disabled={busy || !editing.name.trim()} onClick={() => void run(async () => {
          const first = editing.models?.find(model => model.protocolPlugin);
          await saveProviderConnection({ ...editing, name: editing.name.trim(), baseUrl, pluginId: first?.protocolPlugin || editing.pluginId, presetId: first ? 'protocol' : editing.presetId });
          await saveAppSettings({ providerConfigs: { ...settingsStore.providerConfigs, [editing.id]: { apiKey, baseUrl } } });
          showSuccessToast(t('plugins.saved')); setEditing(null);
        })}>{t('plugins.save')}</Button></div>
      </div>}
    </Modal>

    <Modal title={t('plugins.modelCapabilities')} open={modelIndex !== null && Boolean(editing)} onCancel={() => setModelIndex(null)} onOk={() => {
      try { const model = JSON.parse(modelJson); if (modelIndex !== null && editing?.models?.[modelIndex]) updateModel(modelIndex, { ...model, id: editing.models[modelIndex].id }); setModelIndex(null); } catch (cause) { setError(String(cause)); }
    }}><Input.TextArea aria-label={t('plugins.modelCapabilities')} value={modelJson} onChange={event => setModelJson(event.target.value)} autoSize={{ minRows: 10, maxRows: 20 }} />{errorNotice}</Modal>

  </section>;
}

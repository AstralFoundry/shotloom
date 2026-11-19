import { useState, useSyncExternalStore } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Select } from 'antd';
import { t } from '../../i18n';
import { store } from '../../store/projectStore';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { capabilityConnections, nodeCapabilityMedia, registeredCapabilities } from '../../domain/provider/plugins/PluginCapabilities';
import { runCanvasPluginAction } from '../../store/pluginActionStore';
import { useWorkbenchSurfaceRoot } from '../layout/workbenchSurface';

export function PluginActionDialog({ capabilityKey, nodeId, onClose }: {
  capabilityKey: string; nodeId?: string; onClose: () => void;
}) {
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const surface = useWorkbenchSurfaceRoot();
  const registered = registeredCapabilities().find(c => c.key === capabilityKey);
  const capability = registered?.capability;
  const connections = registered ? capabilityConnections(registered.reference.id) : [];
  const [connectionId, setConnectionId] = useState(connections[0]?.id || '');
  const [parameters, setParameters] = useState<Record<string, any>>(() => Object.fromEntries((capability?.parameters || []).filter(p => p.default !== undefined).map(p => [p.id, p.default])));
  const [inputs, setInputs] = useState<Record<string, string[]>>(() => {
    const node = store.project.nodes.find((n: any) => n.id === nodeId);
    const media = node && nodeCapabilityMedia(node, store.project);
    const slot = capability?.inputs.find(slot => slot.type === media?.type);
    return slot && nodeId ? { [slot.id]: [nodeId] } : {};
  });
  const [submissionId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [project] = useState(() => store.project);
  const [digest] = useState(() => registered?.digest);
  async function run() {
    if (busy || store.project !== project || registered?.digest !== digest) return;
    setBusy(true); setError('');
    try {
      await runCanvasPluginAction({ key: capabilityKey, connectionId, inputs, parameters }, submissionId);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <Modal open title={capability?.name || t('pluginActions.unavailable')} onCancel={() => { if (!busy) onClose(); }}
    getContainer={surface || false} footer={null} width={600}>
    {!registered || registered.digest !== digest || store.project !== project ? <Alert type="warning" message={t('pluginActions.unavailable')} /> :
      <div className="provider-plugin-dialog">
        <p>{capability!.description}</p>
        <label>{t('pluginActions.connection')}<Select value={connectionId || null} onChange={value => setConnectionId(value)} disabled={busy}
          options={connections.map(c => ({ value: c.id, label: c.name }))} /></label>
        {!connections.length && <Alert type="info" message={t('pluginActions.configureConnection')} />}
        {capability!.inputs.map(slot => <label key={slot.id}>{slot.label}{slot.required ? ' *' : ''}
          <Select {...(slot.multiple ? { mode: 'multiple' as const } : {})} disabled={busy} allowClear
            value={slot.multiple ? inputs[slot.id] || [] : inputs[slot.id]?.[0]}
            onChange={value => setInputs(prev => ({ ...prev, [slot.id]: Array.isArray(value) ? value : value ? [value] : [] }))}
            options={store.project.nodes.filter((n: any) => nodeCapabilityMedia(n, store.project)?.type === slot.type).map((n: any) => ({ value: n.id, label: n.title || n.id }))} />
        </label>)}
        {capability!.parameters.filter(p => !p.visibleWhen || parameters[p.visibleWhen.parameter] === p.visibleWhen.equals).map(p => {
          const update = (value: unknown) => setParameters(prev => ({ ...prev, [p.id]: value ?? undefined }));
          return <label key={p.id}>{p.label}{p.required ? ' *' : ''}
            {p.enum ? <Select disabled={busy} value={parameters[p.id] === undefined ? undefined : String(parameters[p.id])}
              options={p.enum.map(v => ({ value: String(v), label: String(v) }))} onChange={value => update(p.enum!.find(v => String(v) === value))} /> :
              p.type === 'boolean' ? <Checkbox disabled={busy} checked={parameters[p.id] === true} onChange={e => update(e.target.checked)} /> :
                p.type === 'number' ? <InputNumber disabled={busy} value={parameters[p.id]} min={p.minimum} max={p.maximum} onChange={update} /> :
                  <Input disabled={busy} value={parameters[p.id] || ''} onChange={e => update(e.target.value)} />}
          </label>;
        })}
        <Alert type="info" message={t('pluginActions.remoteNotice')} />
        {error && <Alert type="error" message={error} role="alert" />}
        <div className="provider-plugin-actions"><Button disabled={busy} onClick={onClose}>{t('plugins.cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!connectionId} onClick={() => void run()}>{t('pluginActions.run')}</Button></div>
      </div>}
  </Modal>;
}

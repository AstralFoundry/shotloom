import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { store } from '../../store/projectStore';
import { capabilitiesForNode } from '../../domain/provider/plugins/PluginCapabilities';
import { PluginActionDialog } from './PluginActionDialog';
import { Dropdown } from 'antd';

export function PluginNodeContextMenu({ nodeId, x, y, onClose }: {
  nodeId: string; x: number; y: number; onClose: () => void;
}) {
  const [key, setKey] = useState('');
  const node = store.project.nodes.find((n: any) => n.id === nodeId);
  const capabilities = node ? capabilitiesForNode(node, store.project, 'contextMenu') : [];
  useEffect(() => {
    if (key) return;
    const close = () => onClose();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [key, onClose]);
  if (key) return <PluginActionDialog capabilityKey={key} nodeId={nodeId} onClose={onClose} />;
  return createPortal(<Dropdown open trigger={['contextMenu']}
    onOpenChange={open => { if (!open) onClose(); }}
    menu={{ items: capabilities.map(c => ({ key: c.key, label: `${c.capability.name} · ${c.pluginName}` })), onClick: item => setKey(item.key) }}
    popupRender={menu => <div onPointerDown={event => event.stopPropagation()}>{menu}</div>}>
    <span style={{ position: 'fixed', left: Math.max(8, Math.min(x, window.innerWidth - 280)), top: Math.max(8, Math.min(y, window.innerHeight - 240)) }} />
  </Dropdown>, document.body);
}

import { useState, type ReactNode } from 'react';
import { Button, Dropdown, Input, Tooltip } from 'antd';
import { CloudAlert, CloudCheck, CloudDownload, CloudUpload, Focus, History, LoaderCircle, Menu, Pencil, Redo2, Save, Search, Undo2 } from 'lucide-react';
import { t } from '@/i18n';
import type { ProjectSaveStatus } from '../../store/projectStore';
import './CanvasHeader.css';

const saveIcons = { saved: CloudCheck, pending: LoaderCircle, saving: LoaderCircle, unsaved: CloudUpload, failed: CloudAlert };

export function CanvasHeader({ name, saveStatus, history, onRename, onSave, onImport, onFitView, onVersions, onSearch, onUndo, onRedo, children }: {
  name: string;
  saveStatus: ProjectSaveStatus;
  history: { canUndo: boolean; canRedo: boolean };
  onRename: (name: string) => void;
  onSave: () => void;
  onImport: () => void;
  onFitView: () => void;
  onVersions: () => void;
  onSearch: () => void;
  onUndo: () => void;
  onRedo: () => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const SaveIcon = saveIcons[saveStatus];
  const statusText = t(`canvas.header.${saveStatus}`);
  const saveLabel = t('canvas.header.save');
  const renameLabel = t('canvas.header.rename');
  const importLabel = t('canvas.header.importFiles');
  const fitLabel = t('ui.BottomModeBar.label.a187522f');
  const versionsLabel = t('project.version.title');
  const menuLabel = t('canvas.header.menu');

  function finishRename() {
    if (draft?.trim() && draft.trim() !== name) onRename(draft.trim());
    setDraft(null);
  }

  return <div className="canvas-workspace-header">
    <div className="canvas-workspace-title">
      <Dropdown trigger={['click']} placement="bottomLeft" menu={{ items: [
        { key: 'save', icon: <Save />, label: saveLabel, disabled: saveStatus === 'saving', onClick: onSave },
        { key: 'search', icon: <Search />, label: t('canvas.header.search'), onClick: onSearch },
        { type: 'divider' },
        { key: 'undo', icon: <Undo2 />, label: t('ui.BottomModeBar.title.9fcefd8d'), disabled: !history.canUndo, onClick: onUndo },
        { key: 'redo', icon: <Redo2 />, label: t('ui.BottomModeBar.title.1238f0d3'), disabled: !history.canRedo, onClick: onRedo },
      ] }}>
        <Button type="text" className="canvas-workspace-menu" title={menuLabel} aria-label={menuLabel} aria-haspopup="menu" icon={<Menu />} />
      </Dropdown>
      <div className="canvas-workspace-title-edit">{draft === null
        ? <Tooltip title={renameLabel}><Button type="text" onClick={() => setDraft(name)} aria-label={`${renameLabel} · ${name}`}>
          <span className="canvas-workspace-name">{name}</span><Pencil aria-hidden="true" />
        </Button></Tooltip>
        : <Input aria-label={renameLabel} value={draft} onChange={event => setDraft(event.target.value)}
          autoFocus onFocus={event => event.target.select()} onBlur={finishRename}
          onPressEnter={event => { if (!event.nativeEvent.isComposing) event.currentTarget.blur(); }}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); } }} />}</div>
      <span className="canvas-workspace-save" data-status={saveStatus} role="status" aria-label={statusText}>
        <Tooltip title={saveStatus === 'saving' ? statusText : `${statusText} · ${saveLabel}`}>
          <Button type="text" aria-label={saveLabel} disabled={saveStatus === 'saving'} icon={<SaveIcon />} onClick={onSave} />
        </Tooltip>
      </span>
    </div>
    {children}
    <div className="canvas-workspace-actions" role="group" aria-label={t('canvas.header.actions')}>
      <Tooltip title={importLabel}><Button type="text" aria-label={importLabel} icon={<CloudDownload />} onClick={onImport}>
        <span className="canvas-workspace-action-label">{t('canvas.header.import')}</span>
      </Button></Tooltip>
      <Tooltip title={fitLabel}><Button type="text" aria-label={fitLabel} icon={<Focus />} onClick={onFitView} /></Tooltip>
      <Tooltip title={versionsLabel}>
        <Button type="text" aria-label={versionsLabel} icon={<History />} onClick={onVersions}>
          <span className="canvas-workspace-action-label">{t('canvas.header.versions')}</span>
        </Button>
      </Tooltip>
    </div>
  </div>;
}

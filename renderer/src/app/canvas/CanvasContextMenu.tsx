import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, Clapperboard, Clipboard, CloudUpload, FileText, FolderOpen, Image, Layers3,
  Music, PersonStanding, Plus, Redo2, Scissors, Table2, Type, Undo2, Upload, Video,
} from 'lucide-react';
import { t } from '@/i18n';
import { IconSymbol } from '../components/IconSymbol';
import { nodeTypes } from '../constants/navigation';

const tileIcons = {
  canvasSection: Layers3,
  storyboardScript: Clapperboard,
  batchTable: Table2,
  clipStudio: Scissors,
  imageGeneration: Image,
  videoGeneration: Video,
  threeDDirector: Layers3,
  audioGeneration: Music,
  textGeneration: Type,
  __markdown__: FileText,
};

type Commands = {
  upload: () => void;
  assets: () => void;
  undo: () => void;
  redo: () => void;
  paste: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function CanvasContextMenu({ x, y, port, compact, commands, onCreate, onClose, onOpenPoseLibrary }: {
  x: number;
  y: number;
  port?: { side: 'left' | 'right'; allowedTypes: readonly string[] };
  compact?: boolean;
  commands: Commands;
  onClose: () => void;
  onCreate: (type: string) => void | Promise<void>;
  onOpenPoseLibrary?: (() => void) | undefined;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusPalette = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const title = port
    ? t(port.side === 'left' ? 'canvas.port.createUpstream' : 'canvas.port.createDownstream')
    : t('canvas.insert.addNode');
  const mac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');
  const shortcut = mac ? '⌘' : 'Ctrl+';
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [port]);
  useEffect(() => {
    if (expanded && focusPalette.current) {
      focusPalette.current = false;
      paletteRef.current?.querySelector('button')?.focus({ preventScroll: true });
    }
  }, [expanded]);

  return <div ref={menuRef} className={port ? 'canvas-context-menu' : 'canvas-insert-menu'}
    data-compact={compact || undefined} tabIndex={-1} style={{ left: x, top: y, ...(!port && { maxHeight: `calc(100% - ${y + 8}px)` }) }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (expanded && paletteRef.current?.contains(document.activeElement)) {
          setExpanded(false);
          addRef.current?.focus({ preventScroll: true });
        } else onClose();
        return;
      }
      if (!port && event.key === 'ArrowRight' && document.activeElement === addRef.current) {
        event.preventDefault();
        event.stopPropagation();
        if (expanded) paletteRef.current?.querySelector('button')?.focus({ preventScroll: true });
        else {
          focusPalette.current = true;
          setExpanded(true);
        }
        return;
      }
      if (!port && event.key === 'ArrowLeft' && paletteRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        addRef.current?.focus({ preventScroll: true });
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement as HTMLElement | null;
      const group = active?.closest('[role="menu"]') ?? event.currentTarget;
      const buttons = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) return;
      const index = buttons.indexOf(active as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }}>
    {port ? <div className="canvas-context-menu-section" role="menu" aria-label={title}>
      <span className="canvas-context-menu-label">{title}</span>
      {nodeTypes.filter(item => port.allowedTypes.includes(item.id)).map(item => <button type="button" role="menuitem" key={item.id}
        onClick={() => void onCreate(item.id)}><i><IconSymbol name={item.icon} /></i><span>{item.label}</span></button>)}
    </div> : <>
      <div className="canvas-insert-commands" role="menu" aria-label={t('canvas.insert.menu')}>
        <button ref={addRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={expanded}
          onPointerEnter={() => setExpanded(true)} onClick={() => {
            if (expanded) paletteRef.current?.querySelector('button')?.focus({ preventScroll: true });
            else setExpanded(true);
          }}>
          <Plus /><span>{title}</span><i className="canvas-insert-chevron"><ChevronRight /></i>
        </button>
        <button type="button" role="menuitem" onClick={commands.upload}><Upload />{t('canvas.insert.uploadHere')}</button>
        <button type="button" role="menuitem" onClick={commands.assets}><FolderOpen />{t('canvas.insert.fromLibrary')}</button>
        <hr />
        <button type="button" role="menuitem" disabled={!commands.canUndo} onClick={commands.undo}><Undo2 /><span>{t('ui.BottomModeBar.title.9fcefd8d')}</span><kbd>{shortcut}Z</kbd></button>
        <button type="button" role="menuitem" disabled={!commands.canRedo} onClick={commands.redo}><Redo2 /><span>{t('ui.BottomModeBar.title.1238f0d3')}</span><kbd>{mac ? '⇧' : 'Shift+'}{shortcut}Z</kbd></button>
        <button type="button" role="menuitem" onClick={commands.paste}><Clipboard /><span>{t('canvas.insert.paste')}</span><kbd>{shortcut}V</kbd></button>
      </div>
      {expanded && <div ref={paletteRef} className="canvas-insert-palette" role="menu" aria-label={title}>
        <strong>{title}</strong>
        <div className="canvas-insert-tiles">
          {[
            { id: 'canvasSection' as const, label: t('canvas.section.create') },
            ...nodeTypes,
            { id: '__markdown__' as const, label: t('canvas.assetView.markdown') },
          ].map(item => {
            const Icon = tileIcons[item.id as keyof typeof tileIcons];
            return <button type="button" role="menuitem" key={item.id} title={item.label} onClick={() => void onCreate(item.id)}>
              <i>{Icon ? <Icon /> : 'icon' in item && <IconSymbol name={item.icon} />}</i><span>{item.label}</span>
            </button>;
          })}
        </div>
        <div className="canvas-insert-footer">
          <button type="button" role="menuitem" onClick={commands.upload}><CloudUpload /><span>{t('canvas.assetView.upload')}</span></button>
          <button type="button" role="menuitem" onClick={commands.assets}><FolderOpen /><span>{t('assets.browser.title')}</span></button>
          {onOpenPoseLibrary && <button type="button" role="menuitem" onClick={onOpenPoseLibrary}><PersonStanding /><span>{t('canvas.pose.title')}</span></button>}
        </div>
      </div>}
    </>}
  </div>;
}

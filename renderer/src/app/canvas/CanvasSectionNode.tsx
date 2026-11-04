import { useEffect, useState, type CSSProperties } from 'react';
import { NodeResizer } from '@xyflow/react';
import { t } from '@/i18n';
import type { WorkflowNodeActions, WorkflowNodeData } from './WorkflowCanvas';
import { IconSymbol } from '../components/IconSymbol';

/** A spatial backdrop; it has no generation controls or graph ports. */
export function CanvasSectionNode({ node, selected, zoom, actions }: {
  node: WorkflowNodeData; selected: boolean; zoom: number; actions: WorkflowNodeActions;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title || '');
  useEffect(() => { if (!editing) setTitle(node.title || ''); }, [node.title, editing]);
  const commit = () => {
    const next = title.trim() || t('canvas.section.default');
    if (next !== node.title) actions.update(node.id, { title: next });
    setEditing(false);
  };
  return <>
    <NodeResizer isVisible={selected} minWidth={240 * zoom} minHeight={160 * zoom}
      handleClassName="canvas-section-resize nodrag" lineClassName="canvas-section-resize-line"
      onResizeEnd={(_event, size) => actions.update(node.id, {
        x: Math.round(size.x / zoom), y: Math.round(size.y / zoom),
        canvasWidth: Math.round(size.width / zoom), canvasHeight: Math.round(size.height / zoom),
      })} />
    <div className={`canvas-section${selected ? ' is-selected' : ''}`} style={{ '--section-zoom': zoom } as CSSProperties}>
      <div className="canvas-section-heading" onDoubleClick={() => setEditing(true)}>
        {editing ? <input className="nodrag nopan" autoFocus value={title} aria-label={t('canvas.section.rename')}
          onFocus={event => event.target.select()} onChange={event => setTitle(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { setTitle(node.title || ''); setEditing(false); }
          }} /> : <span className="canvas-section-title" title={t('canvas.section.renameHint')}>{node.title || t('canvas.section.default')}</span>}
        <div className="canvas-section-actions nodrag nopan">
          <button type="button" title={t('canvas.section.selectContents')} aria-label={t('canvas.section.selectContents')}
            onClick={() => actions.selectSectionContents?.(node.id)}><IconSymbol name="grid" /></button>
          <button type="button" title={t('canvas.section.remove')} aria-label={t('canvas.section.remove')}
            onClick={() => actions.delete(node.id)}><IconSymbol name="x" /></button>
        </div>
      </div>
    </div>
  </>;
}

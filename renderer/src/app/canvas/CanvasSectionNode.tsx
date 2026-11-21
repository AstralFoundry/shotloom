import { createContext, useContext, useEffect, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import { t } from '@/i18n';
import type { WorkflowNodeActions, WorkflowNodeData } from './WorkflowCanvas';
import { canvasSectionMembers } from '../../domain/graph/CanvasSections.ts';
import { canvasNodeDimensions } from '../../domain/graph/CanvasNodeDimensions.ts';
import { IconSymbol } from '../components/IconSymbol';

export type SectionDragFeedback = 'join' | 'inside' | 'leave' | 'joined';
export const CanvasSectionNodesContext = createContext<WorkflowNodeData[]>([]);
export const SectionDragFeedbackContext = createContext<ReadonlyMap<string, SectionDragFeedback>>(new Map());

/** A section keeps its content together without generation controls or graph ports. */
export function CanvasSectionNode({ node, selected, dragging, actions }: {
  node: WorkflowNodeData; selected: boolean; dragging?: boolean; actions: WorkflowNodeActions;
}) {
  const nodes = useContext(CanvasSectionNodesContext);
  const members = canvasSectionMembers(node, nodes);
  const feedback = useContext(SectionDragFeedbackContext).get(node.id);
  const hint = feedback === 'join' ? t('canvas.section.dropJoin')
    : feedback === 'inside' ? t('canvas.section.dropInside')
    : feedback === 'leave' ? t('canvas.section.dropLeave')
    : feedback === 'joined' ? t('canvas.section.dropJoined') : '';
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title || '');
  useEffect(() => { if (!editing) setTitle(node.title || ''); }, [node.title, editing]);
  const commit = () => {
    const next = title.trim() || t('canvas.section.default');
    if (next !== node.title) actions.update(node.id, { title: next });
    setEditing(false);
  };
  return <>
    <NodeResizer isVisible={selected} minWidth={Math.max(240, ...(node.canvasSectionAutoLayout ? members.map(member => canvasNodeDimensions(member).width + 64) : []))} minHeight={160}
      shouldResize={(_event, size) => node.canvasSectionAutoLayout === true || members.every(member => {
        const bounds = canvasNodeDimensions(member);
        return (Number(member.x) || 0) >= size.x + 32 && (Number(member.y) || 0) >= size.y + 56
          && (Number(member.x) || 0) + bounds.width <= (size.x + size.width) - 32
          && (Number(member.y) || 0) + bounds.height <= (size.y + size.height) - 32;
      })}
      handleClassName="canvas-node-resize-handle canvas-section-resize nodrag" lineClassName="canvas-node-resize-line canvas-section-resize-line"
      onResizeEnd={(_event, size) => actions.update(node.id, {
        x: Math.round(size.x), y: Math.round(size.y),
        canvasWidth: Math.round(size.width), canvasHeight: Math.round(size.height),
      })} />
    <div className={`canvas-section${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`} data-drop-state={feedback}>
      <div className="canvas-section-surface" title={t('canvas.section.moveHint')} />
      <span className="canvas-section-drop-hint" role="status" aria-live="polite">
        {feedback === 'joined' && <IconSymbol name="check" />}{hint}
      </span>
      <div className="canvas-section-heading" onDoubleClick={() => setEditing(true)}>
        {editing ? <input className="nodrag nopan" autoFocus value={title} aria-label={t('canvas.section.rename')}
          onFocus={event => event.target.select()} onChange={event => setTitle(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { setTitle(node.title || ''); setEditing(false); }
          }} /> : <span className="canvas-section-title" title={t('canvas.section.renameHint')}>{node.title || t('canvas.section.default')}</span>}
        <div className="canvas-section-actions nodrag nopan" onDoubleClick={event => event.stopPropagation()}>
          <button type="button" title={t('canvas.section.arrangeHint')} aria-label={t('canvas.section.arrange')}
            onClick={() => actions.arrangeSection?.(node.id)}><IconSymbol name="grid" /></button>
          <button type="button" title={t('canvas.section.autoArrangeHint')} aria-label={t('canvas.section.autoArrange')} aria-pressed={node.canvasSectionAutoLayout === true}
            onClick={() => actions.update(node.id, { canvasSectionAutoLayout: !node.canvasSectionAutoLayout })}><IconSymbol name="refresh" /></button>
          <button type="button" title={t('canvas.section.selectContents')} aria-label={t('canvas.section.selectContents')}
            onClick={() => actions.selectSectionContents?.(node.id)}><IconSymbol name="layers" /></button>
          <button type="button" title={t('canvas.section.remove')} aria-label={t('canvas.section.remove')}
            onClick={() => actions.delete(node.id)}><IconSymbol name="x" /></button>
        </div>
      </div>
    </div>
  </>;
}

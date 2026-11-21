import { t } from '@/i18n';
import { memo, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Dropdown, Input, Modal, Segmented, Switch, Tooltip } from 'antd';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { store } from '../../store/projectStore';
import { selectNode } from '../../store/nodeStore';
import { getDomainRevision, subscribeDomain } from '../../store/domainReactivity';
import { NodeThumb } from './NodeThumb';
import { IconSymbol } from '../components/IconSymbol';
import { CanvasNodeLabelRootContext, type WorkflowNodeRenderer } from './WorkflowCanvas';
import {
  appendBatchColumn,
  appendBatchRow,
  batchReferenceInputs,
  batchRowCanRun,
  batchTableData,
  cancelBatchTableRun,
  canvasImageNodes,
  deleteBatchColumn,
  deleteBatchRow,
  fillBatchRowsFromColumns,
  isBatchTableRunActive,
  isCanvasImageNode,
  moveBatchCell,
  moveBatchColumn,
  patchBatchRow,
  reorderBatchRow,
  runBatchTable,
  setBatchCellReference,
  setBatchOperation,
  setBatchTableSettings,
} from '@/services/batchTableService';
import { BatchGenerationSettingsDialog, type BatchGenerationSettings } from './BatchGenerationSettingsDialog';
import { touchProject } from '@/store/projectStore';
import {
  BATCH_CONCURRENCY_OPTIONS,
  MAX_BATCH_REFERENCE_COLUMNS,
  MAX_BATCH_ROWS,
  batchCellHandle,
  batchColumnHandle,
  batchRowColumnReferences,
  batchRowReferences,
  minimumBatchReferences,
  type BatchRow,
} from '@/domain/graph/BatchTable';

type AnyRecord = Record<string, any>;

function nodeById(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

function outputState(row: BatchRow) {
  const output = nodeById(row.outputNodeId);
  if (!output) return { label: t('canvas.batch.notGenerated'), tone: 'muted' };
  const status = String(output.status || 'idle');
  const tone = status === 'completed' ? 'good'
    : status === 'running' || status === 'queued' ? 'warn'
      : status === 'failed' || status === 'timeout' || status === 'error' ? 'bad' : 'muted';
  const label = status === 'completed' ? t('canvas.batch.status.ready')
    : status === 'running' || status === 'queued' ? t('canvas.batch.status.running')
      : status === 'failed' || status === 'timeout' || status === 'error' ? t('canvas.batch.status.failed')
        : status === 'cancelled' ? t('canvas.batch.status.cancelled') : t('canvas.batch.status.idle');
  return { label, tone };
}

function ReferencePicker({ open, onPick, onClear, onClose }: {
  open: boolean;
  onPick: (nodeId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const nodes = canvasImageNodes();
  const filtered = nodes.filter((node) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return [node.title, node.prompt, node.uploadedFile?.name].filter(Boolean).join(' ').toLowerCase().includes(keyword);
  });
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={760} title={t('canvas.batch.pickReference')} destroyOnHidden>
      <div className="batch-picker">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('canvas.batch.searchReference')} allowClear />
        {filtered.length ? (
          <div className="batch-picker-grid">
            {filtered.map((node) => (
              <button
                type="button"
                className="batch-picker-card"
                key={node.id}
                onClick={() => { onPick(String(node.id)); onClose(); }}
              >
                <NodeThumb nodeId={String(node.id)} className="batch-thumb" />
                <span>{String(node.title || t('canvas.batch.untitledImage'))}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="batch-picker-empty">{t('canvas.batch.noImages')}</div>
        )}
        <div className="batch-picker-foot">
          <Button onClick={() => { onClear(); onClose(); }}>{t('canvas.batch.clearReference')}</Button>
          <Button onClick={onClose}>{t('canvas.batch.close')}</Button>
        </div>
      </div>
    </Modal>
  );
}

export const BatchTableNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { modal } = App.useApp();
  const data = node as AnyRecord;
  const table = batchTableData(data);
  const updateNodeInternals = useUpdateNodeInternals();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowsKey = table.rows.map(row => row.id).join(',');
  const columnsKey = table.columns.map(column => column.id).join(',');
  useLayoutEffect(() => {
    updateNodeInternals(node.id);
  }, [node.id, rowsKey, columnsKey, updateNodeInternals]);
  useLayoutEffect(() => {
    if (!scrollRef.current || !gridRef.current) return;
    const observer = new ResizeObserver(() => updateNodeInternals(node.id));
    observer.observe(scrollRef.current);
    observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [node.id, updateNodeInternals]);
  const canAddRow = table.rows.length < MAX_BATCH_ROWS;
  const columns = batchReferenceInputs(node.id);
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const [generationRequest, setGenerationRequest] = useState<{ rowIds?: string[]; force?: boolean } | null>(null);
  const [picker, setPicker] = useState<{ rowId: string; column: number } | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [draggingCell, setDraggingCell] = useState<{ rowId: string; column: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; pointerId: number; rowId: string; column: number } | null>(null);
  const draggingRef = useRef<{ rowId: string; column: number } | null>(null);
  const suppressClick = useRef(false);
  const running = isBatchTableRunActive(String(node.id)) || (Boolean(table.runState?.running) && table.rows.some((row) => {
    const status = nodeById(row.outputNodeId)?.status;
    return status === 'running' || status === 'queued';
  }));
  const connectedIds = new Set(columns.flat());
  const cellReferenceIds = new Set(table.rows.flatMap(row => row.referenceNodeIds).filter(Boolean));
  for (const id of cellReferenceIds) {
    if (!connectedIds.has(id) && isCanvasImageNode(id)) connectedIds.add(id);
  }
  const connected = connectedIds.size;
  const readyRows = table.rows.filter((row, index) => batchRowCanRun(table, row, batchRowColumnReferences(columns, index)));
  const unfinished = readyRows.filter((row) => {
    const output = nodeById(row.outputNodeId);
    return output?.status !== 'completed';
  });
  const completed = table.rows.filter((row) => outputState(row).tone === 'good').length;
  const expandedRow = table.rows.find((row) => row.id === expandedRowId);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const start = dragStart.current;
      if (!start || start.pointerId !== event.pointerId) return;
      if (!draggingRef.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      if (!draggingRef.current) {
        draggingRef.current = { rowId: start.rowId, column: start.column };
        suppressClick.current = true;
        setDraggingCell(draggingRef.current);
      }
    };
    const handleUp = (event: PointerEvent) => {
      const start = dragStart.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const source = draggingRef.current;
      if (source) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-batch-cell]');
        const targetRowId = target?.dataset.rowId;
        const targetColumn = Number(target?.dataset.columnIndex);
        if (target?.closest<HTMLElement>('[data-batch-table]')?.dataset.batchTable === node.id
          && targetRowId && Number.isInteger(targetColumn)) {
          moveBatchCell(String(node.id), source.rowId, source.column, targetRowId, targetColumn);
        }
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }
      dragStart.current = null;
      draggingRef.current = null;
      setDraggingCell(null);
    };
    const cancel = () => {
      dragStart.current = null;
      draggingRef.current = null;
      suppressClick.current = false;
      setDraggingCell(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [node.id]);

  function setCell(row: BatchRow, column: number, value: string) {
    const columnId = table.columns[column]?.id;
    if (columnId) setBatchCellReference(node.id, row.id, columnId, value);
  }

  function addRow() {
    appendBatchRow(String(node.id));
  }

  function fillRows() {
    modal.confirm({
      title: t('canvas.batch.fillConfirmTitle'),
      content: t('canvas.batch.fillConfirmBody'),
      okText: t('canvas.batch.fillConfirmOk'),
      cancelText: t('canvas.batch.cancel'),
      onOk: () => {
        const count = fillBatchRowsFromColumns(String(node.id));
        if (count) actions.notify(t('canvas.batch.fillDone', { count }));
      },
    });
  }

  const label = (
    <div className={`work-node-kicker${data.title ? '' : ' unlabeled'}`}>
      {data.title ? <IconSymbol className="work-node-type-icon" name="table" aria-hidden="true" /> : null}
      {data.title ? <span className="work-node-title nodrag nopan" title={String(data.title)}>{String(data.title)}</span> : null}
    </div>
  );

  const gridTemplateColumns = `80px repeat(${table.columns.length}, 84px) minmax(240px, 1fr) 84px 100px`;

  return (
    <div
      className={`batch-table-node${selected ? ' selected' : ''}`}
      data-batch-table={node.id}
      onClick={(event) => { event.stopPropagation(); actions.select(String(node.id)); }}
    >
      {labelRoot ? createPortal(label, labelRoot) : null}
      {table.columns.map((column, index) => (
        <Handle
          key={column.id}
          id={batchColumnHandle(column.id)}
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          className="batch-column-handle nodrag nopan"
          style={{ top: 139 + index * 40 }}
          title={t('canvas.batch.columnHandle', { index: index + 1 })}
        >
          <span>{index + 1}</span>
        </Handle>
      ))}
      <div className="batch-table-toolbar nowheel">
        <Segmented
          size="small"
          value={table.operation}
          options={[
            { value: 'try_on', label: t('canvas.batch.operation.tryOn') },
            { value: 'creative', label: t('canvas.batch.operation.creative') },
          ]}
          onChange={(value) => setBatchOperation(String(node.id), value as 'try_on' | 'creative')}
        />
        <div className="batch-concurrency">
          <span className="batch-table-label">{t('canvas.batch.concurrency')}</span>
          <Segmented
            size="small"
            value={table.concurrency}
            options={BATCH_CONCURRENCY_OPTIONS.map((value) => ({ value, label: String(value) }))}
            onChange={(value) => setBatchTableSettings(String(node.id), { concurrency: Number(value) })}
          />
        </div>
        <div className="batch-ref-count">
          <span>{t('canvas.batch.referenceCountMax', { count: table.columns.length, max: MAX_BATCH_REFERENCE_COLUMNS })}</span>
          <Button type="text" size="small" icon={<IconSymbol name="minus" />} aria-label={t('canvas.batch.removeColumn')}
            title={t('canvas.batch.removeColumn')} disabled={table.columns.length <= 1} onClick={() => deleteBatchColumn(String(node.id))} />
          <Button type="text" size="small" icon={<IconSymbol name="plus" />} aria-label={t('canvas.batch.addColumn')}
            title={t('canvas.batch.addColumn')} disabled={table.columns.length >= MAX_BATCH_REFERENCE_COLUMNS} onClick={() => appendBatchColumn(String(node.id))} />
        </div>
        <span className="batch-connection-stat">{t('canvas.batch.connectionStat', { connected, completed, total: table.rows.length })}</span>
        <span className="batch-table-spacer" />
        <Button size="small" icon={<IconSymbol name="table" />} onClick={fillRows}>{t('canvas.batch.fillByColumns')}</Button>
        <Tooltip title={t('canvas.batch.runUnfinishedHint')}>
          <Button
            size="small"
            type="primary"
            disabled={!unfinished.length || running}
            loading={running}
            icon={<IconSymbol name="play" />}
            onClick={() => setGenerationRequest({})}
          >
            {t('canvas.batch.runUnfinished', { count: unfinished.length })}
          </Button>
        </Tooltip>
        {running ? <Button size="small" danger icon={<IconSymbol name="stop" />} onClick={() => cancelBatchTableRun(String(node.id))}>{t('canvas.batch.stop')}</Button> : null}
      </div>
      <div className="batch-global">
        <div className="batch-global-head">
          <strong>{t('canvas.batch.globalPrompt')}</strong>
          <span className="batch-global-badge">{table.globalPrompt.trim() ? t('canvas.batch.globalOverride') : t('canvas.batch.globalOff')}</span>
          <span className="batch-global-hint">
            {table.operation === 'try_on' ? t('canvas.batch.tryOnHint') : t('canvas.batch.creativeHint')}
          </span>
        </div>
        <Input
          value={table.globalPrompt}
          size="small"
          placeholder={t('canvas.batch.globalPlaceholder')}
          aria-label={t('canvas.batch.globalPrompt')}
          onChange={(event) => setBatchTableSettings(String(node.id), { globalPrompt: event.target.value })}
          allowClear
        />
      </div>
      <div className="batch-table-scroll nowheel" ref={scrollRef} onScroll={() => updateNodeInternals(node.id)}>
        <div className="batch-table-grid" ref={gridRef} style={{ gridTemplateColumns }}>
          <span className="batch-table-head-cell batch-table-head-number">{t('canvas.batch.taskColumn')}</span>
          {table.columns.map((column) => (
            <span
              className="batch-table-head-cell batch-table-column-head"
              key={column.id}
              draggable
              title={t('canvas.batch.reorderColumn')}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/x-shotloom-batch-column', column.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('text/x-shotloom-batch-column')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                const from = event.dataTransfer.getData('text/x-shotloom-batch-column');
                if (!from || from === column.id) return;
                event.preventDefault();
                moveBatchColumn(String(node.id), from, column.id);
              }}
            >{column.label}</span>
          ))}
          <span className="batch-table-head-cell">{t('canvas.batch.promptColumn')}</span>
          <span className="batch-table-head-cell">{t('canvas.batch.outputColumn')}</span>
          <span className="batch-table-head-cell">{t('canvas.batch.actionsColumn')}</span>
          {table.rows.length ? table.rows.map((row, index) => {
            const status = outputState(row);
            const defaults = batchRowColumnReferences(columns, index);
            const refs = batchRowReferences(row, defaults);
            const ready = batchRowCanRun(table, row, defaults);
            return (
              <div className="batch-table-row-group" data-disabled={!row.enabled || undefined} key={row.id}>
                <div className="batch-table-cell batch-table-index">
                  <div className="batch-task-toggle">
                    <Switch
                      size="small"
                      checked={row.enabled}
                      aria-label={t('canvas.batch.enableRow', { index: index + 1 })}
                      onChange={(enabled) => patchBatchRow(String(node.id), row.id, { enabled })}
                    />
                    <span>{index + 1}</span>
                  </div>
                </div>
                {table.columns.map((column, columnIndex) => {
                  const refId = refs[columnIndex] || '';
                  const rowOverride = Boolean(row.referenceNodeIds[columnIndex]);
                  return (
                    <div key={column.id} className="batch-table-cell batch-table-ref-cell">
                      <div className="batch-reference-slot" data-batch-cell data-row-id={row.id} data-column-index={columnIndex}>
                        <button
                          type="button"
                          className={`batch-table-ref${rowOverride ? ' is-row' : refId ? ' is-linked' : ''}${draggingCell?.rowId === row.id && draggingCell.column === columnIndex ? ' is-dragging' : ''}`}
                          onClick={() => {
                            if (suppressClick.current) { suppressClick.current = false; return; }
                            setPicker({ rowId: row.id, column: columnIndex });
                          }}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            dragStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, rowId: row.id, column: columnIndex };
                          }}
                          title={refId ? t('canvas.batch.replaceReference') : t('canvas.batch.pickReference')}
                        >
                          {refId ? <NodeThumb nodeId={refId} className="batch-thumb" empty="+" /> : <IconSymbol name="upload" className="batch-table-ref-empty" />}
                        </button>
                        <button
                          className="batch-reference-mention"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            const token = t('canvas.batch.mentionToken', { index: columnIndex + 1 });
                            patchBatchRow(String(node.id), row.id, { prompt: `${row.prompt}${row.prompt && !row.prompt.endsWith(' ') ? ' ' : ''}${token}` });
                          }}
                        >@{t('canvas.batch.referenceIndex', { index: columnIndex + 1 })}</button>
                        <Handle
                          id={batchCellHandle(row.id, column.id)}
                          type="target"
                          position={Position.Left}
                          isConnectableStart={false}
                          className="batch-cell-handle nodrag nopan"
                          title={t('canvas.batch.cellHandle', { row: index + 1, column: columnIndex + 1 })}
                          onClick={event => {
                            event.stopPropagation();
                            setPicker({ rowId: row.id, column: columnIndex });
                          }}
                        />
                        {rowOverride ? (
                          <button
                            type="button"
                            className="batch-ref-clear"
                            aria-label={t('canvas.batch.clearReference')}
                            onClick={(event) => { event.stopPropagation(); setCell(row, columnIndex, ''); }}
                            ><IconSymbol name="x" /></button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <span className="batch-table-cell batch-table-prompt">
                  <Input.TextArea
                    value={row.prompt}
                    autoSize={{ minRows: 3, maxRows: 5 }}
                    placeholder={table.globalPrompt.trim() ? t('canvas.batch.rowPromptMuted') : t('canvas.batch.promptPlaceholder', { index: index + 1 })}
                    onChange={(event) => patchBatchRow(String(node.id), row.id, { prompt: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready && !running) {
                        event.preventDefault();
                        setGenerationRequest({ rowIds: [row.id], force: true });
                      }
                    }}
                  />
                </span>
                <span className="batch-table-cell batch-table-output">
                  <button
                    type="button"
                    className={`batch-output tone-${status.tone}`}
                    onClick={() => {
                      const output = nodeById(row.outputNodeId);
                      if (output) { selectNode(String(output.id)); actions.select(String(output.id)); }
                    }}
                    disabled={!row.outputNodeId}
                    aria-label={status.label}
                    title={status.label}
                  >
                    {row.outputNodeId ? <NodeThumb nodeId={row.outputNodeId} className="batch-output-thumb" /> : <IconSymbol name="image" />}
                    <span className="batch-output-status" aria-hidden="true" />
                  </button>
                </span>
                <span className="batch-table-cell batch-table-actions">
                  <Tooltip title={status.tone === 'warn' ? status.label
                    : !row.enabled ? t('canvas.batch.enableRow', { index: index + 1 })
                    : ready ? t('canvas.batch.runRow') : t('canvas.batch.rowNotReady', { count: minimumBatchReferences(table.operation) })}>
                    <Button
                      size="small"
                      type={status.tone === 'good' ? 'text' : 'primary'}
                      loading={status.tone === 'warn'}
                      icon={<IconSymbol name="play" />}
                      disabled={!ready || running}
                      aria-label={t('canvas.batch.runRow')}
                      onClick={() => setGenerationRequest({ rowIds: [row.id], force: true })}
                    />
                  </Tooltip>
                  <Button size="small" type="text" danger aria-label={t('canvas.batch.removeRow')} onClick={() => deleteBatchRow(String(node.id), row.id)}><IconSymbol name="trash" /></Button>
                  <Dropdown trigger={['click']} menu={{ items: [
                    { key: 'up', label: t('canvas.storyboard.moveUp'), disabled: index === 0, onClick: () => reorderBatchRow(String(node.id), row.id, -1) },
                    { key: 'down', label: t('canvas.storyboard.moveDown'), disabled: index === table.rows.length - 1, onClick: () => reorderBatchRow(String(node.id), row.id, 1) },
                  ] }}>
                    <Button size="small" type="text" aria-label={t('canvas.batch.actionsColumn')} icon={<IconSymbol name="more" />} />
                  </Dropdown>
                </span>
                <div className="batch-insert-row">
                  <Button size="small" type="text" icon={<IconSymbol name="plus" />}
                    aria-label={t('canvas.batch.insertAfter', { index: index + 1 })}
                    title={t('canvas.batch.insertAfter', { index: index + 1 })}
                    disabled={!canAddRow}
                    onClick={() => appendBatchRow(String(node.id), row.id)} />
                </div>
                <div className="batch-prompt-foot">
                  <span>{table.globalPrompt.trim() ? t('canvas.batch.globalActiveHint') : t('canvas.batch.rowPromptHint')}</span>
                  <button type="button" aria-label={t('canvas.batch.expandPrompt')} onClick={() => setExpandedRowId(row.id)}>
                    <IconSymbol name="maximize" /> {t('canvas.batch.expandPrompt')}
                  </button>
                </div>
              </div>
            );
          }) : (
            <>
              {Array.from({ length: 8 }, (_, index) => (
                <div className="batch-table-row-group batch-table-row-placeholder" key={`placeholder-${index}`}>
                  <span className="batch-table-cell batch-table-index">{index + 1}</span>
                  {table.columns.map((column) => <span className="batch-table-cell" key={column.id} />)}
                  <span className="batch-table-cell" />
                  <span className="batch-table-cell" />
                  <span className="batch-table-cell" />
                </div>
              ))}
              <div className="batch-table-empty">
                <span className="batch-table-empty-icon"><IconSymbol name="table" /></span>
                <strong>{t('canvas.batch.emptyTitle')}</strong>
                <span>{t('canvas.batch.emptyBody')}</span>
                <Button type="primary" onClick={addRow}>{t('canvas.batch.addFirst')}</Button>
              </div>
            </>
          )}
          {table.rows.length ? (
            <div className="batch-add-row-bar">
              <Button block type="dashed" icon={<IconSymbol name="plus" />} disabled={!canAddRow} onClick={addRow}>{t('canvas.batch.addRow')}</Button>
            </div>
          ) : null}
        </div>
      </div>
      {table.runState ? (
        <div className="batch-table-foot">
          <span className={table.runState.cancelled ? 'status-muted' : running ? 'status-warn' : 'status-good'}>
            {running
              ? t('canvas.batch.progress', { done: table.runState.done, total: table.runState.total })
              : table.runState.cancelled ? t('canvas.batch.cancelled') : t('canvas.batch.finished', { failed: table.runState.failed })}
          </span>
        </div>
      ) : null}
      {generationRequest ? <BatchGenerationSettingsDialog
        initial={data.batchGenerationSettings as BatchGenerationSettings}
        count={generationRequest.rowIds?.length || unfinished.length}
        concurrency={table.concurrency}
        onClose={() => setGenerationRequest(null)}
        onConfirm={(settings) => {
          data.batchGenerationSettings = settings;
          touchProject();
          const request = generationRequest;
          setGenerationRequest(null);
          void runBatchTable(String(node.id), request);
        }}
      /> : null}
      {picker ? (
        <ReferencePicker
          open
          onClose={() => setPicker(null)}
          onPick={(nodeId) => {
            const row = table.rows.find((item) => item.id === picker.rowId);
            if (row) setCell(row, picker.column, nodeId);
          }}
          onClear={() => {
            const row = table.rows.find((item) => item.id === picker.rowId);
            if (row) setCell(row, picker.column, '');
          }}
        />
      ) : null}
      <Modal
        open={Boolean(expandedRow)}
        onCancel={() => setExpandedRowId(null)}
        onOk={() => setExpandedRowId(null)}
        okText={t('canvas.batch.done')}
        cancelButtonProps={{ style: { display: 'none' } }}
        title={expandedRow ? t('canvas.batch.expandTitle', { index: table.rows.indexOf(expandedRow) + 1 }) : ''}
        destroyOnHidden
      >
        {expandedRow ? (
          <div className="batch-expanded">
            <Input.TextArea
              value={expandedRow.prompt}
              autoSize={{ minRows: 8, maxRows: 14 }}
              onChange={(event) => patchBatchRow(String(node.id), expandedRow.id, { prompt: event.target.value })}
            />
            <p>{table.globalPrompt.trim() ? t('canvas.batch.globalActiveHint') : t('canvas.batch.rowPromptHint')}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
});

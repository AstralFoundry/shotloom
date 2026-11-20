import { t } from '@/i18n';
import { memo, useContext, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Input, Modal, Segmented, Tooltip } from 'antd';
import { Handle, Position } from '@xyflow/react';
import { store } from '../../store/projectStore';
import { selectNode } from '../../store/nodeStore';
import { getDomainRevision, subscribeDomain } from '../../store/domainReactivity';
import { NodeThumb } from './NodeThumb';
import { IconSymbol } from '../components/IconSymbol';
import { CanvasNodeLabelRootContext, type WorkflowNodeRenderer } from './WorkflowCanvas';
import {
  appendBatchColumn,
  appendBatchRow,
  batchReferenceDefaults,
  batchTableData,
  cancelBatchTableRun,
  canvasImageNodes,
  deleteBatchColumn,
  deleteBatchRow,
  fillBatchRowsFromColumns,
  patchBatchRow,
  reorderBatchRow,
  runBatchTable,
  setBatchOperation,
  setBatchTableSettings,
} from './batchTableActions';
import {
  BATCH_CONCURRENCY_OPTIONS,
  batchRowReady,
  batchRowReferences,
  batchTableSummary,
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
  const defaults = batchReferenceDefaults(String(node.id));
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const [picker, setPicker] = useState<{ rowId: string; column: number } | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const running = Boolean(table.runState?.running);
  const imageCount = (store.project.materials as AnyRecord[]).filter((material) => material.resourceType === 'image').length;
  const connected = new Set((store.project.edges as AnyRecord[])
    .filter((edge) => edge.target === node.id && nodeById(String(edge.source))?.type === 'imageGeneration')
    .map((edge) => String(edge.source))).size;
  const readyRows = table.rows.filter((row) => batchRowReady(table, row, batchRowReferences(row, defaults)));
  const unfinished = readyRows.filter((row) => {
    const output = nodeById(row.outputNodeId);
    return output?.status !== 'completed';
  });
  const completed = table.rows.filter((row) => outputState(row).tone === 'good').length;
  const expandedRow = table.rows.find((row) => row.id === expandedRowId);
  const summary = batchTableSummary(table, defaults);

  function setCell(row: BatchRow, column: number, value: string) {
    const references = [...row.referenceNodeIds];
    while (references.length < table.columns.length) references.push('');
    references[column] = value;
    patchBatchRow(String(node.id), row.id, { referenceNodeIds: references });
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

  const gridTemplateColumns = `64px repeat(${table.columns.length}, 92px) minmax(240px, 1fr) 96px 88px`;

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
          id={`batch-reference:${column.id}`}
          type="target"
          position={Position.Left}
          className="batch-column-handle"
          style={{ top: 144 + index * 40 }}
          title={t('canvas.batch.columnHandle', { index: index + 1 })}
        >
          <span>{index + 1}</span>
        </Handle>
      ))}
      <div className="batch-table-toolbar">
        <Segmented
          size="small"
          value={table.operation}
          options={[
            { value: 'try_on', label: t('canvas.batch.operation.tryOn') },
            { value: 'creative', label: t('canvas.batch.operation.creative') },
          ]}
          onChange={(value) => setBatchOperation(String(node.id), value as 'try_on' | 'creative')}
        />
        <span className="batch-table-label">{t('canvas.batch.concurrency')}</span>
        <Segmented
          size="small"
          value={table.concurrency}
          options={BATCH_CONCURRENCY_OPTIONS.map((value) => ({ value, label: String(value) }))}
          onChange={(value) => setBatchTableSettings(String(node.id), { concurrency: Number(value) })}
        />
        <div className="batch-ref-count">
          <span>{t('canvas.batch.referenceCountMax', { count: table.columns.length, max: 10 })}</span>
          <button type="button" aria-label={t('canvas.batch.removeColumn')} disabled={table.columns.length <= 1} onClick={() => deleteBatchColumn(String(node.id))}>−</button>
          <button type="button" aria-label={t('canvas.batch.addColumn')} disabled={table.columns.length >= 10} onClick={() => appendBatchColumn(String(node.id))}>+</button>
        </div>
        <span className="batch-connection-stat">{t('canvas.batch.connectionStat', { connected, completed, total: table.rows.length })}</span>
        <span className="batch-table-spacer" />
        <Button size="small" type="text" onClick={fillRows}>{t('canvas.batch.fillByColumns')}</Button>
        <Tooltip title={t('canvas.batch.runUnfinishedHint')}>
          <Button
            size="small"
            type="primary"
            disabled={!unfinished.length || running}
            loading={running}
            onClick={() => void runBatchTable(String(node.id))}
          >
            {t('canvas.batch.runUnfinished', { count: unfinished.length })}
          </Button>
        </Tooltip>
        {running ? <Button size="small" danger onClick={() => cancelBatchTableRun(String(node.id))}>{t('canvas.batch.stop')}</Button> : null}
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
          placeholder={t('canvas.batch.globalPlaceholder')}
          aria-label={t('canvas.batch.globalPrompt')}
          onChange={(event) => setBatchTableSettings(String(node.id), { globalPrompt: event.target.value })}
          allowClear
        />
      </div>
      <div className="batch-table-scroll">
        <div className="batch-table-grid" style={{ gridTemplateColumns }}>
          <span className="batch-table-head-cell batch-table-head-number">#</span>
          {table.columns.map((column) => (
            <span className="batch-table-head-cell" key={column.id}>{column.label}</span>
          ))}
          <span className="batch-table-head-cell">{t('canvas.batch.promptColumn')}</span>
          <span className="batch-table-head-cell">{t('canvas.batch.outputColumn')}</span>
          <span className="batch-table-head-cell">{t('canvas.batch.actionsColumn')}</span>
          {table.rows.length ? table.rows.map((row, index) => {
            const status = outputState(row);
            const refs = batchRowReferences(row, defaults);
            const ready = batchRowReady(table, row, refs);
            return (
              <div className="batch-table-row-group" key={row.id}>
                <span className="batch-table-cell batch-table-index">{index + 1}</span>
                {table.columns.map((column, columnIndex) => {
                  const refId = refs[columnIndex] || '';
                  const rowOverride = Boolean(row.referenceNodeIds[columnIndex]);
                  return (
                    <span key={column.id} className="batch-table-cell batch-table-ref-cell">
                      <button
                        type="button"
                        className={`batch-table-ref${rowOverride ? ' is-row' : refId ? ' is-linked' : ''}`}
                        onClick={() => setPicker({ rowId: row.id, column: columnIndex })}
                        title={refId ? t('canvas.batch.replaceReference') : t('canvas.batch.pickReference')}
                      >
                        {refId ? <NodeThumb nodeId={refId} className="batch-thumb" empty="+" /> : <span className="batch-table-ref-empty">+</span>}
                        {!rowOverride && refId ? <i>{t('canvas.batch.linked')}</i> : null}
                      </button>
                      {refId ? (
                        <button
                          type="button"
                          className="batch-ref-clear"
                          aria-label={t('canvas.batch.clearReference')}
                          onClick={(event) => { event.stopPropagation(); setCell(row, columnIndex, ''); }}
                        >×</button>
                      ) : null}
                    </span>
                  );
                })}
                <span className="batch-table-cell batch-table-prompt">
                  <Input.TextArea
                    value={row.prompt}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder={table.globalPrompt.trim() ? t('canvas.batch.rowPromptMuted') : t('canvas.batch.promptPlaceholder', { index: index + 1 })}
                    onChange={(event) => patchBatchRow(String(node.id), row.id, { prompt: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready && !running) {
                        event.preventDefault();
                        void runBatchTable(String(node.id), { rowIds: [row.id], force: true });
                      }
                    }}
                  />
                  <div className="batch-prompt-foot">
                    <span>{table.globalPrompt.trim() ? t('canvas.batch.globalActiveHint') : t('canvas.batch.rowPromptHint')}</span>
                    <button type="button" aria-label={t('canvas.batch.expandPrompt')} onClick={() => setExpandedRowId(row.id)}>
                      {t('canvas.batch.expandPrompt')}
                    </button>
                  </div>
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
                  >
                    {row.outputNodeId ? <NodeThumb nodeId={row.outputNodeId} className="batch-output-thumb" /> : null}
                    <em>{status.label}</em>
                  </button>
                </span>
                <span className="batch-table-cell batch-table-actions">
                  <Tooltip title={ready ? t('canvas.batch.runRow') : t('canvas.batch.rowNotReady', { count: minimumBatchReferences(table.operation) })}>
                    <Button
                      size="small"
                      type={status.tone === 'good' ? 'text' : 'primary'}
                      disabled={!ready || running}
                      onClick={() => void runBatchTable(String(node.id), { rowIds: [row.id], force: true })}
                    ><IconSymbol name="play" /></Button>
                  </Tooltip>
                  <Button size="small" onClick={() => reorderBatchRow(String(node.id), row.id, -1)} disabled={index === 0}>↑</Button>
                  <Button size="small" onClick={() => reorderBatchRow(String(node.id), row.id, 1)} disabled={index === table.rows.length - 1}>↓</Button>
                  <Button size="small" type="text" danger onClick={() => deleteBatchRow(String(node.id), row.id)}><IconSymbol name="trash" /></Button>
                </span>
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
        </div>
      </div>
      <div className="batch-table-foot">
        <span>{t('canvas.batch.summary', { total: summary.total, enabled: summary.enabled })}</span>
        {table.runState ? (
          <span className={table.runState.cancelled ? 'status-muted' : table.runState.running ? 'status-warn' : 'status-good'}>
            {table.runState.running
              ? t('canvas.batch.progress', { done: table.runState.done, total: table.runState.total })
              : table.runState.cancelled ? t('canvas.batch.cancelled') : t('canvas.batch.finished', { failed: table.runState.failed })}
          </span>
        ) : null}
        <span className="batch-table-foot-note">{t('canvas.batch.imagesInProject', { count: imageCount })}</span>
      </div>
      {table.rows.length ? (
        <div className="batch-add-row-bar">
          <Button type="text" onClick={addRow}>+ {t('canvas.batch.addRow')}</Button>
        </div>
      ) : null}
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

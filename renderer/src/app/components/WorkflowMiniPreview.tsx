/**
 * 工作流的小型画布预览：节点按真实位置缩放，连线用 SVG 画出。
 * 管理页列表与放大预览共用。
 */
import { t } from '@/i18n';
import { layoutWorkflowPreview } from '@/domain/workflow/miniPreview';
import type { WorkflowSnapshotEdge, WorkflowSnapshotNode } from '@/domain/workflow/snapshot';

function NodeGlyph({ kind }: { kind: string }) {
  return <span className="workflow-mini-glyph">{kind === 'video' ? '▶' : kind === 'audio' ? '♫' : kind === 'text' ? 'T' : '▧'}</span>;
}

export function WorkflowMiniPreview({
  nodes,
  edges,
  width = 320,
  height = 170,
  onExpand,
}: {
  nodes: WorkflowSnapshotNode[];
  edges: WorkflowSnapshotEdge[];
  width?: number;
  height?: number;
  onExpand?: () => void;
}) {
  const layout = layoutWorkflowPreview(nodes, edges, { width, height });
  if (!layout.nodes.length) return null;
  return (
    <div
      className={`workflow-mini${onExpand ? ' workflow-mini--clickable' : ''}`}
      style={{ width, height }}
      role={onExpand ? 'button' : undefined}
      tabIndex={onExpand ? 0 : undefined}
      title={onExpand ? t('workflows.previewExpand') : undefined}
      onClick={onExpand}
      onKeyDown={(event) => {
        if (!onExpand) return;
        if (event.key === 'Enter' || event.key === ' ') onExpand();
      }}
    >
      <svg className="workflow-mini-edges" width={width} height={height} aria-hidden="true">
        {layout.edges.map((edge) => (
          <path
            key={edge.id}
            d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + 24} ${edge.y1}, ${edge.x2 - 24} ${edge.y2}, ${edge.x2} ${edge.y2}`}
          />
        ))}
      </svg>
      {layout.nodes.map((node) => (
        <div
          key={node.id}
          className={`workflow-mini-node workflow-mini-node--${node.kind}`}
          style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
          title={node.title}
        >
          {node.preview?.dataUrl
            ? <img src={node.preview.dataUrl} alt="" className="workflow-mini-thumb" />
            : <NodeGlyph kind={node.kind} />}
          {node.width >= 104 && node.height >= 62 && (
            <span className="workflow-mini-label">{node.preview?.label || node.title}</span>
          )}
        </div>
      ))}
    </div>
  );
}

import { useMemo } from 'react';
import { ReactFlow, Controls, type NodeProps, type Node, Handle, Position } from '@xyflow/react';
import { t } from '@/i18n';
import { canvasNodeDimensions } from '../../domain/graph/CanvasNodeDimensions';
import { nodeTypes } from '../constants/navigation';
import { useMediaPreviewCache } from '../canvas/useMediaPreviewCache';
import { createNodeMediaCatalog, localMediaPath } from '../../utils/nodeMedia';
import '@xyflow/react/dist/style.css';

type SnapshotNode = Node<{ title: string; text: string; imagePath: string; imageUrl: string; kind: string }>;
function SnapshotCard({ data }: NodeProps<SnapshotNode>) {
  const { url } = useMediaPreviewCache({ path: data.imagePath, kind: 'image', maxSize: 350, fallbackUrl: data.imageUrl });
  return <div className="snapshot-canvas-card">
    <Handle type="target" position={Position.Left} />
    <strong>{data.title}</strong><small>{data.kind}</small>
    {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <p>{data.text}</p>}
    <Handle type="source" position={Position.Right} />
  </div>;
}
const types = { snapshot: SnapshotCard };
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Snapshot-only projection: never use current nodes, generation actions, or live media selection. */
export function snapshotCanvasGraph(payload: Record<string, unknown>) {
    const records = (Array.isArray(payload.nodes) ? payload.nodes : []).map(asRecord).filter(node => node.id && !node.archived);
    const catalog = createNodeMediaCatalog({ nodes: records, materials: (Array.isArray(payload.materials) ? payload.materials : []).map(asRecord) });
    const nodes: SnapshotNode[] = records.map(node => {
      const type = String(node.type || '');
      const media = catalog.selected(node);
      const image = type === 'imageGeneration' || String(node.resourceType || media.resourceType || '').includes('image');
      const size = canvasNodeDimensions({ ...node, type });
      return { id: String(node.id), type: 'snapshot', position: { x: Number(node.x) || 0, y: Number(node.y) || 0 },
        style: size, width: size.width, height: size.height, zIndex: type === 'canvasSection' ? -1 : 0,
        data: { title: String(node.title || node.name || type), kind: nodeTypes.find(item => item.id === type)?.label || type,
          text: String(node.textContent || media.content || node.prompt || '').slice(0, 1000),
          imagePath: image ? localMediaPath(media) : '',
          imageUrl: image ? String(media.previewUrl || media.url || media.content || '') : '' } };
    });
    const ids = new Set(nodes.map(node => node.id));
    const edges = (Array.isArray(payload.edges) ? payload.edges : []).map(asRecord)
      .filter(edge => ids.has(String(edge.source)) && ids.has(String(edge.target)))
      .map(edge => ({ id: String(edge.id), source: String(edge.source), target: String(edge.target) }));
    return { nodes, edges };
}

export function ProjectSnapshotCanvas({ payload }: { payload: Record<string, unknown> }) {
  const graph = useMemo(() => snapshotCanvasGraph(payload), [payload]);
  return <div className="snapshot-canvas" aria-label={t('project.version.canvasPreview')}>
    <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={types} fitView minZoom={0.02} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null}
      onlyRenderVisibleElements proOptions={{ hideAttribution: true }}>
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}

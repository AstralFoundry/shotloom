/**
 * 工作流模板的小型画布布局：把快照节点按真实位置等比缩放进一个盒子，
 * 并算出连线端点。纯函数，管理页与预览弹窗共用。
 */
import type { WorkflowSnapshotEdge, WorkflowSnapshotNode } from './snapshot';
import type { WorkflowNodePreview } from './types';

export interface MiniPreviewNode {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: WorkflowNodePreview['kind'];
  preview?: WorkflowNodePreview | undefined;
}

export interface MiniPreviewEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MiniPreviewLayout {
  nodes: MiniPreviewNode[];
  edges: MiniPreviewEdge[];
  scale: number;
}

function nodeKind(node: WorkflowSnapshotNode): WorkflowNodePreview['kind'] {
  const type = String(node.type || '');
  if (type === 'videoGeneration') return 'video';
  if (type === 'audioGeneration') return 'audio';
  if (type === 'textGeneration') return 'text';
  return 'image';
}

export function layoutWorkflowPreview(
  nodes: WorkflowSnapshotNode[],
  edges: WorkflowSnapshotEdge[],
  { width, height, padding = 10 }: { width: number; height: number; padding?: number },
): MiniPreviewLayout {
  if (!nodes.length) return { nodes: [], edges: [], scale: 1 };
  const sized = nodes.map((node) => ({
    node,
    width: Math.max(60, Number(node.canvasWidth) || 320),
    height: Math.max(40, Number(node.canvasHeight) || 180),
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
  }));
  const minX = Math.min(...sized.map((item) => item.x));
  const minY = Math.min(...sized.map((item) => item.y));
  const maxX = Math.max(...sized.map((item) => item.x + item.width));
  const maxY = Math.max(...sized.map((item) => item.y + item.height));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY, 1);

  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  const layoutNodes: MiniPreviewNode[] = sized.map((item) => {
    const w = Math.max(8, Math.round(item.width * scale));
    const h = Math.max(8, Math.round(item.height * scale));
    const x = Math.round(padding + (item.x - minX) * scale);
    const y = Math.round(padding + (item.y - minY) * scale);
    placed.set(String(item.node.id), { x, y, w, h });
    return {
      id: String(item.node.id),
      title: String(item.node.title || item.node.id),
      x,
      y,
      width: w,
      height: h,
      kind: nodeKind(item.node),
      preview: item.node.preview,
    };
  });

  const layoutEdges: MiniPreviewEdge[] = [];
  for (const [index, edge] of edges.entries()) {
    const from = placed.get(String(edge.source));
    const to = placed.get(String(edge.target));
    if (!from || !to) continue;
    layoutEdges.push({
      id: `${edge.source}->${edge.target}:${index}`,
      x1: from.x + from.w,
      y1: from.y + Math.round(from.h / 2),
      x2: to.x,
      y2: to.y + Math.round(to.h / 2),
    });
  }

  return { nodes: layoutNodes, edges: layoutEdges, scale };
}

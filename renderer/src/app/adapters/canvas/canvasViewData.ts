import { batchCellEdgeId, batchCellHandle, batchColumnInputs, batchRowColumnReferences, normalizeBatchTable } from '@/domain/graph/BatchTable';
import { createNodeMediaCatalog } from "../../../utils/nodeMedia.ts";
import { canRedoCanvas, canUndoCanvas } from "../../../store/canvasHistoryStore.ts";
import { getAvailableModelIdsByType } from "../../../store/settingsStore.ts";
import type { WorkflowNodeData } from "../../canvas/WorkflowCanvas";

const canvasViewNodeCache = new Map<string, { signature: string; node: WorkflowNodeData }>();

export function buildCanvasViewData(store: any) {
  const selected = new Set(
    store.selectedNodeIds?.length
      ? store.selectedNodeIds
      : store.selectedNodeId
        ? [store.selectedNodeId]
        : [],
  );
  const media = createNodeMediaCatalog(store.project);
  const availableModelsByType = new Map<string, string[]>();
  const nodes = (store.project.nodes || [])
    .filter((node: WorkflowNodeData) => node.type !== "resource")
    .map((node: any) => {
      const current = media.selected(node);
      const generatedOutputs = media.outputs(node).map((item) => ({
        ...item,
        selected: item.id === current.id,
      }));
      const viewNode = {
        ...node,
        generatedOutputs,
        availableModels: /Generation$/.test(node.type)
          ? availableModelsByType.get(node.type) ||
            (() => {
              const models = getAvailableModelIdsByType(node.type);
              availableModelsByType.set(node.type, models);
              return models;
            })()
          : [],
        selected: selected.has(node.id),
      };
      const signature = JSON.stringify(viewNode);
      const cached = canvasViewNodeCache.get(node.id);
      if (cached?.signature === signature) return cached.node;
      canvasViewNodeCache.set(node.id, { signature, node: viewNode });
      return viewNode;
    });
  const liveNodeIds = new Set(nodes.map((node: WorkflowNodeData) => node.id));
  for (const id of canvasViewNodeCache.keys()) {
    if (!liveNodeIds.has(id)) canvasViewNodeCache.delete(id);
  }
  const edges = store.project.edges || [];
  const batchNodes = nodes.filter((node: WorkflowNodeData) => node.type === 'batchTable' && !node.archived);
  const referenceIds = new Set(batchNodes.length ? nodes.filter((node: WorkflowNodeData) => {
    if (node.type !== 'imageGeneration' || node.archived) return false;
    const selectedMedia = media.selected(node);
    return Boolean(selectedMedia.filePath || selectedMedia.path || selectedMedia.previewUrl || selectedMedia.url);
  }).map((node: WorkflowNodeData) => node.id) : []);
  const cellEdges = batchNodes.flatMap((node: WorkflowNodeData) => {
    const table = normalizeBatchTable(node.batchTable);
    const columns = batchColumnInputs(table, edges, node.id, id => referenceIds.has(id));
    return table.rows.flatMap((row, rowIndex) => {
      const defaults = batchRowColumnReferences(columns, rowIndex);
      return table.columns.flatMap((column, index) => {
        const source = row.referenceNodeIds[index];
        if (!source || source === defaults[index] || !referenceIds.has(source)) return [];
        return [{
          id: batchCellEdgeId(node.id, row.id, column.id),
          source,
          target: node.id,
          targetHandle: batchCellHandle(row.id, column.id),
          data: { batchCell: true, skipTaskInput: true, creationSource: "manual" },
        }];
      });
    });
  });
  return {
    nodes,
    edges: cellEdges.length ? [...edges, ...cellEdges] : edges,
    selectedEdgeId: store.selectedEdgeId,
    viewport: store.project.canvasViewport || { x: 0, y: 0, zoom: 1 },
    history: {
      canUndo: Boolean(canUndoCanvas.value),
      canRedo: Boolean(canRedoCanvas.value),
    },
  };
}

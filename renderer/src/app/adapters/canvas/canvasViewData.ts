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
  return {
    nodes,
    edges: store.project.edges || [],
    viewport: store.project.canvasViewport || { x: 0, y: 0, zoom: 1 },
    history: {
      canUndo: Boolean(canUndoCanvas.value),
      canRedo: Boolean(canRedoCanvas.value),
    },
  };
}

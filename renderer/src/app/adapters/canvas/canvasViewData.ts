import { canRedoCanvas, canUndoCanvas } from "../../../store/canvasHistoryStore.js";
import { getAvailableModelIdsByType } from "../../../store/settingsStore.js";
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
  const materialsByNode = new Map<string, any[]>();
  for (const material of store.project.materials || []) {
    const nodeId = String(material.nodeId || "");
    if (!nodeId) continue;
    const items = materialsByNode.get(nodeId) || [];
    items.push(material);
    materialsByNode.set(nodeId, items);
  }
  const legacyBySource = new Map<string, any[]>();
  for (const item of store.project.nodes || []) {
    if (item.type !== "resource" || item.archived || !item.generatedFrom?.nodeId) continue;
    const sourceId = String(item.generatedFrom.nodeId);
    const items = legacyBySource.get(sourceId) || [];
    items.push(item);
    legacyBySource.set(sourceId, items);
  }
  const availableModelsByType = new Map<string, string[]>();
  const nodes = (store.project.nodes || [])
    .filter((node: WorkflowNodeData) => node.type !== "resource")
    .map((node: any) => {
      const direct = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
      const materials = (materialsByNode.get(node.id) || []).map((item: any) => ({
        ...item,
        id: `material:${item.id}`,
        title: item.name,
        fileName: item.name,
        filePath: item.filePath || item.path,
      }));
      const legacy = legacyBySource.get(node.id) || [];
      const seen = new Set<string>();
      const generatedOutputs = [...direct, ...materials, ...legacy]
        .filter((item: any) => {
          const key = String(item.id || item.filePath || item.path || "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((item: any, index: number, items: any[]) => ({
          ...item,
          selected: node.selectedOutputNodeId
            ? String(item.id) === String(node.selectedOutputNodeId)
            : index === items.length - 1,
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

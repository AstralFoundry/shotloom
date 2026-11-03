import { t } from '@/i18n';
import { uid } from "../../../utils/format.ts";
import { editorCanvasCandidate, resolveEditorMediaAsset } from "../../../services/editorMediaCatalog.ts";
import { buildAssetPayload } from "../../editor/openReel/projectBridge.ts";
import type { VideoEditorIntent } from "../../editor/openReel/types";
import { recordCanvasHistory } from "../../../store/canvasHistoryStore.ts";
import { addNode, setSelectedNodeIds } from "../../../store/nodeStore.ts";
import { registerImportedMaterial } from "../../../store/assetStore.ts";
import { addCanvasEdge } from "../../../store/canvasGraphStore.ts";
import { canvasNodeDimensions } from "../../../services/agentLayoutService";
import { store, touchProject } from "../../../store/projectStore.ts";
import { createVideoEditorProject, appendEditorMediaAsset } from "../../../utils/videoEditorProject.ts";
import { showToast } from "../../../store/notificationStore";

let videoEditorOpener: ((id: string, expanded: boolean, intent?: VideoEditorIntent) => void) | null = null;

/**
 * 侧栏「视频剪辑」是独立工作台：工程存在项目级槽位 videoEditorSession，
 * 不在画布上建节点，也不进画布历史。只有导出才在画布落一个视频节点。
 */
import { WORKSPACE_VIDEO_EDITOR_ID } from '../../../services/videoEditorSession';
export { WORKSPACE_VIDEO_EDITOR_ID };

export function workspaceVideoEditorNode() {
  const session = (store.project.videoEditorSession || null) as Record<string, any> | null;
  return {
    id: WORKSPACE_VIDEO_EDITOR_ID,
    type: "videoEditorWorkspace",
    title: String(session?.title || t("ui.videoEditorActions.text.801f1d23")),
    x: 80,
    y: 80,
    videoEditProject: session?.project || null,
    videoEdit: { dirty: Boolean(session?.dirty) },
  };
}

export function saveWorkspaceVideoEditorNode(node: Record<string, any>) {
  store.project.videoEditorSession = {
    title: String(node.title || t("ui.videoEditorActions.text.801f1d23")),
    project: node.videoEditProject || null,
    dirty: Boolean(node.videoEdit?.dirty),
  };
}

export function openWorkspaceVideoEditor() {
  const node = workspaceVideoEditorNode();
  if (!node.videoEditProject) {
    node.videoEditProject = createVideoEditorProject();
    saveWorkspaceVideoEditorNode(node);
    touchProject({ sessionDelay: 300, coalesceSession: true });
  }
  if (videoEditorOpener) videoEditorOpener(WORKSPACE_VIDEO_EDITOR_ID, true);
  else showToast(t("ui.videoEditorActions.text.8fcdad5e"));
}

export function createVideoExportNode(source: any, result: any, title: string) {
  const deliveryId = String(result?.deliveryId || "");
  if (deliveryId) {
    const existing = store.project.nodes.find((node: any) => node.generatedFrom?.nodeId === source.id && node.generatedFrom?.deliveryId === deliveryId);
    if (existing) return existing;
  }
  const before = JSON.parse(JSON.stringify({
    nodes: store.project.nodes, edges: store.project.edges, materials: store.project.materials,
    assets: store.project.assets, canvasHistory: store.project.canvasHistory, canvasRedoStack: store.project.canvasRedoStack,
    selectedNodeId: store.selectedNodeId, selectedNodeIds: store.selectedNodeIds,
  }));
  try { return createVideoExportNodeTransaction(source, result, title); }
  catch (error) {
    for (const key of ['nodes', 'edges', 'materials', 'assets', 'canvasHistory', 'canvasRedoStack']) store.project[key] = before[key];
    store.selectedNodeId = before.selectedNodeId;
    store.selectedNodeIds = before.selectedNodeIds;
    touchProject();
    throw error;
  }
}

export function registerVideoExportMaterial(result: any) {
  if (result.materialId) {
    const existing = store.project.materials.find((material: any) => material.id === result.materialId);
    if (!existing) throw new Error(t("ui.videoEditorActions.text.3a974a38"));
    return existing;
  }
  const registered = registerImportedMaterial(
    { ...result, name: result.name, filePath: result.filePath, type: "video/mp4", mimeType: "video/mp4",
      ...(result.checksum ? { checksumAlgorithm: "sha256" } : {}) },
    { resourceType: "video", sourceType: "video-editor-export", nodeType: "videoGeneration" },
  );
  if (!registered.material) throw new Error(t("ui.videoEditorActions.text.54b75900"));
  return registered.material;
}

function createVideoExportNodeTransaction(source: any, result: any, title: string) {
  const filePath = String(result?.filePath || result?.path || "");
  if (!filePath) throw new Error(t("ui.videoEditorActions.text.45e9e8a6"));
  const fileName = String(result.name || `${title}.mp4`);
  recordCanvasHistory(t("ui.videoEditorActions.text.4e42864e"));
  const material = registerVideoExportMaterial({ ...result, name: fileName, filePath });
  const output: any = addNode("videoGeneration");
  const siblings = store.project.nodes.filter((node: any) =>
    node.id !== output.id && node.generatedFrom?.nodeId === source.id && node.generatedFrom?.type === "video-editor-export"
  ).length;
  output.title = title;
  output.prompt = "";
  output.x = Math.round((Number(source.x) || 0) + canvasNodeDimensions(source).width + 80);
  output.y = Math.round((Number(source.y) || 0) + siblings * 130);
  output.materialId = material.id;
  output.resourceType = "video";
  output.sourceType = "video-editor-export";
  output.generatedFrom = { nodeId: source.id, type: "video-editor-export", ...(result.deliveryId ? { deliveryId: result.deliveryId } : {}) };
  output.uploadedFile = {
    name: fileName,
    path: filePath,
    filePath,
    type: "video/mp4",
    mimeType: "video/mp4",
    duration: Number(result.duration) || 0,
    width: Number(result.width) || 0,
    height: Number(result.height) || 0,
    fps: Number(result.fps) || 0,
    size: result.size || 0,
    materialId: material.id,
    resourceType: "video",
    source: "video-editor-export",
  };
  material.nodeId = output.id;
  const standalone = String(source?.id) === WORKSPACE_VIDEO_EDITOR_ID;
  if (standalone) {
    const spot = videoExportPosition(source, canvasNodeDimensions(output), String(output.id));
    output.x = spot.x;
    output.y = spot.y;
  } else {
    const connection = addCanvasEdge(store.project, source.id, output.id, {
      touch: false,
      kind: "derived-output",
      edge: { data: { skipTaskInput: true, derivation: "video-editor-export" } },
    });
    if (!connection.ok) throw new Error(connection.error || t("ui.videoEditorActions.text.94284bae"));
  }
  setSelectedNodeIds([output.id]);
  touchProject();
  return output;
}

export function registerVideoEditorOpener(handler: ((id: string, expanded: boolean, intent?: VideoEditorIntent) => void) | null) {
  videoEditorOpener = handler;
}

const VIDEO_EXPORT_GAP = 120;
const VIDEO_EXPORT_MAX_SHIFT = 24;

/**
 * 导出视频落在工作台右侧、垂直居中，遇到已占位的节点就沿水平方向继续让位。
 * 位置只由真实节点盒子决定，不猜画布布局。
 */
function videoExportPosition(
  source: any,
  size: { width: number; height: number },
  movingId: string,
) {
  const boxes = (store.project.nodes || [])
    .filter((node: any) => !node.archived && node.type !== "group" && String(node.id) !== movingId)
    .map((node: any) => ({
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      ...canvasNodeDimensions(node),
    }))
    .filter((box: any) => box.width > 0 && box.height > 0);
  const x = (Number(source.x) || 0) + canvasNodeDimensions(source).width + VIDEO_EXPORT_GAP;
  const y = Math.round((Number(source.y) || 0) + (canvasNodeDimensions(source).height - size.height) / 2);
  const overlaps = (left: number) => boxes.some((box: any) =>
    left < box.x + box.width && left + size.width > box.x &&
    y < box.y + box.height && y + size.height > box.y,
  );
  let placed = x;
  for (let step = 0; step < VIDEO_EXPORT_MAX_SHIFT && overlaps(placed); step += 1) {
    const blocker = boxes.find((box: any) => placed < box.x + box.width && placed + size.width > box.x);
    placed = (blocker ? blocker.x + blocker.width : placed) + VIDEO_EXPORT_GAP;
  }
  return { x: Math.round(placed), y };
}


const creatingClipNodes = new Set<string>();

/** Resolve and read the selected output before mutating the canvas. No empty node on failure. */
export async function createClipNode(sourceId: string) {
  if (creatingClipNodes.has(sourceId)) return;
  creatingClipNodes.add(sourceId);
  const owner = store.project;
  try {
    const source = owner.nodes.find((node: any) => node.id === sourceId);
    const candidate = editorCanvasCandidate(sourceId);
    if (!source || !candidate || candidate.type !== "video") throw new Error(t("ui.videoEditorActions.text.e001ba8b"));
    const asset = await resolveEditorMediaAsset(candidate);
    await buildAssetPayload(asset);
    if (store.project !== owner || !owner.nodes.includes(source)) return;
    const seeded = appendEditorMediaAsset(createVideoEditorProject({
      width: asset.width || 1920, height: asset.height || 1080,
    }), asset);
    if (!seeded.added) throw new Error(t("ui.videoEditorActions.text.12505cc9"));
    // Initial empty engine tracks must not become extra visible rows.
    seeded.project.tracks = seeded.project.tracks.filter((track) => track.clips.length);
    recordCanvasHistory(t("ui.videoEditorActions.text.7a0935e7"));
    const node: any = addNode("clipStudio");
    node.clipNodeVersion = 1;
    node.title = t("ui.videoEditorActions.text.801f1d23");
    const sourceConnectionId = uid();
    const seedClip = seeded.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === seeded.clipId);
    if (seedClip) seedClip.sourceConnectionId = sourceConnectionId;
    node.videoEditProject = seeded.project;
    const position = videoExportPosition(source, canvasNodeDimensions(node), node.id);
    Object.assign(node, position);
    const connected = addCanvasEdge(owner, sourceId, node.id, {
      id: sourceConnectionId,
      touch: false,
      edge: { data: { skipTaskInput: true, derivation: "clip-source", assetId: asset.id, clipIds: [seeded.clipId] } },
    });
    if (!connected.ok) {
      owner.nodes = owner.nodes.filter((item: any) => item.id !== node.id);
      throw new Error(connected.error);
    }
    node.clipSources = [{ edge: connected.edge, assetId: asset.id, state: "connected", used: true }];
    setSelectedNodeIds([node.id]);
    touchProject();
  } catch (error) {
    showToast(error instanceof Error ? error.message : t("ui.videoEditorActions.text.edd727cd"));
  } finally {
    creatingClipNodes.delete(sourceId);
  }
}

import { t } from '@/i18n';
import { confirmAction } from "../ui/confirm/confirmService";
import { editorCanvasCandidate } from "../../services/editorMediaCatalog";
import { localMediaPath, selectedNodeMedia } from "../../utils/nodeMedia.ts";
import { findMaterialCanvasTarget } from "./canvas/canvasMediaSelection";
import type { Connection } from "@xyflow/react";
import { canvasNodeDimensions, layoutAgentNodes } from "../../services/agentLayoutService";
import { createColoredPencilImageNode } from "../../services/coloredPencilNodeService";
// Canonical edge persistence: addCanvasEdge(store.project, connection.source, connection.target).
import { desktopApi } from "../../services/desktopApi.ts";
import {
  applyMaterialToCanvas,
  copyFileIntoProjectAssets,
  inferFileResourceType,
  registerImportedMaterial,
} from "../../store/assetStore.ts";
import { useLocalAssetInProject } from "../../store/localAssetLibraryStore.ts";
import { addCanvasEdge, wouldCreateCanvasCycle } from "../../store/canvasGraphStore.ts";
import { getGenerationInputModes } from "../../domain/catalog/ModelCatalog";
import {
  defaultInputSlot,
  isSlotValidForMode,
  reconcileGenerationInputEdges,
  type GenerationInputMode,
  type GenerationInputSlot,
} from "../../domain/graph/GenerationInputContract";
import { validateAgentInputRole } from "../../services/agentInputRole";
import { pasteStagedWorkflow, stageSelectedWorkflow } from "../../store/clipboardStore.ts";
import {
  recordCanvasHistory,
  recordCanvasHistoryState,
  recordCanvasPositionHistory,
  redoCanvas,
  undoCanvas,
} from "../../store/canvasHistoryStore.ts";
import {
  addNode,
  deleteNodeById,
  deleteSelectedNodes,
  selectNode,
  setSelectedNodeIds,
} from "../../store/nodeStore.ts";
import {
  persistCanvasViewport,
  store as rawStore,
  touchProject,
} from "../../store/projectStore.ts";
import {
  archiveResourceNode,
  connectResourceToNode,
  replaceResourceNode,
  selectGeneratedOutput,
} from "../../store/resourceNodeStore.ts";
import { runNode } from "../../store/taskStore.ts";
import { uid } from "../../utils/format.ts";
import { updatedTextVersions } from "../../utils/textNodeVersions.ts";
import { canvasSectionBounds, canvasSectionMembers } from "../../domain/graph/CanvasSections.ts";
import { showSuccessToast, showToast } from "../../store/notificationStore";
import type {
  WorkflowCanvasController,
  WorkflowNodeActions,
  WorkflowNodeData,
  WorkflowReferenceCandidate,
} from "../canvas/WorkflowCanvas";
import {
  cropImage,
  createAnnotationNode,
  createWatermarkNode,
  splitImageGrid,
  captureVideoFrame,
  extractAudio,
  saveToAssets,
} from "./canvas/canvasMediaActions";
import { buildCanvasViewData } from "./canvas/canvasViewData";
import { createUploadedNode } from "./canvas/canvasUploadActions";
import { applyImageRecipe } from "./canvas/imageRecipeActions";
import { applyMaskEdit } from "./canvas/imageMaskActions";
import { applyEmotionEdit } from "./canvas/imageEmotionActions";
import { createImageReversePromptNode } from "./canvas/imageReversePromptActions";
import {
  openWorkspaceVideoEditor,
  createClipNode,
} from "./canvas/videoEditorActions";

const store: any = rawStore;
// 画布挂载后到布局稳定之间的一小段，跨路由定位要等它过去再推视口。
const CANVAS_SETTLE_MS = 140;
let fitViewHandler: (() => void) | null = null;
type FocusNodesHandler = (nodeIds: string[], options?: { keepZoom?: boolean }) => void;
let focusNodesHandler: FocusNodesHandler | null = null;
// 画布只在 creation 路由挂载，从任务页或搜索面板跳过来时 handler 还没注册，
// 所以把最后一次请求留到注册那一刻再执行。
let pendingFocusNodeIds: string[] | null = null;

const referenceRoleByKind = {
  image: "referenceImage", video: "inputVideo", audio: "referenceAudio",
} as const;

/**
 * @ 引用的候选：连到当前节点的算「当前参考素材」，其余画布产物和项目素材库文件
 * 都还能继续引用。素材库条目还没有画布身份，被选中时才落成节点。
 */
function referenceCandidates(targetId: string): WorkflowReferenceCandidate[] {
  const target = store.project.nodes.find((item: any) => item.id === targetId);
  if (!target) return [];
  const modes = getGenerationInputModes(String(target.model || ""));
  const mode = modes.find((item) => item.value === target.inputMode) || modes[0];
  if (!mode) return [];
  const activeEdges = (store.project.edges || []).filter((edge: any) => edge.target === targetId && edge.data?.skipTaskInput !== true);
  const count = (role: string) => activeEdges.filter((edge: any) => {
    const source = store.project.nodes.find((item: any) => item.id === edge.source);
    return validateAgentInputRole(store.project, source, target, "auto").role === role;
  }).length;
  const capacity = (kind: "image" | "video" | "audio") =>
    kind === "image" ? mode.maxImages : kind === "video" ? mode.maxVideos : mode.maxAudios;
  const nodes: WorkflowReferenceCandidate[] = [];
  // 已经以节点形式出现在候选里的素材不再作为素材条目重复列出。
  const covered = new Set<string>();
  for (const source of store.project.nodes) {
    if (source.id === targetId || source.archived || !(Number(source.x) < Number(target.x))) continue;
    if (wouldCreateCanvasCycle(store.project, source.id, targetId)) continue;
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) continue;
    const kind = validation.role === "referenceImage" ? "image"
      : validation.role === "inputVideo" ? "video"
        : validation.role === "referenceAudio" ? "audio" : "";
    if (!kind) continue;
    const connected = activeEdges.some((edge: any) => edge.source === source.id);
    if (!capacity(kind) || (!connected && count(validation.role) >= capacity(kind))) continue;
    const media = selectedNodeMedia(source, store.project) || source;
    const name = String(source.title || source.uploadedFile?.name || source.fileName || t("ui.canvasAdapter.text.198d2966", { value0: kind === "image" ? t("ui.canvasMediaActions.text.be8da62e") : kind === "video" ? t("ui.canvasMediaActions.text.fa4e33b6") : t("ui.canvasAdapter.label.461189f1") })).trim();
    nodes.push({
      id: source.id, name, kind,
      group: connected ? "current" : "asset",
      media,
    });
    for (const key of [source.materialId, media.materialId, localMediaPath(media)]) {
      if (key) covered.add(String(key));
    }
    const mediaKey = String(media.id || "");
    if (mediaKey.startsWith("material:")) covered.add(mediaKey.slice("material:".length));
  }
  const materials = (store.project.materials || []).flatMap((material: any): WorkflowReferenceCandidate[] => {
    const kind = inferFileResourceType(material);
    if (kind !== "image" && kind !== "video" && kind !== "audio") return [];
    const path = String(material.path || material.filePath || "");
    if (!path || covered.has(String(material.id)) || covered.has(path)) return [];
    if (count(referenceRoleByKind[kind]) >= capacity(kind)) return [];
    const name = String(material.name || material.fileName || path.split(/[\\/]/).pop() || "").trim();
    return [{ id: String(material.id), name, kind, group: "asset", media: material }];
  });
  return [...nodes, ...materials];
}

/** 素材库条目还没有画布身份：引用时先复用同素材的节点，没有才在目标左侧新建一个。 */
async function referenceSourceNode(targetId: string, candidateId: string) {
  const existing = store.project.nodes.find((item: any) => item.id === candidateId && !item.archived);
  if (existing) return existing;
  const target = store.project.nodes.find((item: any) => item.id === targetId);
  const material = (store.project.materials || []).find((item: any) => String(item.id) === candidateId);
  if (!target || !material) return null;
  // 素材变成画布引用会连带建节点、连线和写引用，撤销要一起回到引用前的画布。
  recordCanvasHistory(t("ui.canvasAdapter.text.51d6e89f"));
  const reusable = store.project.nodes.find((item: any) => {
    if (item.archived || item.id === targetId) return false;
    if (String(item.materialId || "") !== candidateId
      && String(selectedNodeMedia(item, store.project)?.materialId || "") !== candidateId) return false;
    return !wouldCreateCanvasCycle(store.project, item.id, targetId)
      && validateAgentInputRole(store.project, item, target, "auto").valid;
  });
  if (reusable) return reusable;
  const incomingCount = (store.project.edges || []).filter(
    (edge: any) => edge.target === targetId && edge.data?.skipTaskInput !== true,
  ).length;
  try {
    return await createUploadedNode({ ...material, path: String(material.path || material.filePath || "") }, {
      x: Number(target.x || 0) - 340,
      y: Number(target.y || 0) + incomingCount * 36,
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function focusCanvasNodes(nodeIds: string[]) {
  setSelectedNodeIds(nodeIds);
  if (focusNodesHandler) focusNodesHandler(nodeIds);
  else pendingFocusNodeIds = nodeIds;
}

export function renameTextNodeVersion(nodeId: string, versionId: string, name: string) {
  const node: any = store.project.nodes.find((item: any) => item.id === nodeId && item.type === "textGeneration");
  const version = node?.textVersions?.find((item: any) => item.id === versionId);
  if (!version) return false;
  version.name = name.trim().slice(0, 80);
  touchProject();
  return true;
}

export function copyTextNodeVersion(nodeId: string, versionId: string) {
  const source: any = store.project.nodes.find((item: any) => item.id === nodeId && item.type === "textGeneration");
  const version = source?.textVersions?.find((item: any) => item.id === versionId);
  if (!source || !version) return false;
  recordCanvasHistory(t("ui.canvasAdapter.text.2d866e8e"));
  const copy: any = addNode("textGeneration");
  copy.title = String(version.name || t("ui.canvasAdapter.text.2429d214", { value0: source.title || t("ui.canvasAdapter.label.f1926e9b") })).slice(0, 80);
  copy.prompt = "";
  copy.textContent = version.content;
  copy.textVersions = [{ id: uid(), content: version.content, createdAt: new Date().toISOString(), name: t("ui.canvasAdapter.name.24eddf1f") }];
  copy.x = Math.round((Number(source.x) || 0) + canvasNodeDimensions(source).width + 80);
  copy.y = Math.round(Number(source.y) || 0);
  setSelectedNodeIds([copy.id]);
  touchProject();
  focusNodesHandler?.([copy.id]);
  return true;
}

export function canvasViewData() {
  return buildCanvasViewData(store);
}

export const canvasController: WorkflowCanvasController = {
  createSection(position) {
    const viewport = store.project.canvasViewport || { x: 0, y: 0, zoom: 1 };
    const fallback = position || { x: (120 - viewport.x) / viewport.zoom, y: (100 - viewport.y) / viewport.zoom };
    const selected = position ? [] : store.project.nodes.filter((node: WorkflowNodeData) => store.selectedNodeIds.includes(node.id));
    const bounds = canvasSectionBounds(selected, fallback);
    recordCanvasHistory(t('canvas.section.create'));
    const count = store.project.nodes.filter((node: WorkflowNodeData) => node.type === 'canvasSection').length;
    const node = addNode('canvasSection');
    Object.assign(node, bounds, { title: `${t('canvas.section.default')} ${count + 1}` });
    touchProject();
  },
  moveNodes(positions, options = {}) {
    if (!positions.length) return;
    if (options.recordHistory !== false) {
      recordCanvasPositionHistory(positions.map((item) => item.id));
    }
    const map = new Map(positions.map((item) => [item.id, item]));
    for (const node of store.project.nodes || []) {
      const position = map.get(node.id);
      if (position) {
        node.x = position.x;
        node.y = position.y;
      }
    }
    touchProject({ sessionDelay: 250, coalesceSession: true });
  },
  selectNodes(ids) {
    store.selectedEdgeId = null;
    setSelectedNodeIds(ids);
  },
  selectEdge(id) {
    store.selectedEdgeId = id;
  },
  connect(connection: Connection) {
    if (!connection.source || !connection.target) return false;
    recordCanvasHistory(t("ui.canvasAdapter.text.7a1f52e5"));
    const source = store.project.nodes.find((node: any) => node.id === connection.source);
    const target = store.project.nodes.find((node: any) => node.id === connection.target);
    if (target?.type === "clipStudio") {
      const candidate = editorCanvasCandidate(String(connection.source));
      if (!candidate) { showToast(t("ui.canvasAdapter.text.d210e170")); return false; }
      const result = addCanvasEdge(store.project, connection.source, connection.target, {
        edge: { sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle,
          data: { skipTaskInput: true, derivation: "clip-source", assetId: candidate.key, creationSource: "manual" } },
      });
      if (!result.ok) showToast(result.error);
      return result.ok;
    }
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) {
      showToast(validation.error || t("ui.canvasAdapter.text.2c056f18"));
      return false;
    }
    const availableModes = getGenerationInputModes(String(target?.model || ""));
    const supportsRole = (item: any) => validation.role === "referenceImage"
      ? item.maxImages > 0
      : validation.role === "inputVideo" ? item.maxVideos > 0 : validation.role === "referenceAudio" ? item.maxAudios > 0 : true;
    const activeMode = availableModes.find((item) => item.value === target?.inputMode && supportsRole(item))
      || availableModes.find(supportsRole);
    if (activeMode && validation.role !== "textContext") target.inputMode = activeMode.value;
    const occupied = (store.project.edges || [])
      .filter((edge: any) => edge.target === target?.id)
      .map((edge: any) => edge.data?.inputSlot)
      .filter(Boolean) as GenerationInputSlot[];
    const inputSlot = validation.role === "textContext" ? undefined : defaultInputSlot(
      (activeMode?.value || "reference") as GenerationInputMode,
      validation.role,
      occupied,
    );
    const result = addCanvasEdge(store.project, connection.source, connection.target, {
      edge: {
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        kind: "typed-input",
        data: { inputRole: validation.role, ...(inputSlot ? { inputSlot } : {}), required: true, creationSource: "manual" },
      },
    });
    if (!result.ok) showToast(result.error || t("ui.canvasAdapter.text.2c056f18"));
    return result.ok;
  },
  saveViewport(viewport) {
    persistCanvasViewport(viewport);
  },
  async createNodeAt(type, position) {
    if (type === 'canvasSection') { this.createSection?.(position); return; }
    if (type === "__upload__") {
      const file = await desktopApi.file.pickResource();
      if (file) {
        recordCanvasHistory(t("ui.canvasAdapter.text.d3ac5ec3"));
        await createUploadedNode(file, position);
      }
      return;
    }
    recordCanvasHistory(t("ui.canvasAdapter.text.9d160ec2"));
    const node: any = addNode(type);
    node.x = Math.round(position.x);
    node.y = Math.round(position.y);
    touchProject();
  },
  createArtifactNodeAt(artifactId, position) {
    const project = store.project;
    let source: any = project.nodes.find((item: any) => item.id === artifactId && !item.archived);
    if (!source) {
      for (const node of project.nodes) {
        source = (node.generatedOutputs || []).find((item: any) => item.id === artifactId);
        if (source) break;
      }
    }
    if (!source && artifactId.startsWith("material:")) {
      const materialId = artifactId.slice("material:".length);
      source = (project.materials || []).find((item: any) => item.id === materialId);
    }
    if (!source) return showToast(t("ui.canvasAdapter.text.b14319bb"));
    const rawPath = String(source.filePath || source.path || "");
    const remotePath = /^(https?:|blob:|data:)/i.test(rawPath);
    const filePath = remotePath ? "" : rawPath;
    const url = String(source.previewUrl || source.url || source.resourceUrl || (remotePath ? rawPath : ""));
    const content = String(source.content || source.textContent || "");
    if (!filePath && !url && !content) return showToast(t("ui.canvasAdapter.text.d100a7bd"));
    const declaredType = String(source.resourceType || source.mediaType || "").toLowerCase();
    const inferredType = inferFileResourceType({ ...source, name: source.fileName || source.title });
    const resourceType = ["image", "video", "audio", "text"].find((kind) =>
      declaredType.includes(kind)
    ) || (inferredType === "file" && content ? "text" : inferredType);
    const nodeType = {
      image: "imageGeneration",
      video: "videoGeneration",
      audio: "audioGeneration",
      text: "textGeneration",
    }[resourceType] || "textGeneration";
    const title = String(source.fileName || source.title || source.name || t("ui.canvasAdapter.text.38198529"));
    recordCanvasHistory(t("ui.canvasAdapter.text.40570e0c"));
    const node: any = addNode(nodeType);
    node.title = title;
    node.x = Math.round(position.x);
    node.y = Math.round(position.y);
    node.resourceType = resourceType;
    node.sourceType = "agent-artifact";
    node.sourceArtifactId = artifactId;
    node.content = content;
    if (resourceType === "text") node.textContent = content;
    node.uploadedFile = {
      name: title,
      fileName: title,
      path: filePath,
      filePath,
      previewUrl: url,
      resourceType,
      mimeType: String(source.mimeType || ""),
      content,
      source: "agent-artifact",
    };
    touchProject();
  },
  deleteSelection() {
    if (!(store.selectedNodeIds?.length || store.selectedNodeId || store.selectedEdgeId)) return;
    const edgeId = store.selectedEdgeId;
    const edge = edgeId
      ? store.project.edges.find((item: any) => item.id === edgeId)
      : undefined;
    const clip = edge && store.project.nodes.find((item: any) => item.id === edge.target && item.type === "clipStudio");
    const remove = () => {
      recordCanvasHistory(t("ui.canvasAdapter.text.e89139b8"));
      if (edgeId) {
        store.project.edges = store.project.edges.filter(
          (item: { id: string }) => item.id !== edgeId,
        );
        store.selectedEdgeId = null;
        touchProject();
      } else deleteSelectedNodes();
    };
    if (!clip) {
      remove();
      return;
    }
    void confirmAction({
      title: t("ui.canvasAdapter.text.03eb83ea", { value0: edge?.data?.clipIds?.length || 0 }),
      danger: true,
    }).then((confirmed) => {
      if (confirmed) remove();
    });
  },
  async copySelection(withUpstream = false) {
    try { await stageSelectedWorkflow({ withUpstream }); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
  },
  async pasteSelection() {
    try {
      const pasted = await pasteStagedWorkflow();
      if (pasted) return;
      const media = await desktopApi.clipboard.readMedia?.();
      if (!media) return showToast(t("ui.canvasAdapter.text.b78cd0e2"));
      recordCanvasHistory(t("ui.canvasAdapter.text.d745aaeb"));
      await createUploadedNode(media);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
  },
  undo: undoCanvas,
  redo: redoCanvas,
  runSelection() {
    const ids = new Set(store.selectedNodeIds || []);
    const nodes = (store.project.nodes || []).filter(
      (node: any) => ids.has(node.id) && /Generation$/.test(node.type),
    );
    if (!nodes.length) return showToast(t("ui.canvasAdapter.text.637a5e4c"));
    nodes.forEach((node: any) => runNode(node));
  },
  registerFitView(handler) {
    fitViewHandler = handler;
  },
  registerFocusNodes(handler) {
    focusNodesHandler = handler;
    if (!handler || !pendingFocusNodeIds) return;
    const nodeIds = pendingFocusNodeIds;
    pendingFocusNodeIds = null;
    window.setTimeout(() => handler(nodeIds), CANVAS_SETTLE_MS);
  },
};

export const nodeActions: WorkflowNodeActions = {
  createClipNode,
  update(id, patch) {
    const node = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (node) {
      if (node.type === 'canvasSection' && Object.keys(patch).some(key => node[key] !== patch[key])) recordCanvasHistory(t('canvas.section.edit'));
      if (node.type === "textGeneration" && Object.hasOwn(patch, "textContent")) {
        const versions = updatedTextVersions(node, patch.textContent);
        if (versions.length !== (Array.isArray(node.textVersions) ? node.textVersions.length : 0)) {
          patch = { ...patch, textVersions: versions };
        }
      }
      Object.assign(node, patch);
      touchProject({ sessionDelay: 250, coalesceSession: true });
    }
  },
  select(id) {
    store.selectedEdgeId = null;
    selectNode(id);
  },
  selectSectionContents(id) {
    const section = store.project.nodes.find((node: WorkflowNodeData) => node.id === id && node.type === 'canvasSection');
    if (section) setSelectedNodeIds(canvasSectionMembers(section, store.project.nodes as WorkflowNodeData[]).map(node => node.id));
  },
  delete(id) {
    recordCanvasHistory(t("ui.canvasAdapter.text.ff37dc39"));
    deleteNodeById(id);
  },
  async upload(id) {
    const node = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (!node || !/Generation$/.test(node.type)) return;
    const uploadKinds: Record<string, { type: string; label: string }> = {
      imageGeneration: { type: "image", label: t("ui.canvasMediaActions.text.be8da62e") },
      videoGeneration: { type: "video", label: t("ui.canvasMediaActions.text.fa4e33b6") },
      audioGeneration: { type: "audio", label: t("ui.canvasAdapter.label.461189f1") },
      textGeneration: { type: "text", label: t("ui.canvasAdapter.label.f1926e9b") },
    };
    const expected = uploadKinds[String(node.type)];
    if (!expected) return;
    const picked: any = await desktopApi.file.pickResource(expected.type);
    if (!picked) return;
    const pickedType = inferFileResourceType(picked);
    if (pickedType !== expected.type) {
      showToast(t("ui.canvasAdapter.text.5eb30d9b", { value0: expected.label }));
      return;
    }
    const file: any = await copyFileIntoProjectAssets(picked);
    const path = String(file.path || file.filePath || "");
    if (!path) return showToast(t("ui.canvasAdapter.text.401f5cb5"));
    const registered: any = file.reusedMaterialId
      ? {
          material: store.project.materials.find((item: any) => item.id === file.reusedMaterialId),
          asset: null,
        }
      : registerImportedMaterial(file, {
          resourceType: expected.type,
          source: "node-upload",
          sourceType: "node-upload",
          nodeType: node.type,
          assetTag: t("ui.canvasAdapter.assetTag.7e6ec243"),
        });
    if (!registered.material) return showToast(t("ui.canvasAdapter.text.0dca47b9"));
    let textContent = "";
    if (expected.type === "text") {
      try {
        const buffer = await desktopApi.file.readArrayBuffer?.(path);
        if (buffer) textContent = new TextDecoder().decode(buffer);
      } catch {
        return showToast(t("ui.canvasAdapter.text.9b06f7a0"));
      }
    }
    recordCanvasHistory(t("ui.canvasAdapter.text.3b3e5ecf"));
    Object.assign(node, {
      materialId: registered.material.id,
      assetId: registered.asset?.id || "",
      resourceType: expected.type,
      sourceType: "node-upload",
      uploadedFile: {
        name: file.name || file.fileName || t("ui.canvasAdapter.text.484a03ac"),
        path,
        filePath: path,
        type: file.type || file.mimeType || "",
        size: file.size || 0,
        materialId: registered.material.id,
        assetId: registered.asset?.id || "",
        resourceType: expected.type,
        source: "node-upload",
        ...(textContent ? { content: textContent } : {}),
      },
      ...(expected.type === "text" ? { textContent } : {}),
      updatedAt: new Date().toISOString(),
    });
    touchProject();
    showToast(t("ui.canvasAdapter.text.05a56c84"));
  },
  async addReference(id, requestedSlot) {
    const target = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (!target || !/Generation$/.test(target.type)) return;
    const modes = getGenerationInputModes(String(target.model || ""));
    const currentMode = modes.find((item) => item.value === target.inputMode);
    // An @ mention means the user is identifying an upstream asset. When the
    // selected model exposes a real multi-reference mode, enter that mode
    // instead of silently treating the first mentioned asset as a first frame.
    // Models that only expose firstFrame naturally fall back to their declared
    // mode and remain limited to one image.
    const referenceMode = !requestedSlot
      ? modes.find((item) => item.value === "reference" && item.maxImages > 0)
      : undefined;
    const mode = referenceMode || currentMode || modes[0];
    if (!mode) return showToast(t("ui.canvasAdapter.text.ad5cf842"));
    const slot = String(requestedSlot || mode.slots[0] || "reference") as GenerationInputSlot;
    const expectedKind = ["firstFrame", "lastFrame", "reference"].includes(slot) && mode.maxVideos === 0 && mode.maxAudios === 0
      ? "image" : undefined;
    const picked = await desktopApi.file.pickResource(expectedKind);
    if (!picked) return;
    const pickedType = inferFileResourceType(picked);
    const maxForKind = pickedType === "image" ? mode.maxImages : pickedType === "video" ? mode.maxVideos : pickedType === "audio" ? mode.maxAudios : 0;
    if (!maxForKind) return showToast(t("ui.canvasAdapter.text.b6bc1616", { value0: mode.label, value1: pickedType === "image" ? t("ui.canvasMediaActions.text.be8da62e") : pickedType === "video" ? t("ui.canvasMediaActions.text.fa4e33b6") : pickedType === "audio" ? t("ui.canvasAdapter.label.461189f1") : t("ui.canvasAdapter.text.17226b0a") }));
    const incomingCount = (store.project.edges || []).filter(
      (edge: any) => edge.target === id && edge.data?.skipTaskInput !== true,
    ).length;
    recordCanvasHistory(t("ui.canvasAdapter.text.c65f9eb1"));
    const source: any = await createUploadedNode(picked, {
      x: Number(target.x || 0) - 340,
      y: Number(target.y || 0) + incomingCount * 36,
    });
    if (!source?.id) return;
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) return showToast(validation.error || t("ui.canvasAdapter.text.aafdc6fb"));
    target.inputMode = mode.value;
    if (referenceMode && currentMode?.value !== mode.value) {
      const incoming = (store.project.edges || []).filter((edge: any) => edge.target === id);
      store.project.edges = [
        ...(store.project.edges || []).filter((edge: any) => edge.target !== id),
        ...reconcileGenerationInputEdges(incoming, mode),
      ];
    }
    const occupied = (store.project.edges || []).filter((edge: any) => edge.target === id)
      .map((edge: any) => edge.data?.inputSlot).filter(Boolean);
    const resolvedSlot = requestedSlot || defaultInputSlot(mode.value, validation.role, occupied);
    const result = addCanvasEdge(store.project, source.id, id, {
      touch: false,
      edge: { kind: "typed-input", data: { inputRole: validation.role, inputSlot: resolvedSlot, required: true } },
    });
    if (!result.ok) {
      showToast(result.error || t("ui.canvasAdapter.text.aafdc6fb"));
      return;
    }
    setSelectedNodeIds([id]);
    touchProject();
  },
  listReferenceCandidates(id) {
    return referenceCandidates(id);
  },
  async insertReferenceMention(id, sourceId, draft, start, end) {
    const candidate = referenceCandidates(id).find((item: WorkflowReferenceCandidate) => item.id === sourceId);
    const target = store.project.nodes.find((item: any) => item.id === id);
    const source: any = await referenceSourceNode(id, sourceId);
    if (!candidate || !target || !source) return null;
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) {
      showToast(validation.error || t("ui.canvasAdapter.text.a9e581d5"));
      return null;
    }
    const referenceId = String(source.id);
    const modes = getGenerationInputModes(String(target.model || ""));
    const currentMode = modes.find((item) => item.value === target.inputMode);
    const referenceMode = modes.find((item) => item.value === "reference" && item.maxImages > 0);
    const mode = referenceMode || currentMode || modes[0];
    if (!mode) return null;
    const occupied = (store.project.edges || [])
      .filter((edge: any) => edge.target === id && edge.data?.skipTaskInput !== true)
      .map((edge: any) => edge.data?.inputSlot).filter(Boolean);
    const existing = (store.project.edges || []).find((edge: any) => edge.target === id && edge.source === referenceId);
    const existingSlot = String(existing?.data?.inputSlot || "") as GenerationInputSlot;
    const slot = existingSlot && isSlotValidForMode(mode.value, existingSlot, validation.role)
      ? existingSlot : defaultInputSlot(mode.value, validation.role, occupied);
    const currentRefs = Array.isArray(target.promptReferences) ? target.promptReferences : [];
    const previous = currentRefs.find((ref: any) => ref.nodeId === referenceId);
    const baseAlias = String(candidate.name || t("ui.canvasAdapter.text.75e00c77")).replace(/[@\s]+/g, "-").replace(/[()（）\[\]{}]/g, "").slice(0, 48) || t("ui.canvasAdapter.text.75e00c77");
    let alias = String(previous?.alias || baseAlias);
    if (!previous) {
      let suffix = 2;
      while (currentRefs.some((ref: any) => ref.alias === alias)) alias = `${baseAlias}-${suffix++}`;
    }
    const safeStart = Math.max(0, Math.min(start, draft.length));
    const safeEnd = Math.max(safeStart, Math.min(end, draft.length));
    const inserted = `@${alias} `;
    const prompt = `${draft.slice(0, safeStart)}${inserted}${draft.slice(safeEnd)}`;
    if (referenceId === sourceId) recordCanvasHistory(t("ui.canvasAdapter.text.51d6e89f"));
    const result = addCanvasEdge(store.project, referenceId, id, {
      touch: false,
      updateExisting: true,
      edge: { kind: "typed-input", data: { inputRole: validation.role, inputSlot: slot, required: true } },
    });
    if (!result.ok) {
      showToast(result.error || t("ui.canvasAdapter.text.34f1740b"));
      return null;
    }
    target.inputMode = mode.value;
    if (referenceMode && currentMode?.value !== mode.value) {
      const incoming = (store.project.edges || []).filter((edge: any) => edge.target === id);
      store.project.edges = [
        ...(store.project.edges || []).filter((edge: any) => edge.target !== id),
        ...reconcileGenerationInputEdges(incoming, mode),
      ];
    }
    target.prompt = prompt;
    if (!previous) target.promptReferences = [...currentRefs, { alias, nodeId: referenceId }];
    setSelectedNodeIds([id]);
    touchProject();
    return { prompt, caret: safeStart + inserted.length };
  },
  setInputMode(id, value) {
    const target: any = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    const mode = getGenerationInputModes(String(target?.model || "")).find((item) => item.value === value);
    if (!target || !mode) return;
    recordCanvasHistory(t("ui.canvasAdapter.text.860272e2"));
    target.inputMode = mode.value;
    const incoming = (store.project.edges || []).filter((edge: any) => edge.target === id);
    const reconciled = reconcileGenerationInputEdges(incoming, mode);
    store.project.edges = [
      ...(store.project.edges || []).filter((edge: any) => edge.target !== id),
      ...reconciled,
    ];
    touchProject();
  },
  removeIncomingEdge(id, edgeId) {
    const edge = (store.project.edges || []).find(
      (item: any) => item.id === edgeId && item.target === id,
    );
    if (!edge) return;
    const target = store.project.nodes.find((item: any) => item.id === id);
    const remove = () => {
      recordCanvasHistory(t("ui.canvasAdapter.text.806747d8"));
      store.project.edges = store.project.edges.filter((item: any) => item.id !== edgeId);
      store.selectedEdgeId = null;
      touchProject();
    };
    if (target?.type === "clipStudio") {
      void confirmAction({
        title: t("ui.canvasAdapter.text.03eb83ea", { value0: edge.data?.clipIds?.length || 0 }),
        danger: true,
      }).then((confirmed) => {
        if (confirmed) remove();
      });
      return;
    }
    remove();
  },
  run(id) {
    const node = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (node) runNode(node);
  },
  useResource(id) {
    const target = (store.project.nodes || []).find(
      (node: WorkflowNodeData) =>
        node.id !== id &&
        (store.selectedNodeIds || []).includes(node.id) &&
        /Generation$/.test(node.type),
    );
    if (!target) return showToast(t("ui.canvasAdapter.text.bce01e8d"));
    recordCanvasHistory(t("ui.canvasAdapter.text.4d5a67ae"));
    const result = connectResourceToNode(store.project, id, target.id);
    showToast(result.ok ? t("ui.canvasAdapter.text.19863255") : result.error || t("ui.canvasAdapter.text.2c056f18"));
  },
  saveToAssets,
  cropImage,
  createAnnotationNode,
  createWatermarkNode,
  splitImageGrid,
  captureVideoFrame,
  extractAudio,
  applyImageRecipe,
  applyMaskEdit,
  applyEmotionEdit,
  createReversePromptNode: createImageReversePromptNode,
  async replaceResource(id) {
    const picked = await desktopApi.file.pickResource();
    if (!picked) return;
    const file: any = await copyFileIntoProjectAssets(picked);
    const resourceType = inferFileResourceType(file);
    const registered = file.reusedMaterialId
      ? {
          material: store.project.materials.find(
            (item: WorkflowNodeData) => item.id === file.reusedMaterialId,
          ),
        }
      : registerImportedMaterial(file, {
          resourceType,
          source: "resource-replace",
          sourceType: "resource-replace",
        });
    if (!registered.material) return showToast(t("ui.canvasAdapter.text.63551caf"));
    recordCanvasHistory(t("ui.canvasAdapter.text.43ccbabf"));
    const result = replaceResourceNode(store.project, id, {
      title: registered.material.name,
      content: registered.material.path || registered.material.name,
      fileName: registered.material.name,
      filePath: registered.material.path,
      materialId: registered.material.id,
      resourceType,
      source: "resource-replace",
    });
    showToast(result.ok ? t("ui.canvasAdapter.text.4086b257") : result.error || t("ui.canvasAdapter.text.8f1950e0"));
  },
  archiveResource(id) {
    recordCanvasHistory(t("ui.canvasAdapter.text.54265bf6"));
    const result = archiveResourceNode(store.project, id);
    showToast(result.ok ? t("ui.canvasAdapter.text.de659a32") : result.error || t("ui.canvasAdapter.text.29a3cfdc"));
  },
  selectOutput(nodeId, outputId) {
    recordCanvasHistory(t("ui.canvasAdapter.text.34f1b40b"));
    const result = selectGeneratedOutput(store.project, nodeId, outputId);
    if (!result.ok) showToast(result.error || t("ui.canvasAdapter.text.b92418f8"));
  },
  async getDirectorIncomingImages(id) {
    const incomingEdges = (store.project.edges || []).filter(
      (edge: any) => edge.target === id && edge.data?.skipTaskInput !== true,
    );
    const results: Array<{ edgeId: string; nodeId: string; name: string; url: string }> = [];
    for (const edge of incomingEdges) {
      const sourceId = edge.source;
      const node: any = (store.project.nodes || []).find(
        (item: any) => item.id === sourceId && !item.archived,
      );
      if (!node) continue;
      const candidate: any = selectedNodeMedia(node, store.project);
      const mediaType = inferFileResourceType(candidate);
      if (mediaType !== "image" && !(mediaType === "file" && node.type === "imageGeneration")) continue;
      const value = String(
        candidate.url ||
          candidate.remoteUrl ||
          candidate.resourceUrl ||
          candidate.previewUrl ||
          candidate.filePath ||
          candidate.path ||
          "",
      );
      if (!value) continue;
      let url = value;
      if (!/^(?:data:|blob:|https?:)/i.test(value)) {
        try {
          const buffer = await desktopApi.file.readArrayBuffer?.(value);
          if (!buffer?.byteLength) continue;
          const bytes = new Uint8Array(buffer);
          let binary = "";
          const chunkSize = 0x8000;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
          }
          const mimeType = String(candidate.mimeType || candidate.type || "image/png");
          url = `data:${mimeType};base64,${btoa(binary)}`;
        } catch {
          continue;
        }
      }
      results.push({
        edgeId: String(edge.id || ""),
        nodeId: node.id,
        name: String(
          candidate.title || candidate.name || candidate.fileName || node.title || t("ui.canvasAdapter.text.c8798a29"),
        ),
        url,
      });
    }
    return results;
  },
  removeDirectorIncomingEdge(id, edgeId) {
    const edge = (store.project.edges || []).find(
      (item: any) => item.id === edgeId && item.target === id,
    );
    if (!edge) return;
    recordCanvasHistory(t("ui.canvasAdapter.text.ea56bf47"));
    store.project.edges = store.project.edges.filter((item: any) => item.id !== edgeId);
    store.selectedEdgeId = null;
    touchProject();
  },
  async exportDirectorAsset(id, dataUrl, name, kind) {
    const director: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "threeDDirector",
    );
    if (!director || !dataUrl.startsWith("data:")) {
      showToast(t("ui.canvasAdapter.text.3bcc4e1a"));
      return null;
    }
    recordCanvasHistory(t("ui.canvasAdapter.text.3dfb5419"));
    const fallbackName = kind === "video" ? "3d-director.webm" : "3d-director.png";
    const preferredName = name.trim() || fallbackName;
    const file: any = await desktopApi.file.saveDataUrlToProject(dataUrl, preferredName);
    const path = String(file?.filePath || file?.path || "");
    if (!path) {
      showToast(t("ui.canvasAdapter.text.b95b836a"));
      return null;
    }
    const mimeType =
      dataUrl.slice(5, dataUrl.indexOf(";")) || (kind === "video" ? "video/webm" : "image/png");
    const registered: any = registerImportedMaterial(
      {
        ...file,
        name: file?.name || preferredName,
        type: mimeType,
        mimeType,
      },
      {
        resourceType: kind,
        source: "3d-director",
        sourceType: "3d-director",
        nodeType: kind === "video" ? "videoGeneration" : "imageGeneration",
      },
    );
    if (!registered.material) return null;
    registered.material.nodeId = id;
    const output: any = addNode(kind === "video" ? "videoGeneration" : "imageGeneration");
    output.title = preferredName;
    output.prompt = "";
    output.x = Math.round((Number(director.x) || 0) + 430);
    output.y = Math.round(Number(director.y) || 0);
    output.materialId = registered.material.id;
    output.resourceType = kind;
    output.sourceType = "3d-director";
    output.filePath = path;
    output.uploadedFile = {
      name: preferredName,
      path,
      type: mimeType,
      size: file?.size || 0,
      materialId: registered.material.id,
      resourceType: kind,
      source: "3d-director",
    };
    output.generatedFrom = { nodeId: id, type: "3d-director" };
    registered.material.nodeId = output.id;
    registered.material.nodeType = output.type;
    director.selectedOutputNodeId = `material:${registered.material.id}`;
    director.updatedAt = new Date().toISOString();
    addCanvasEdge(store.project, id, output.id, { touch: false });
    setSelectedNodeIds([output.id]);
    touchProject();
    showToast(kind === "video" ? t("ui.canvasAdapter.text.07952638") : t("ui.canvasAdapter.text.2b29d01f"));
    return { nodeId: output.id };
  },
  notify(message) {
    if (message) showToast(message);
  },
  async applyColoredPencil(id) {
    const node = store.project.nodes.find((item: any) => item.id === id);
    if (!node) return;
    recordCanvasHistory(t("ui.canvasAdapter.text.63764c75"));
    const result = await createColoredPencilImageNode(store.project, node);
    touchProject();
    if (!result.ok) showToast(result.error || t("ui.canvasAdapter.text.0fc25d77"));
    else if (result.node) {
      setSelectedNodeIds([result.node.id]);
      showSuccessToast(t("ui.canvasAdapter.text.67880af4", { value0: result.node.title || t("ui.canvasAdapter.text.caaf5b56") }));
    }
  },
};

export const canvasCommands = {
  undo: undoCanvas,
  redo: redoCanvas,
  fitView() {
    fitViewHandler?.();
  },
  autoLayout(options: { mode?: "workflow" | "horizontal" | "vertical" | "grid"; includeConnected?: boolean } = {}) {
    const ids = store.selectedNodeIds?.length
      ? [...store.selectedNodeIds]
      : store.selectedNodeId ? [store.selectedNodeId] : [];
    const before = {
      nodes: JSON.parse(JSON.stringify(store.project.nodes || [])),
      edges: JSON.parse(JSON.stringify(store.project.edges || [])),
      materials: JSON.parse(JSON.stringify(store.project.materials || [])),
      selectedNodeId: store.selectedNodeId,
      selectedNodeIds: [...(store.selectedNodeIds || [])],
    };
    const result = layoutAgentNodes(store.project, ids, {
      scope: ids.length ? "selection" : "all",
      mode: options.mode || "workflow",
      includeConnected: ids.length ? options.includeConnected === true : false,
    });
    if (result.movedCount) {
      recordCanvasHistoryState(t("ui.canvasAdapter.text.7ea05931"), before);
      if (options.includeConnected && ids.length) setSelectedNodeIds(result.nodeIds);
      touchProject();
      showSuccessToast(t("ui.canvasAdapter.text.735cbf79", { value0: result.movedCount }));
      return true;
    }
    else showToast(t("ui.canvasAdapter.text.8354ee30"));
    return false;
  },
  async applyMaterial(item: any, scope?: "library" | "local" | "files") {
    if (scope === "files") {
      const target = findMaterialCanvasTarget(store.project, item);
      if (target) {
        if (target.outputId) nodeActions.update(target.nodeId, { selectedOutputNodeId: target.outputId });
        focusCanvasNodes([target.nodeId]);
        return;
      }
    }
    let material = item;
    if (item.storageScope === "library" && item.localLibraryAssetId) {
      const referenced = await useLocalAssetInProject(item, { copy: false });
      material = { ...referenced.material, assetId: referenced.asset.id };
    }
    const node = applyMaterialToCanvas(material);
    if (scope === "files" && node) focusCanvasNodes([node.id]);
    return node;
  },
  openBlankVideoEditor() {
    openWorkspaceVideoEditor();
    return null;
  },
  async exportSelectedAssets() {
    const ids = new Set(
      store.selectedNodeIds?.length
        ? store.selectedNodeIds
        : store.selectedNodeId
          ? [store.selectedNodeId]
          : [],
    );
    if (!ids.size) return showToast(t("ui.canvasAdapter.text.d0d4eb0b"));
    const paths = new Set<string>();
    for (const node of store.project.nodes || []) {
      if (ids.has(node.id) || ids.has(node.generatedFrom?.nodeId)) {
        [node.filePath, node.localPath, node.uploadedFile?.path, node.uploadedFile?.filePath]
          .filter(Boolean)
          .forEach((value) => paths.add(value));
      }
    }
    for (const material of store.project.materials || []) {
      const referenced = (store.project.nodes || []).some(
        (node: any) =>
          ids.has(node.id) &&
          (node.materialId === material.id || node.uploadedFile?.materialId === material.id),
      );
      if (ids.has(material.nodeId) || referenced) {
        [material.path, material.filePath].filter(Boolean).forEach((value) => paths.add(value));
      }
    }
    if (!paths.size) return showToast(t("ui.canvasAdapter.text.d4efbaae"));
    try {
      const sources = [...paths];
      const result = sources.length === 1
        ? await desktopApi.file.exportFile(sources[0])
        : await desktopApi.file.exportFilesPackage(
            sources,
            `${store.project.name || "project"}-selected-assets`,
          );
      if (result?.ok) {
        showToast(
          sources.length === 1
            ? t("ui.canvasAdapter.text.ef2b810b", { value0: result.filePath || result.path || t("ui.canvasAdapter.text.67eaece5") })
            : result.direct
              ? t("ui.canvasAdapter.text.bba5d362", { value0: result.count, value1: result.filePath })
              : t("ui.canvasAdapter.text.8023e806", { value0: result.count }),
        );
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasAdapter.text.219d9bc3"));
    }
  },
  async mergeSelectedVideos() {
    const ids = new Set(
      store.selectedNodeIds?.length
        ? store.selectedNodeIds
        : store.selectedNodeId
          ? [store.selectedNodeId]
          : [],
    );
    const sources = (store.project.nodes || [])
      .filter((node: any) => ids.has(node.id) && !node.archived)
      .sort(
        (a: any, b: any) =>
          (Number(a.x) || 0) - (Number(b.x) || 0) || (Number(a.y) || 0) - (Number(b.y) || 0),
      )
      .map((node: any) => {
        const task = [...(store.project.tasks || [])]
          .reverse()
          .find((item: any) => item.nodeId === node.id && item.status === "completed");
        const archived = task?.result?.archivedFiles?.find((file: any) =>
          String(file.resourceType || file.type || "").includes("video"),
        );
        return {
          node,
          path:
            node.videoEdit?.exportedFile && !node.videoEdit?.dirty
              ? node.videoEdit.exportedFile
              : archived?.filePath ||
                archived?.path ||
                node.uploadedFile?.path ||
                (node.resourceType === "video" ? node.filePath : ""),
        };
      })
      .filter((item: any) => item.path);
    if (sources.length < 2) {
      return showToast(t("ui.canvasAdapter.text.3cc12b43"));
    }
    try {
      const result = await desktopApi.file.concatVideos(
        sources.map((item: any) => item.path),
        { name: `${store.project.name || "project"}-merged.mp4` },
      );
      const path = result?.filePath || result?.path;
      if (!path) return;
      const registered = registerImportedMaterial(
        {
          name: result.name || "merged.mp4",
          path,
          type: "video/mp4",
          size: result.size || 0,
        },
        {
          resourceType: "video",
          source: "video-concat",
          sourceType: "video-concat",
          nodeType: "videoGeneration",
        },
      );
      const node: any = addNode("videoGeneration");
      node.title = result.name || t("ui.canvasAdapter.text.55bef885");
      node.prompt = "";
      node.materialId = registered.material?.id || "";
      node.resourceType = "video";
      node.sourceType = "video-concat";
      node.uploadedFile = {
        name: node.title,
        path,
        type: "video/mp4",
        size: result.size || 0,
        materialId: node.materialId,
        resourceType: "video",
        source: "video-concat",
      };
      node.x = Math.max(...sources.map(({ node: source }: any) => Number(source.x) || 0)) + 380;
      node.y = Math.min(...sources.map(({ node: source }: any) => Number(source.y) || 0));
      touchProject();
      showToast(t("ui.canvasAdapter.text.9174d1eb", { value0: result.sourceCount || sources.length }));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasAdapter.text.3b5e1c5d"));
    }
  },
};

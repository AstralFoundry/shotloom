import type { Connection } from "@xyflow/react";
import { layoutAgentNodes } from "../../services/agentLayoutService";
import { createColoredPencilImageNode } from "../../services/coloredPencilNodeService";
// Canonical edge persistence: addCanvasEdge(store.project, connection.source, connection.target).
import { desktopApi } from "../../services/desktopApi.js";
import {
  addMaterialToAssetLibrary,
  applyMaterialToCanvas,
  copyFileIntoProjectAssets,
  inferFileResourceType,
  registerImportedMaterial,
} from "../../store/assetStore.js";
import { promoteMaterialToLocalLibrary, useLocalAssetInProject } from "../../store/localAssetLibraryStore.js";
import { addCanvasEdge } from "../../store/canvasGraphStore.js";
import { getGenerationInputModes } from "../../domain/catalog/ModelCatalog";
import { defaultInputSlot, type GenerationInputMode, type GenerationInputSlot } from "../../domain/graph/GenerationInputContract";
import { validateAgentInputRole } from "../../services/agentInputRole";
import { pasteStagedWorkflow, stageSelectedWorkflow } from "../../store/clipboardStore.js";
import {
  canRedoCanvas,
  canUndoCanvas,
  recordCanvasHistory,
  recordCanvasHistoryState,
  recordCanvasPositionHistory,
  redoCanvas,
  undoCanvas,
} from "../../store/canvasHistoryStore.js";
import {
  addNode,
  deleteNodeById,
  deleteSelectedNodes,
  selectNode,
  setSelectedNodeIds,
} from "../../store/nodeStore.js";
import {
  persistCanvasViewport,
  store as rawStore,
  touchProject,
} from "../../store/projectStore.js";
import {
  archiveResourceNode,
  connectResourceToNode,
  createBoardOutputResource,
  replaceResourceNode,
  selectGeneratedOutput,
} from "../../store/resourceNodeStore.js";
import { runNode } from "../../store/taskStore.js";
import { getAvailableModelIdsByType } from "../../store/settingsStore.js";
import { uid } from "../../utils/format.js";
import {
  appendEditorMediaAsset,
  normalizeVideoEditorProject,
} from "../../utils/videoEditorProject.mjs";
import { inferEditorMediaType, probeEditorMedia } from "../../utils/editorMediaImport.mjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showSuccessToast, showToast } from "../store/overlayStore";
import type {
  WorkflowCanvasController,
  WorkflowNodeActions,
  WorkflowNodeData,
} from "../canvas/WorkflowCanvas";

const store: any = rawStore;
let fitViewHandler: (() => void) | null = null;
let videoEditorOpener: ((id: string) => void) | null = null;
const canvasViewNodeCache = new Map<string, { signature: string; node: WorkflowNodeData }>();
export function registerVideoEditorOpener(handler: ((id: string) => void) | null) {
  videoEditorOpener = handler;
}

async function createUploadedNode(rawFile: any, position = { x: 120, y: 90 }) {
  const file: any = await copyFileIntoProjectAssets(rawFile);
  const path = file.path || file.filePath || "";
  if (!path) return showToast("文件未写入项目资源目录，已跳过");
  const resourceType = inferFileResourceType(file);
  const nodeType =
    resourceType === "video"
      ? "videoGeneration"
      : resourceType === "audio"
        ? "audioGeneration"
        : resourceType === "text"
          ? "textGeneration"
          : "imageGeneration";
  const registered = file.reusedMaterialId
    ? {
        material: store.project.materials.find((item: any) => item.id === file.reusedMaterialId),
        asset: null,
      }
    : registerImportedMaterial(file, {
        resourceType,
        source: "canvas-upload",
        sourceType: "canvas-upload",
        nodeType,
        assetTag: "画布上传",
      });
  if (!registered.material) return;
  const node: any = addNode(nodeType);
  node.title = file.name || file.fileName || "未命名文件";
  node.prompt = "";
  node.x = Math.round(position.x);
  node.y = Math.round(position.y);
  node.materialId = registered.material.id;
  node.assetId = registered.asset?.id || "";
  node.resourceType = resourceType;
  node.sourceType = "canvas-upload";
  node.uploadedFile = {
    name: node.title,
    path,
    type: file.type || file.mimeType || "",
    size: file.size || 0,
    materialId: node.materialId,
    assetId: node.assetId,
    resourceType,
    source: "canvas-upload",
  };
  touchProject();
  return node;
}

export function canvasViewData() {
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

function selectedNodeLocalMedia(node: any) {
  const outputs = Array.isArray(node?.generatedOutputs) ? node.generatedOutputs : [];
  const selectedId = String(node?.selectedOutputNodeId || "").replace(/^material:/, "");
  const selectedOutput = outputs.find((item: any) => String(item?.id || "") === selectedId)
    || outputs.find((item: any) => item?.selected)
    || outputs[outputs.length - 1];
  const nodeMaterials = (store.project.materials || []).filter((item: any) =>
    item.nodeId === node?.id || item.id === node?.materialId || item.id === selectedId
  );
  let material = nodeMaterials.find((item: any) => item.id === selectedId)
    || nodeMaterials.find((item: any) =>
      String(item.path || item.filePath || "") === String(selectedOutput?.path || selectedOutput?.filePath || "")
    )
    || nodeMaterials[nodeMaterials.length - 1]
    || null;
  const uploaded = node?.uploadedFile && typeof node.uploadedFile === "object" ? node.uploadedFile : null;
  const path = String(
    selectedOutput?.filePath || selectedOutput?.path || material?.filePath || material?.path
      || uploaded?.filePath || uploaded?.path || node?.filePath || "",
  );
  if (!material && path) {
    material = {
      id: String(selectedOutput?.id || uploaded?.materialId || node?.materialId || ""),
      path,
      filePath: path,
      name: String(selectedOutput?.fileName || selectedOutput?.title || uploaded?.name || node?.title || path.split(/[\\/]/).pop() || "未命名素材"),
      size: Number(selectedOutput?.size || uploaded?.size || 0),
      mimeType: String(selectedOutput?.mimeType || uploaded?.type || ""),
      resourceType: String(selectedOutput?.resourceType || uploaded?.resourceType || node?.resourceType || ""),
      nodeType: String(node?.type || ""),
    };
  }
  const asset = material
    ? (store.project.assets || []).find((item: any) => item.materialId === material.id) || {}
    : {};
  return { path, material, asset };
}

export const canvasController: WorkflowCanvasController = {
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
    recordCanvasHistory("连接节点");
    const source = store.project.nodes.find((node: any) => node.id === connection.source);
    const target = store.project.nodes.find((node: any) => node.id === connection.target);
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) {
      showToast(validation.error || "连接失败");
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
        data: { inputRole: validation.role, ...(inputSlot ? { inputSlot } : {}), required: true },
      },
    });
    if (!result.ok) showToast(result.error || "连接失败");
    return result.ok;
  },
  saveViewport(viewport) {
    persistCanvasViewport(viewport);
  },
  async createNodeAt(type, position) {
    if (type === "__upload__") {
      const file = await desktopApi.file.pickResource();
      if (file) {
        recordCanvasHistory("上传文件创建节点");
        await createUploadedNode(file, position);
      }
      return;
    }
    recordCanvasHistory("创建节点");
    if (type === "__character_multiview__") {
      const identity: any = addNode("textGeneration");
      identity.title = "角色身份｜角色圣经";
      identity.prompt =
        "建立可用于连续镜头生成的角色身份圣经，描述身份、年龄阶段、外形、体型、服装配饰、固定色彩与不可变化特征。";
      identity.x = Math.round(position.x);
      identity.y = Math.round(position.y);
      const sheet: any = addNode("imageGeneration");
      sheet.title = "角色设定板｜多视角与表情";
      sheet.prompt =
        "基于上游角色身份圣经生成单一角色设定板：正面、侧面、背面全身，三分之四半身、表情组和服装配饰色板；所有区域身份、比例与装束严格一致，中性背景，不添加文字水印。";
      sheet.x = Math.round(position.x + 470);
      sheet.y = Math.round(position.y);
      addCanvasEdge(store.project, identity.id, sheet.id, { touch: false });
      setSelectedNodeIds([identity.id, sheet.id]);
      touchProject();
      return;
    }
    const node: any = addNode(type);
    node.x = Math.round(position.x);
    node.y = Math.round(position.y);
    touchProject();
  },
  deleteSelection() {
    if (!(store.selectedNodeIds?.length || store.selectedNodeId || store.selectedEdgeId)) return;
    recordCanvasHistory("删除画布选择");
    if (store.selectedEdgeId) {
      store.project.edges = store.project.edges.filter(
        (edge: { id: string }) => edge.id !== store.selectedEdgeId,
      );
      store.selectedEdgeId = null;
      touchProject();
    } else deleteSelectedNodes();
  },
  copySelection(withUpstream = false) {
    return stageSelectedWorkflow({ withUpstream });
  },
  async pasteSelection() {
    const pasted = await pasteStagedWorkflow();
    if (pasted) return;
    const media = await desktopApi.clipboard.readMedia?.();
    if (!media) return showToast("剪贴板中没有可粘贴的节点、图片或文件");
    recordCanvasHistory("粘贴剪贴板资源");
    await createUploadedNode(media);
  },
  undo: undoCanvas,
  redo: redoCanvas,
  runSelection() {
    const ids = new Set(store.selectedNodeIds || []);
    const nodes = (store.project.nodes || []).filter(
      (node: any) => ids.has(node.id) && /Generation$/.test(node.type),
    );
    if (!nodes.length) return showToast("请选择可运行的生成节点");
    nodes.forEach((node: any) => runNode(node));
  },
  registerFitView(handler) {
    fitViewHandler = handler;
  },
};

export const nodeActions: WorkflowNodeActions = {
  update(id, patch) {
    const node = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (node) {
      Object.assign(node, patch);
      touchProject({ sessionDelay: 250, coalesceSession: true });
    }
  },
  select(id) {
    store.selectedEdgeId = null;
    selectNode(id);
  },
  delete(id) {
    recordCanvasHistory("删除节点");
    deleteNodeById(id);
  },
  async upload(id) {
    const node = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (!node || !/Generation$/.test(node.type)) return;
    const uploadKinds: Record<string, { type: string; label: string }> = {
      imageGeneration: { type: "image", label: "图片" },
      videoGeneration: { type: "video", label: "视频" },
      audioGeneration: { type: "audio", label: "音频" },
      textGeneration: { type: "text", label: "文本" },
    };
    const expected = uploadKinds[String(node.type)];
    if (!expected) return;
    const picked: any = await desktopApi.file.pickResource(expected.type);
    if (!picked) return;
    const pickedType = inferFileResourceType(picked);
    if (pickedType !== expected.type) {
      showToast(`请选择${expected.label}文件`);
      return;
    }
    const file: any = await copyFileIntoProjectAssets(picked);
    const path = String(file.path || file.filePath || "");
    if (!path) return showToast("文件未写入项目资源目录");
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
          assetTag: "节点上传",
        });
    if (!registered.material) return showToast("上传文件登记失败");
    let textContent = "";
    if (expected.type === "text") {
      try {
        const buffer = await desktopApi.file.readArrayBuffer?.(path);
        if (buffer) textContent = new TextDecoder().decode(buffer);
      } catch {
        return showToast("文本文件读取失败");
      }
    }
    recordCanvasHistory("上传节点文件");
    Object.assign(node, {
      materialId: registered.material.id,
      assetId: registered.asset?.id || "",
      resourceType: expected.type,
      sourceType: "node-upload",
      uploadedFile: {
        name: file.name || file.fileName || "上传文件",
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
    showToast("文件已上传到节点");
  },
  async addReference(id, requestedSlot) {
    const target = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    if (!target || !/Generation$/.test(target.type)) return;
    const modes = getGenerationInputModes(String(target.model || ""));
    const mode = modes.find((item) => item.value === target.inputMode) || modes[0];
    if (!mode) return showToast("当前模型不支持素材输入");
    const slot = String(requestedSlot || mode.slots[0] || "reference") as GenerationInputSlot;
    const expectedKind = ["firstFrame", "lastFrame", "reference"].includes(slot) && mode.maxVideos === 0 && mode.maxAudios === 0
      ? "image" : undefined;
    const picked = await desktopApi.file.pickResource(expectedKind);
    if (!picked) return;
    const pickedType = inferFileResourceType(picked);
    const maxForKind = pickedType === "image" ? mode.maxImages : pickedType === "video" ? mode.maxVideos : pickedType === "audio" ? mode.maxAudios : 0;
    if (!maxForKind) return showToast(`当前“${mode.label}”模式不支持${pickedType === "image" ? "图片" : pickedType === "video" ? "视频" : pickedType === "audio" ? "音频" : "该文件"}输入`);
    const incomingCount = (store.project.edges || []).filter(
      (edge: any) => edge.target === id && edge.data?.skipTaskInput !== true,
    ).length;
    recordCanvasHistory("添加参考素材");
    const source: any = await createUploadedNode(picked, {
      x: Number(target.x || 0) - 340,
      y: Number(target.y || 0) + incomingCount * 36,
    });
    if (!source?.id) return;
    const validation = validateAgentInputRole(store.project, source, target, "auto");
    if (!validation.valid) return showToast(validation.error || "添加参考素材失败");
    target.inputMode = mode.value;
    const occupied = (store.project.edges || []).filter((edge: any) => edge.target === id)
      .map((edge: any) => edge.data?.inputSlot).filter(Boolean);
    const resolvedSlot = requestedSlot || defaultInputSlot(mode.value, validation.role, occupied);
    const result = addCanvasEdge(store.project, source.id, id, {
      touch: false,
      edge: { kind: "typed-input", data: { inputRole: validation.role, inputSlot: resolvedSlot, required: true } },
    });
    if (!result.ok) {
      showToast(result.error || "添加参考素材失败");
      return;
    }
    setSelectedNodeIds([id]);
    touchProject();
  },
  setInputMode(id, value) {
    const target: any = store.project.nodes.find((item: WorkflowNodeData) => item.id === id);
    const mode = getGenerationInputModes(String(target?.model || "")).find((item) => item.value === value);
    if (!target || !mode) return;
    recordCanvasHistory("切换输入模式");
    target.inputMode = mode.value;
    const incoming = (store.project.edges || []).filter((edge: any) => edge.target === id);
    let imageIndex = 0;
    const keep = new Set<string>();
    for (const edge of incoming) {
      const role = String(edge.data?.inputRole || "");
      if (role === "textContext") { keep.add(edge.id); continue; }
      if (role === "referenceImage" && imageIndex < mode.maxImages) {
        const inputSlot = mode.value === "firstLastFrame" ? (imageIndex ? "lastFrame" : "firstFrame")
          : mode.value === "firstFrame" ? "firstFrame" : "reference";
        edge.data = { ...(edge.data || {}), inputRole: role, inputSlot };
        imageIndex += 1;
        keep.add(edge.id);
      } else if (role === "inputVideo" && mode.maxVideos > 0) {
        edge.data = { ...(edge.data || {}), inputRole: role, inputSlot: "inputVideo" };
        keep.add(edge.id);
      } else if (role === "referenceAudio" && mode.maxAudios > 0) {
        edge.data = { ...(edge.data || {}), inputRole: role, inputSlot: "referenceAudio" };
        keep.add(edge.id);
      }
    }
    store.project.edges = (store.project.edges || []).filter((edge: any) => edge.target !== id || keep.has(edge.id));
    touchProject();
  },
  removeIncomingEdge(id, edgeId) {
    const edge = (store.project.edges || []).find(
      (item: any) => item.id === edgeId && item.target === id,
    );
    if (!edge) return;
    recordCanvasHistory("移除参考素材连线");
    store.project.edges = store.project.edges.filter((item: any) => item.id !== edgeId);
    store.selectedEdgeId = null;
    touchProject();
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
    if (!target) return showToast("请同时选择一个生成节点作为输入目标");
    recordCanvasHistory("连接资源输入");
    const result = connectResourceToNode(store.project, id, target.id);
    showToast(result.ok ? "已连接为生成输入" : result.error || "连接失败");
  },
  async saveToAssets(id, scope, category) {
    const node = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path, material, asset } = selectedNodeLocalMedia(node);
    if (!node || !path || !material) return showToast("当前节点没有可存入的本地资源");
    if (!category) return showToast("请先选择资产类型");
    try {
      const assetDetails = {
        ...asset,
        category,
        name: asset.name || material.name || node.title,
        resourceType: asset.resourceType || material.resourceType || node.resourceType,
        nodeType: asset.nodeType || material.nodeType || node.type,
      };
      if (scope === "project") {
        let projectMaterial = (store.project.materials || []).find((item: any) =>
          item.id === material.id || String(item.path || item.filePath || "") === path
        );
        if (!projectMaterial) {
          const registered = registerImportedMaterial(material, {
            resourceType: assetDetails.resourceType,
            sourceType: material.sourceType || material.source || "canvas-asset-save",
            nodeType: assetDetails.nodeType,
          });
          projectMaterial = registered.material;
        }
        const existing = (store.project.assets || []).some(
          (item: any) => item.materialId === projectMaterial.id,
        );
        if (existing) return showToast("当前资源已在项目资产中");
        addMaterialToAssetLibrary(projectMaterial, {
          category,
          notify: false,
        });
        showToast("已存入当前项目资产");
        return;
      }
      await promoteMaterialToLocalLibrary(material, {
        ...assetDetails,
      });
      showToast("已存入全局资产，其他项目可以复用");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "存为资产失败");
    }
  },
  async extractAudio(id) {
    const source = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path } = selectedNodeLocalMedia(source);
    if (!source || source.type !== "videoGeneration" || !path) {
      return showToast("当前节点没有可分离的本地视频");
    }
    const stem = String(source.title || path.split(/[\\/]/).pop() || "视频")
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    try {
      const file: any = await desktopApi.file.extractAudioToProject(path, `${stem}-音频.m4a`);
      if (!file?.filePath && !file?.path) return;
      const registered = registerImportedMaterial(
        { ...file, type: "audio/mp4", mimeType: "audio/mp4" },
        {
          resourceType: "audio",
          source: "audio-extraction",
          sourceType: "audio-extraction",
          nodeType: "audioGeneration",
          assetTag: "音频分离",
        },
      );
      if (!registered.material) throw new Error("分离音频未能登记为项目素材");
      recordCanvasHistory("分离视频音轨");
      const audio: any = addNode("audioGeneration");
      audio.title = `${stem}-音频`;
      audio.prompt = "";
      audio.x = Math.round((Number(source.x) || 0) + (Number(source.canvasWidth) || 278) + 80);
      audio.y = Math.round(Number(source.y) || 0);
      audio.materialId = registered.material.id;
      audio.assetId = registered.asset?.id || "";
      audio.resourceType = "audio";
      audio.sourceType = "audio-extraction";
      audio.generatedFrom = { nodeId: source.id, type: "audio-extraction" };
      audio.uploadedFile = {
        name: file.name || `${stem}-音频.m4a`,
        path: file.filePath || file.path,
        type: "audio/mp4",
        size: file.size || 0,
        materialId: audio.materialId,
        assetId: audio.assetId,
        resourceType: "audio",
        source: "audio-extraction",
      };
      registered.material.nodeId = audio.id;
      setSelectedNodeIds([audio.id]);
      touchProject();
      showToast("已分离音轨并创建音频节点");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "音频分离失败");
    }
  },
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
    if (!registered.material) return showToast("替换资源失败");
    recordCanvasHistory("替换资源");
    const result = replaceResourceNode(store.project, id, {
      title: registered.material.name,
      content: registered.material.path || registered.material.name,
      fileName: registered.material.name,
      filePath: registered.material.path,
      materialId: registered.material.id,
      resourceType,
      source: "resource-replace",
    });
    showToast(result.ok ? "资源节点已替换" : result.error || "替换失败");
  },
  archiveResource(id) {
    recordCanvasHistory("归档资源");
    const result = archiveResourceNode(store.project, id);
    showToast(result.ok ? "资源已归档，可用撤销恢复" : result.error || "归档失败");
  },
  selectOutput(nodeId, outputId) {
    recordCanvasHistory("选择生成输出");
    const result = selectGeneratedOutput(store.project, nodeId, outputId);
    if (!result.ok) showToast(result.error || "选择输出失败");
  },
  openVideoEditor(id) {
    store.project.activeVideoEditorNodeId = id;
    touchProject({ sessionDelay: 300, coalesceSession: true });
    if (videoEditorOpener) videoEditorOpener(id);
    else showToast("视频编辑器尚未就绪，请稍后重试");
  },
  async addToVideoEditor(id) {
    const node: any = (store.project.nodes || []).find((item: any) => item.id === id);
    if (!node) return;
    const outputs = [
      ...(Array.isArray(node.generatedOutputs) ? node.generatedOutputs : []),
      ...(store.project.materials || [])
        .filter((item: any) => item.nodeId === node.id)
        .map((item: any) => ({ ...item, id: `material:${item.id}` })),
      ...(store.project.nodes || []).filter(
        (item: any) => item.type === "resource" && !item.archived && item.generatedFrom?.nodeId === id,
      ),
    ];
    const selectedId = String(node.selectedOutputNodeId || "");
    const candidate: any = outputs.find((item: any) => String(item.id) === selectedId) ||
      outputs.find((item: any) => item.selected) || outputs.at(-1) || node.uploadedFile;
    const sourceFile = String(candidate?.filePath || candidate?.path || "");
    const remoteUrl = String(candidate?.url || candidate?.remoteUrl || candidate?.previewUrl || "");
    if (!sourceFile && !remoteUrl) return showToast("当前节点还没有可加入剪辑的媒体产物");

    const hintedType = String(candidate?.resourceType || candidate?.mimeType || node.resourceType || "")
      .toLowerCase();
    const type = hintedType.includes("image")
      ? "image"
      : hintedType.includes("audio")
      ? "audio"
      : hintedType.includes("video")
      ? "video"
      : inferEditorMediaType(sourceFile || remoteUrl);
    if (!["image", "video", "audio"].includes(type)) {
      return showToast("当前产物不是可剪辑的图片、视频或音频");
    }
    const sourceUrl = sourceFile ? convertFileSrc(sourceFile) : remoteUrl;
    let facts: any = {
      duration: Number(candidate?.duration || candidate?.metadata?.duration || 0),
      width: Number(candidate?.width || candidate?.metadata?.width || 0),
      height: Number(candidate?.height || candidate?.metadata?.height || 0),
    };
    try {
      facts = await probeEditorMedia({
        type,
        sourceFile,
        sourceUrl,
        readArrayBuffer: desktopApi.file.readArrayBuffer,
        probeNative: desktopApi.file.probeMedia,
      });
    } catch {
      if (type !== "image" && !facts.duration) {
        return showToast("媒体读取失败，无法加入剪辑");
      }
    }
    let editorNode: any = (store.project.nodes || []).find(
      (item: any) => item.id === store.project.activeVideoEditorNodeId && !item.archived,
    );
    if (!editorNode && node.videoEditProject) editorNode = node;
    const assetId = `canvas:${id}:${String(candidate?.id || sourceFile || remoteUrl)}`;
    const current = normalizeVideoEditorProject(editorNode?.videoEditProject);
    const result = appendEditorMediaAsset(current, {
      id: assetId,
      type,
      name: String(candidate?.title || candidate?.name || candidate?.fileName || node.title || "画布素材"),
      sourceFile,
      sourceUrl,
      sourceNodeId: id,
      sourceOutputId: String(candidate?.id || ""),
      ...facts,
    });
    if (!result.clipId) return showToast("媒体读取失败，无法加入剪辑");
    if (result.added) {
      recordCanvasHistory("加入剪辑");
      if (!editorNode) {
        editorNode = type === "video" ? node : addNode("videoGeneration");
        if (editorNode !== node) {
          editorNode.title = "视频剪辑";
          editorNode.prompt = "";
          editorNode.x = Math.round(Number(node.x || 120) + 360);
          editorNode.y = Math.round(Number(node.y || 90));
        }
      }
      store.project.activeVideoEditorNodeId = editorNode.id;
      editorNode.videoEditProject = result.project;
      editorNode.videoEdit = { ...(editorNode.videoEdit || {}), dirty: true };
      touchProject();
      showSuccessToast(`已加入剪辑：${candidate?.title || candidate?.name || node.title || "画布素材"}`);
    } else {
      showToast("该产物已经在剪辑时间线上");
    }
    if (editorNode && videoEditorOpener) videoEditorOpener(editorNode.id);
  },
  async exportBoard(id, dataUrl) {
    recordCanvasHistory("导出画板");
    const index =
      store.project.nodes.filter(
        (node: WorkflowNodeData) =>
          node.type === "resource" && (node.generatedFrom as any)?.nodeId === id,
      ).length + 1;
    let file = null;
    try {
      file = await desktopApi.file.saveDataUrlToProject(
        dataUrl,
        `board-${String(id).slice(0, 8)}-${index}.png`,
      );
    } catch {}
    const result = createBoardOutputResource(store.project, id, dataUrl, {
      file,
    });
    showToast(result.ok ? "画板已导出为资源节点" : result.error || "导出失败");
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
      const directOutputs = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
      const materials = (store.project.materials || [])
        .filter((item: any) => item.nodeId === node.id)
        .map((item: any) => ({ ...item, id: `material:${item.id}` }));
      const resources = (store.project.nodes || []).filter(
        (item: any) =>
          item.type === "resource" && !item.archived && item.generatedFrom?.nodeId === node.id,
      );
      const outputs = [...directOutputs, ...materials, ...resources];
      const selectedId = String(node.selectedOutputNodeId || "");
      const selected =
        outputs.find((item: any) => String(item.id || "") === selectedId) ||
        outputs.find((item: any) => item.selected) ||
        outputs.at(-1);
      const uploaded =
        node.uploadedFile && typeof node.uploadedFile === "object" ? node.uploadedFile : null;
      const candidate: any = selected || uploaded || node;
      const mediaType = String(
        candidate.resourceType || candidate.mimeType || candidate.type || node.resourceType || "",
      ).toLowerCase();
      const location = String(
        candidate.fileName ||
          candidate.filePath ||
          candidate.path ||
          candidate.url ||
          candidate.remoteUrl ||
          candidate.previewUrl ||
          "",
      )
        .split(/[?#]/)[0]
        .toLowerCase();
      const imageSource =
        node.type === "imageGeneration" ||
        node.type === "board" ||
        mediaType.includes("image") ||
        /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)$/.test(location);
      if (!imageSource || /(?:video|audio|text)/.test(mediaType)) continue;
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
          candidate.title || candidate.name || candidate.fileName || node.title || "上游图片",
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
    recordCanvasHistory("移除 3D 导演台全景图连线");
    store.project.edges = store.project.edges.filter((item: any) => item.id !== edgeId);
    store.selectedEdgeId = null;
    touchProject();
  },
  async exportDirectorAsset(id, dataUrl, name, kind) {
    const director: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "threeDDirector",
    );
    if (!director || !dataUrl.startsWith("data:")) {
      showToast("3D 导演台输出数据无效");
      return null;
    }
    recordCanvasHistory("输出 3D 导演台素材");
    const fallbackName = kind === "video" ? "3d-director.webm" : "3d-director.png";
    const preferredName = name.trim() || fallbackName;
    const file: any = await desktopApi.file.saveDataUrlToProject(dataUrl, preferredName);
    const path = String(file?.filePath || file?.path || "");
    if (!path) {
      showToast("3D 导演台输出未能写入项目素材目录");
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
    showToast(kind === "video" ? "导演视频已输出到画布" : "导演图片已输出到画布");
    return { nodeId: output.id };
  },
  notify(message) {
    if (message) showToast(message);
  },
  addBoardImage(id) {
    const board = store.project.nodes.find(
      (node: WorkflowNodeData) => node.id === id && node.type === "board",
    );
    const resource = store.project.nodes.find(
      (node: WorkflowNodeData) =>
        node.type === "resource" &&
        node.id !== id &&
        !node.archived &&
        (store.selectedNodeIds || []).includes(node.id) &&
        String(node.resourceType || "").includes("image"),
    );
    if (!board || !resource) return showToast("请同时选择一个图片资源节点");
    const src = String(resource.filePath || resource.url || resource.content || "");
    if (!src) return showToast("图片资源缺少可用地址");
    recordCanvasHistory("添加画板图片");
    board.boardData ||= { strokes: [], texts: [], images: [] };
    board.boardData.images ||= [];
    const index = board.boardData.images.length;
    board.boardData.images.push({
      id: uid(),
      src,
      title: resource.title || resource.fileName || "图片",
      resourceNodeId: resource.id,
      x: 40 + (index % 3) * 36,
      y: 36 + (index % 3) * 24,
      width: 180,
      height: 120,
    });
    touchProject();
    showToast("图片已加入画板");
  },
  async applyColoredPencil(id) {
    const node = store.project.nodes.find((item: any) => item.id === id);
    if (!node) return;
    recordCanvasHistory("应用本地彩铅效果");
    const result = await createColoredPencilImageNode(store.project, node);
    touchProject();
    if (!result.ok) showToast(result.error || "彩铅处理失败");
    else if (result.node) {
      setSelectedNodeIds([result.node.id]);
      showSuccessToast(`创建成功：${result.node.title || "彩铅图片节点"}`);
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
      recordCanvasHistoryState("自动整理", before);
      if (options.includeConnected && ids.length) setSelectedNodeIds(result.nodeIds);
      touchProject();
      showSuccessToast(`已整理 ${result.movedCount} 个节点`);
      return true;
    }
    else showToast("当前没有需要整理的节点");
    return false;
  },
  async applyMaterial(item: any) {
    let material = item;
    if (item.storageScope === "library" && item.localLibraryAssetId) {
      const referenced = await useLocalAssetInProject(item, { copy: false });
      material = { ...referenced.material, assetId: referenced.asset.id };
    }
    return applyMaterialToCanvas(material);
  },
  openBlankVideoEditor() {
    recordCanvasHistory("新建视频剪辑");
    const node: any = addNode("videoGeneration");
    node.title = "视频剪辑";
    node.videoEdit = { dirty: false };
    store.project.activeVideoEditorNodeId = node.id;
    touchProject();
    if (videoEditorOpener) videoEditorOpener(node.id);
    return node;
  },
  async exportSelectedAssets() {
    const ids = new Set(
      store.selectedNodeIds?.length
        ? store.selectedNodeIds
        : store.selectedNodeId
          ? [store.selectedNodeId]
          : [],
    );
    if (!ids.size) return showToast("请先选择需要下载资源的节点");
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
    if (!paths.size) return showToast("所选节点没有可下载的本地资源");
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
            ? `已下载资源到 ${result.filePath || result.path || "指定位置"}`
            : result.direct
              ? `已打包 ${result.count} 个资源并保存到 ${result.filePath}`
              : `已打包下载 ${result.count} 个资源`,
        );
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "资源下载失败");
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
      return showToast("请至少选择两个带本地文件的视频节点");
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
      node.title = result.name || "拼接视频";
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
      showToast(`已拼接 ${result.sourceCount || sources.length} 个视频`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "视频拼接失败");
    }
  },
};

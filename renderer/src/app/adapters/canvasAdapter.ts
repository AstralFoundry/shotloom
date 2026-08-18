import type { Connection } from "@xyflow/react";
import { canvasNodeDimensions, layoutAgentNodes } from "../../services/agentLayoutService";
import { createColoredPencilImageNode } from "../../services/coloredPencilNodeService";
// Canonical edge persistence: addCanvasEdge(store.project, connection.source, connection.target).
import { desktopApi } from "../../services/desktopApi.js";
import {
  applyMaterialToCanvas,
  copyFileIntoProjectAssets,
  inferFileResourceType,
  registerImportedMaterial,
} from "../../store/assetStore.js";
import { useLocalAssetInProject } from "../../store/localAssetLibraryStore.js";
import { addCanvasEdge } from "../../store/canvasGraphStore.js";
import { getGenerationInputModes } from "../../domain/catalog/ModelCatalog";
import {
  defaultInputSlot,
  reconcileGenerationInputEdges,
  type GenerationInputMode,
  type GenerationInputSlot,
} from "../../domain/graph/GenerationInputContract";
import { validateAgentInputRole } from "../../services/agentInputRole";
import { pasteStagedWorkflow, stageSelectedWorkflow } from "../../store/clipboardStore.js";
import {
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
import { uid } from "../../utils/format.js";
import { showSuccessToast, showToast } from "../store/overlayStore";
import type {
  WorkflowCanvasController,
  WorkflowNodeActions,
  WorkflowNodeData,
} from "../canvas/WorkflowCanvas";
import {
  cropImage,
  extractAudio,
  saveToAssets,
} from "./canvas/canvasMediaActions";
import { buildCanvasViewData } from "./canvas/canvasViewData";
import { createUploadedNode } from "./canvas/canvasUploadActions";
import {
  addToVideoEditor,
  openVideoEditor,
} from "./canvas/videoEditorActions";

const store: any = rawStore;
let fitViewHandler: (() => void) | null = null;

export function canvasViewData() {
  return buildCanvasViewData(store);
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
  saveToAssets,
  cropImage,
  extractAudio,
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
  openVideoEditor,
  addToVideoEditor,
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
    openVideoEditor(node.id);
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

import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "../../../services/desktopApi.js";
import { recordCanvasHistory } from "../../../store/canvasHistoryStore.js";
import { addNode } from "../../../store/nodeStore.js";
import { store, touchProject } from "../../../store/projectStore.js";
import { appendEditorMediaAsset, normalizeVideoEditorProject } from "../../../utils/videoEditorProject.mjs";
import { inferEditorMediaType, probeEditorMedia } from "../../../utils/editorMediaImport.mjs";
import { showSuccessToast, showToast } from "../../store/overlayStore";

let videoEditorOpener: ((id: string) => void) | null = null;

export function registerVideoEditorOpener(handler: ((id: string) => void) | null) {
  videoEditorOpener = handler;
}

export function openVideoEditor(id: string) {
  store.project.activeVideoEditorNodeId = id;
  touchProject({ sessionDelay: 300, coalesceSession: true });
  if (videoEditorOpener) videoEditorOpener(id);
  else showToast("视频编辑器尚未就绪，请稍后重试");
}

export async function addToVideoEditor(id: string) {
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
}

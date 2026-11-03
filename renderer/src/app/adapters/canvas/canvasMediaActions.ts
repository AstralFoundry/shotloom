import { t } from '@/i18n';
import { canvasNodeDimensions } from "../../../services/agentLayoutService";
import { desktopApi } from "../../../services/desktopApi.ts";
import {
  addMaterialToAssetLibrary,
  ensureMaterialStoredInProjectAssets,
  registerImportedMaterial,
} from "../../../store/assetStore.ts";
import { addCanvasEdge } from "../../../store/canvasGraphStore.ts";
import { recordCanvasHistory } from "../../../store/canvasHistoryStore.ts";
import { promoteMaterialToLocalLibrary } from "../../../store/localAssetLibraryStore.ts";
import { addNode, setSelectedNodeIds } from "../../../store/nodeStore.ts";
import { store as rawStore, touchProject } from "../../../store/projectStore.ts";
import { showSuccessToast, showToast } from "../../../store/notificationStore";
import type { ImageCropRect } from "../../components/ImageCropEditor";
import { imageGridCellRect } from "../../../utils/imageGridCrop.ts";
import { selectedNodeLocalMedia } from "./canvasMediaSelection";

const store: any = rawStore;

export async function saveToAssets(
  id: string,
  scope: "project" | "global",
  category: string,
) {
    const node = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path, material, asset } = selectedNodeLocalMedia(store.project, node);
    if (!node || !path || !material) return showToast(t("ui.canvasMediaActions.text.8d180ef3"));
    if (!category) return showToast(t("ui.canvasMediaActions.text.d037d913"));
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
          const archived = await ensureMaterialStoredInProjectAssets(material);
          const registered = registerImportedMaterial(archived, {
            resourceType: assetDetails.resourceType,
            sourceType: material.sourceType || material.source || "canvas-asset-save",
            nodeType: assetDetails.nodeType,
          });
          projectMaterial = registered.material;
        } else {
          projectMaterial = await ensureMaterialStoredInProjectAssets(projectMaterial);
        }
        const existing = (store.project.assets || []).some(
          (item: any) => item.materialId === projectMaterial.id,
        );
        if (existing) return showToast(t("ui.canvasMediaActions.text.993f7021"));
        addMaterialToAssetLibrary(projectMaterial, {
          category,
          notify: false,
        });
        showToast(t("ui.canvasMediaActions.text.e843ddf1"));
        return;
      }
      await promoteMaterialToLocalLibrary(material, {
        ...assetDetails,
      });
      showToast(t("ui.canvasMediaActions.text.cb06f2fc"));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasMediaActions.text.fe02fcc5"));
    }
}

export async function cropImage(id: string, crop: ImageCropRect) {
    const source: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "imageGeneration" && !item.archived,
    );
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || !path) throw new Error(t("ui.canvasMediaActions.text.e6b02cb4"));
    const stem = String(source.title || path.split(/[\\/]/).pop() || t("ui.canvasMediaActions.text.be8da62e"))
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    try {
      const file: any = await desktopApi.file.cropImageToProject(
        path,
        t("ui.canvasMediaActions.text.8006c41e", { value0: stem }),
        crop,
      );
      const filePath = String(file?.filePath || file?.path || "");
      if (!filePath) throw new Error(t("ui.canvasMediaActions.text.d0b332be"));
      const registered: any = registerImportedMaterial(
        { ...file, name: file?.name || t("ui.canvasMediaActions.text.8006c41e", { value0: stem }), type: "image/png", mimeType: "image/png" },
        {
          resourceType: "image",
          source: "image-crop",
          sourceType: "image-crop",
          nodeType: "imageGeneration",
          assetTag: t("ui.canvasMediaActions.assetTag.dc2fce18"),
        },
      );
      if (!registered.material) throw new Error(t("ui.canvasMediaActions.text.95b69265"));
      recordCanvasHistory(t("ui.canvasMediaActions.text.6cfb3364"));
      const output: any = addNode("imageGeneration");
      const sourceDimensions = canvasNodeDimensions(source);
      output.title = t("ui.canvasMediaActions.text.0f6f2251", { value0: stem });
      output.prompt = "";
      output.x = Math.round((Number(source.x) || 0) + sourceDimensions.width + 80);
      output.y = Math.round(Number(source.y) || 0);
      output.materialId = registered.material.id;
      output.assetId = registered.asset?.id || "";
      output.resourceType = "image";
      output.sourceType = "image-crop";
      output.generatedFrom = { nodeId: source.id, type: "image-crop" };
      output.filePath = filePath;
      output.uploadedFile = {
        name: file?.name || t("ui.canvasMediaActions.text.8006c41e", { value0: stem }),
        path: filePath,
        filePath,
        type: "image/png",
        mimeType: "image/png",
        size: file?.size || 0,
        materialId: output.materialId,
        assetId: output.assetId,
        resourceType: "image",
        source: "image-crop",
      };
      registered.material.nodeId = output.id;
      addCanvasEdge(store.project, source.id, output.id, {
        touch: false,
        kind: "derived-output",
        edge: { data: { skipTaskInput: true, derivation: "image-crop" } },
      });
      setSelectedNodeIds([output.id]);
      touchProject();
      showSuccessToast(t("ui.canvasMediaActions.text.d2d6e89b"));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasMediaActions.text.1a94e238"));
      throw cause;
    }
}

/**
 * 标注与水印都是"在原图之外再产出一张图"的派生动作：结果存成项目素材、
 * 派生一个新图片节点，原节点一个字段都不动。两者只差标题后缀与来源标记。
 */
async function createDerivedImageNode(id: string, blob: Blob, spec: {
  suffix: string;
  source: string;
  assetTag: string;
}) {
    const source: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "imageGeneration" && !item.archived,
    );
    if (!source) {
      showToast(t("ui.canvasMediaActions.text.8f6abde7", { value0: spec.suffix }));
      return false;
    }
    const stem = String(source.title || t("ui.canvasMediaActions.text.be8da62e"))
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    const name = `${stem}-${spec.suffix}.png`;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(t("ui.canvasMediaActions.text.97811dd4", { value0: spec.suffix })));
        reader.readAsDataURL(blob);
      });
      const file: any = await desktopApi.file.saveDataUrlToProject(dataUrl, name);
      const filePath = String(file?.filePath || file?.path || "");
      if (!filePath) throw new Error(t("ui.canvasMediaActions.text.91a70085", { value0: spec.suffix }));
      const registered: any = registerImportedMaterial(
        { ...file, name: file?.name || name, type: "image/png", mimeType: "image/png" },
        {
          resourceType: "image",
          source: spec.source,
          sourceType: spec.source,
          nodeType: "imageGeneration",
          assetTag: spec.assetTag,
        },
      );
      if (!registered.material) throw new Error(t("ui.canvasMediaActions.text.332ca961", { value0: spec.suffix }));
      recordCanvasHistory(spec.assetTag);
      const output: any = addNode("imageGeneration");
      const sourceDimensions = canvasNodeDimensions(source);
      output.title = `${stem}-${spec.suffix}`;
      output.prompt = "";
      output.x = Math.round((Number(source.x) || 0) + sourceDimensions.width + 80);
      output.y = Math.round(Number(source.y) || 0);
      output.materialId = registered.material.id;
      output.assetId = registered.asset?.id || "";
      output.resourceType = "image";
      output.sourceType = spec.source;
      output.generatedFrom = { nodeId: source.id, type: spec.source };
      output.filePath = filePath;
      output.uploadedFile = {
        name: file?.name || name,
        path: filePath,
        filePath,
        type: "image/png",
        mimeType: "image/png",
        size: file?.size || 0,
        materialId: output.materialId,
        assetId: output.assetId,
        resourceType: "image",
        source: spec.source,
      };
      registered.material.nodeId = output.id;
      addCanvasEdge(store.project, source.id, output.id, {
        touch: false,
        kind: "derived-output",
        edge: { data: { skipTaskInput: true, derivation: spec.source } },
      });
      setSelectedNodeIds([output.id]);
      touchProject();
      showSuccessToast(t("ui.canvasMediaActions.text.3ebe53bf", { value0: spec.suffix }));
      return true;
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasMediaActions.text.702b9cb1", { value0: spec.suffix }));
      return false;
    }
}

export async function createAnnotationNode(id: string, blob: Blob) {
    return createDerivedImageNode(id, blob, {
      suffix: t("ui.canvasMediaActions.suffix.c57f2cf0"),
      source: "image-annotation",
      assetTag: t("ui.canvasMediaActions.assetTag.9b200a8d"),
    });
}

export async function createWatermarkNode(id: string, blob: Blob) {
    return createDerivedImageNode(id, blob, {
      suffix: t("ui.canvasMediaActions.suffix.d52f4ea8"),
      source: "image-watermark",
      assetTag: t("ui.canvasMediaActions.assetTag.e14a82e2"),
    });
}

export async function splitImageGrid(id: string, rows: number, cols: number, selected: number[], rect: ImageCropRect) {
    const source: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "imageGeneration" && !item.archived,
    );
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || !path) throw new Error(t("ui.canvasMediaActions.text.b57d646b"));
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 5 || cols > 5) {
      throw new Error(t("ui.canvasMediaActions.text.3d072486"));
    }
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
      rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) {
      throw new Error(t("ui.canvasMediaActions.text.728ebcc8"));
    }
    const cells = [...new Set(selected)].filter((index) => Number.isInteger(index) && index >= 0 && index < rows * cols).sort((a, b) => a - b);
    if (!cells.length) throw new Error(t("ui.canvasMediaActions.text.584ab9e6"));
    const stem = String(source.title || path.split(/[\\/]/).pop() || t("ui.canvasMediaActions.text.be8da62e"))
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    const files: Array<{ index: number; file: any }> = [];
    for (const index of cells) {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const file = await desktopApi.file.cropImageToProject(
        path, `${stem}-${row + 1}-${col + 1}.png`, imageGridCellRect(rect, rows, cols, index),
      );
      if (!file?.filePath && !file?.path) throw new Error(t("ui.canvasMediaActions.text.1b530f0d", { value0: row + 1, value1: col + 1 }));
      files.push({ index, file });
    }
    recordCanvasHistory(t("ui.canvasMediaActions.text.08b65689"));
    const sourceDimensions = canvasNodeDimensions(source);
    const created: string[] = [];
    for (const { index, file } of files) {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const filePath = String(file.filePath || file.path);
      const name = String(file.name || `${stem}-${row + 1}-${col + 1}.png`);
      const registered: any = registerImportedMaterial(
        { ...file, name, type: "image/png", mimeType: "image/png" },
        { resourceType: "image", source: "image-grid-split", sourceType: "image-grid-split", nodeType: "imageGeneration", assetTag: t("ui.canvasMediaActions.text.08b65689") },
      );
      if (!registered.material) throw new Error(t("ui.canvasMediaActions.text.5e6dcbcb", { value0: row + 1, value1: col + 1 }));
      const output: any = addNode("imageGeneration");
      output.title = `${stem} ${row + 1}-${col + 1}`;
      output.prompt = "";
      output.x = Math.round((Number(source.x) || 0) + sourceDimensions.width + 80 + col * (sourceDimensions.width + 36));
      output.y = Math.round((Number(source.y) || 0) + row * (sourceDimensions.height + 36));
      output.materialId = registered.material.id;
      output.assetId = registered.asset?.id || "";
      output.resourceType = "image";
      output.sourceType = "image-grid-split";
      output.generatedFrom = { nodeId: source.id, type: "image-grid-split", row, col, rows, cols };
      output.filePath = filePath;
      output.uploadedFile = { name, path: filePath, filePath, type: "image/png", mimeType: "image/png", size: file.size || 0, materialId: output.materialId, assetId: output.assetId, resourceType: "image", source: "image-grid-split" };
      registered.material.nodeId = output.id;
      addCanvasEdge(store.project, source.id, output.id, {
        touch: false,
        kind: "derived-output",
        edge: { data: { skipTaskInput: true, derivation: "image-grid-split" } },
      });
      created.push(output.id);
    }
    setSelectedNodeIds(created);
    touchProject();
    showSuccessToast(t("ui.canvasMediaActions.text.f3bb5b2f", { value0: created.length }));
}

export async function captureVideoFrame(id: string, seconds: number) {
    const source: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "videoGeneration" && !item.archived,
    );
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || !path) throw new Error(t("ui.canvasMediaActions.text.49c2f9a6"));
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(t("ui.canvasMediaActions.text.3f51b31f"));
    const stem = String(source.title || path.split(/[\\/]/).pop() || t("ui.canvasMediaActions.text.fa4e33b6"))
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    const timeLabel = seconds.toFixed(2).replace(".", "-");
    const file: any = await desktopApi.file.captureVideoFrameToProject(path, seconds, `${stem}-${timeLabel}s.png`);
    const filePath = String(file?.filePath || file?.path || "");
    if (!filePath) throw new Error(t("ui.canvasMediaActions.text.1f8dac30"));
    const registered: any = registerImportedMaterial(
      { ...file, type: "image/png", mimeType: "image/png" },
      { resourceType: "image", source: "video-frame", sourceType: "video-frame", nodeType: "imageGeneration", assetTag: t("ui.canvasMediaActions.assetTag.c87869a7") },
    );
    if (!registered.material) throw new Error(t("ui.canvasMediaActions.text.eeaab800"));
    recordCanvasHistory(t("ui.canvasMediaActions.assetTag.c87869a7"));
    const output: any = addNode("imageGeneration");
    output.title = `${stem} ${seconds.toFixed(2)}s`;
    output.prompt = "";
    output.x = Math.round((Number(source.x) || 0) + canvasNodeDimensions(source).width + 80);
    output.y = Math.round(Number(source.y) || 0);
    output.materialId = registered.material.id;
    output.assetId = registered.asset?.id || "";
    output.resourceType = "image";
    output.sourceType = "video-frame";
    output.generatedFrom = { nodeId: source.id, type: "video-frame", seconds };
    output.filePath = filePath;
    output.uploadedFile = { name: file.name || `${stem}-${timeLabel}s.png`, path: filePath, filePath, type: "image/png", mimeType: "image/png", size: file.size || 0, materialId: output.materialId, assetId: output.assetId, resourceType: "image", source: "video-frame" };
    registered.material.nodeId = output.id;
    addCanvasEdge(store.project, source.id, output.id, {
      touch: false,
      kind: "derived-output",
      edge: { data: { skipTaskInput: true, derivation: "video-frame" } },
    });
    setSelectedNodeIds([output.id]);
    touchProject();
    showSuccessToast(t("ui.canvasMediaActions.text.2fdea30f"));
}

export async function extractAudio(id: string) {
    const source = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || source.type !== "videoGeneration" || !path) {
      return showToast(t("ui.canvasMediaActions.text.0072ae07"));
    }
    const stem = String(source.title || path.split(/[\\/]/).pop() || t("ui.canvasMediaActions.text.fa4e33b6"))
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    try {
      const separated: any = await desktopApi.file.separateAudioToProject(
        path,
        t("ui.canvasMediaActions.text.460faab6", { value0: stem }),
        t("ui.canvasMediaActions.text.33fd2792", { value0: stem }),
      );
      const audioFile = separated?.audio;
      const videoFile = separated?.video;
      if ((!audioFile?.filePath && !audioFile?.path) || (!videoFile?.filePath && !videoFile?.path)) {
        throw new Error(t("ui.canvasMediaActions.text.ee712175"));
      }
      const registeredAudio = registerImportedMaterial(
        { ...audioFile, type: "audio/mp4", mimeType: "audio/mp4" },
        {
          resourceType: "audio",
          source: "audio-separation",
          sourceType: "audio-separation",
          nodeType: "audioGeneration",
          assetTag: t("ui.canvasMediaActions.assetTag.54fbe1e0"),
        },
      );
      const registeredVideo = registerImportedMaterial(
        { ...videoFile, type: "video/mp4", mimeType: "video/mp4" },
        {
          resourceType: "video",
          source: "audio-separation",
          sourceType: "audio-separation",
          nodeType: "videoGeneration",
          assetTag: t("ui.canvasMediaActions.assetTag.54fbe1e0"),
        },
      );
      if (!registeredAudio.material || !registeredVideo.material) {
        throw new Error(t("ui.canvasMediaActions.text.3c9c8010"));
      }
      recordCanvasHistory(t("ui.canvasMediaActions.text.282214c9"));
      const sourceDimensions = canvasNodeDimensions(source);
      const derivedX = Math.round((Number(source.x) || 0) + sourceDimensions.width + 80);
      const silentVideo: any = addNode("videoGeneration");
      silentVideo.title = t("ui.canvasMediaActions.text.625d7a03", { value0: stem });
      silentVideo.prompt = "";
      silentVideo.x = derivedX;
      silentVideo.y = Math.round(Number(source.y) || 0);
      silentVideo.materialId = registeredVideo.material.id;
      silentVideo.assetId = registeredVideo.asset?.id || "";
      silentVideo.resourceType = "video";
      silentVideo.sourceType = "audio-separation";
      silentVideo.generatedFrom = { nodeId: source.id, type: "audio-separation" };
      silentVideo.uploadedFile = {
        name: videoFile.name || t("ui.canvasMediaActions.text.33fd2792", { value0: stem }),
        path: videoFile.filePath || videoFile.path,
        filePath: videoFile.filePath || videoFile.path,
        type: "video/mp4",
        size: videoFile.size || 0,
        materialId: silentVideo.materialId,
        assetId: silentVideo.assetId,
        resourceType: "video",
        source: "audio-separation",
      };
      registeredVideo.material.nodeId = silentVideo.id;
      const audio: any = addNode("audioGeneration");
      audio.title = t("ui.canvasMediaActions.text.35872501", { value0: stem });
      audio.prompt = "";
      audio.x = derivedX;
      audio.y = Math.round(silentVideo.y + canvasNodeDimensions(silentVideo).height + 48);
      audio.materialId = registeredAudio.material.id;
      audio.assetId = registeredAudio.asset?.id || "";
      audio.resourceType = "audio";
      audio.sourceType = "audio-separation";
      audio.generatedFrom = { nodeId: source.id, type: "audio-separation" };
      audio.uploadedFile = {
        name: audioFile.name || t("ui.canvasMediaActions.text.460faab6", { value0: stem }),
        path: audioFile.filePath || audioFile.path,
        filePath: audioFile.filePath || audioFile.path,
        type: "audio/mp4",
        size: audioFile.size || 0,
        materialId: audio.materialId,
        assetId: audio.assetId,
        resourceType: "audio",
        source: "audio-separation",
      };
      registeredAudio.material.nodeId = audio.id;
      addCanvasEdge(store.project, source.id, silentVideo.id, {
        touch: false,
        kind: "derived-output",
        edge: { data: { skipTaskInput: true, derivation: "audio-separation" } },
      });
      addCanvasEdge(store.project, source.id, audio.id, {
        touch: false,
        kind: "derived-output",
        edge: { data: { skipTaskInput: true, derivation: "audio-separation" } },
      });
      setSelectedNodeIds([silentVideo.id, audio.id]);
      touchProject();
      showToast(t("ui.canvasMediaActions.text.29239d77"));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.canvasMediaActions.text.e5e53a6c"));
    }
}

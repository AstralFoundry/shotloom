import { canvasNodeDimensions } from "../../../services/agentLayoutService";
import { desktopApi } from "../../../services/desktopApi.js";
import {
  addMaterialToAssetLibrary,
  ensureMaterialStoredInProjectAssets,
  registerImportedMaterial,
} from "../../../store/assetStore.js";
import { addCanvasEdge } from "../../../store/canvasGraphStore.js";
import { recordCanvasHistory } from "../../../store/canvasHistoryStore.js";
import { promoteMaterialToLocalLibrary } from "../../../store/localAssetLibraryStore.js";
import { addNode, setSelectedNodeIds } from "../../../store/nodeStore.js";
import { store as rawStore, touchProject } from "../../../store/projectStore.js";
import { showSuccessToast, showToast } from "../../store/overlayStore";
import type { ImageCropRect } from "../../components/ImageCropDialog";
import { selectedNodeLocalMedia } from "./canvasMediaSelection";

const store: any = rawStore;

export async function saveToAssets(
  id: string,
  scope: "project" | "global",
  category: string,
) {
    const node = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path, material, asset } = selectedNodeLocalMedia(store.project, node);
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
}

export async function cropImage(id: string, crop: ImageCropRect) {
    const source: any = (store.project.nodes || []).find(
      (item: any) => item.id === id && item.type === "imageGeneration" && !item.archived,
    );
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || !path) throw new Error("当前节点没有可裁剪的本地图片");
    const stem = String(source.title || path.split(/[\\/]/).pop() || "图片")
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    try {
      const file: any = await desktopApi.file.cropImageToProject(
        path,
        `${stem}-裁剪.png`,
        crop,
      );
      const filePath = String(file?.filePath || file?.path || "");
      if (!filePath) throw new Error("裁剪结果未能写入项目素材目录");
      const registered: any = registerImportedMaterial(
        { ...file, name: file?.name || `${stem}-裁剪.png`, type: "image/png", mimeType: "image/png" },
        {
          resourceType: "image",
          source: "image-crop",
          sourceType: "image-crop",
          nodeType: "imageGeneration",
          assetTag: "图片裁剪",
        },
      );
      if (!registered.material) throw new Error("裁剪图片未能登记为项目素材");
      recordCanvasHistory("裁剪图片");
      const output: any = addNode("imageGeneration");
      const sourceDimensions = canvasNodeDimensions(source);
      output.title = `${stem}-裁剪`;
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
        name: file?.name || `${stem}-裁剪.png`,
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
      showSuccessToast("已创建裁剪图片节点");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "图片裁剪失败");
      throw cause;
    }
}

export async function extractAudio(id: string) {
    const source = (store.project.nodes || []).find((item: any) => item.id === id && !item.archived);
    const { path } = selectedNodeLocalMedia(store.project, source);
    if (!source || source.type !== "videoGeneration" || !path) {
      return showToast("当前节点没有可分离的本地视频");
    }
    const stem = String(source.title || path.split(/[\\/]/).pop() || "视频")
      .replace(/\.[a-z0-9]{1,10}$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    try {
      const separated: any = await desktopApi.file.separateAudioToProject(
        path,
        `${stem}-音乐.m4a`,
        `${stem}-无声.mp4`,
      );
      const audioFile = separated?.audio;
      const videoFile = separated?.video;
      if ((!audioFile?.filePath && !audioFile?.path) || (!videoFile?.filePath && !videoFile?.path)) {
        throw new Error("音视频拆分没有返回完整文件");
      }
      const registeredAudio = registerImportedMaterial(
        { ...audioFile, type: "audio/mp4", mimeType: "audio/mp4" },
        {
          resourceType: "audio",
          source: "audio-separation",
          sourceType: "audio-separation",
          nodeType: "audioGeneration",
          assetTag: "音视频拆分",
        },
      );
      const registeredVideo = registerImportedMaterial(
        { ...videoFile, type: "video/mp4", mimeType: "video/mp4" },
        {
          resourceType: "video",
          source: "audio-separation",
          sourceType: "audio-separation",
          nodeType: "videoGeneration",
          assetTag: "音视频拆分",
        },
      );
      if (!registeredAudio.material || !registeredVideo.material) {
        throw new Error("拆分文件未能登记为项目素材");
      }
      recordCanvasHistory("拆分视频与音乐");
      const sourceDimensions = canvasNodeDimensions(source);
      const derivedX = Math.round((Number(source.x) || 0) + sourceDimensions.width + 80);
      const silentVideo: any = addNode("videoGeneration");
      silentVideo.title = `${stem}-无声`;
      silentVideo.prompt = "";
      silentVideo.x = derivedX;
      silentVideo.y = Math.round(Number(source.y) || 0);
      silentVideo.materialId = registeredVideo.material.id;
      silentVideo.assetId = registeredVideo.asset?.id || "";
      silentVideo.resourceType = "video";
      silentVideo.sourceType = "audio-separation";
      silentVideo.generatedFrom = { nodeId: source.id, type: "audio-separation" };
      silentVideo.uploadedFile = {
        name: videoFile.name || `${stem}-无声.mp4`,
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
      audio.title = `${stem}-音乐`;
      audio.prompt = "";
      audio.x = derivedX;
      audio.y = Math.round(silentVideo.y + canvasNodeDimensions(silentVideo).height + 48);
      audio.materialId = registeredAudio.material.id;
      audio.assetId = registeredAudio.asset?.id || "";
      audio.resourceType = "audio";
      audio.sourceType = "audio-separation";
      audio.generatedFrom = { nodeId: source.id, type: "audio-separation" };
      audio.uploadedFile = {
        name: audioFile.name || `${stem}-音乐.m4a`,
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
      showToast("已创建无声视频和音乐节点");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "音频分离失败");
    }
}

import {
  copyFileIntoProjectAssets,
  inferFileResourceType,
  registerImportedMaterial,
} from "../../../store/assetStore.js";
import { addNode } from "../../../store/nodeStore.js";
import { store, touchProject } from "../../../store/projectStore.js";
import { showToast } from "../../store/overlayStore";

export async function createUploadedNode(rawFile: any, position = { x: 120, y: 90 }) {
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


import { t } from '@/i18n';
import {
  copyFileIntoProjectAssets,
  inferFileResourceType,
  registerImportedMaterial,
} from "../../../store/assetStore.ts";
import { addNode } from "../../../store/nodeStore.ts";
import { store, touchProject } from "../../../store/projectStore.ts";
import { showToast } from "../../../store/notificationStore";

export async function createUploadedNode(rawFile: any, position = { x: 120, y: 90 }) {
  const file: any = await copyFileIntoProjectAssets(rawFile);
  const path = file.path || file.filePath || "";
  if (!path) return showToast(t("ui.canvasUploadActions.text.578d2e03"));
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
        assetTag: t("ui.canvasUploadActions.assetTag.9f3c15a3"),
      });
  if (!registered.material) return;
  const node: any = addNode(nodeType);
  node.title = file.name || file.fileName || t("ui.canvasUploadActions.text.460d54d3");
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
    fileName: node.title,
    filePath: path,
    type: file.type || file.mimeType || "",
    mimeType: file.mimeType || file.type || "",
    size: file.size || 0,
    materialId: node.materialId,
    assetId: node.assetId,
    resourceType,
    source: "canvas-upload",
  };
  touchProject();
  return node;
}

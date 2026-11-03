import { t } from '@/i18n';
import { localMediaPath, selectedNodeMedia } from "../../../utils/nodeMedia.ts";
export interface SelectedCanvasMedia {
  path: string;
  material: Record<string, any> | null;
  asset: Record<string, any>;
}

export function selectedNodeLocalMedia(
  project: Record<string, any>,
  node: Record<string, any>,
): SelectedCanvasMedia {
  const selectedOutput = selectedNodeMedia(node, project);
  const path = localMediaPath(selectedOutput);
  let material = (project.materials || []).find((item: any) =>
    path && localMediaPath(item) === path
  ) || null;
  const uploaded = node?.uploadedFile;
  if (!material && path) {
    material = {
      id: String(selectedOutput?.id || uploaded?.materialId || node?.materialId || ""),
      path,
      filePath: path,
      name: String(selectedOutput?.fileName || selectedOutput?.title || uploaded?.name || node?.title || path.split(/[\\/]/).pop() || t("ui.canvasMediaSelection.text.b61b7f74")),
      size: Number(selectedOutput?.size || uploaded?.size || 0),
      mimeType: String(selectedOutput?.mimeType || uploaded?.type || ""),
      resourceType: String(selectedOutput?.resourceType || uploaded?.resourceType || node?.resourceType || ""),
      nodeType: String(node?.type || ""),
    };
  }
  const asset = material
    ? (project.assets || []).find((item: any) => item.materialId === material.id) || {}
    : {};
  return { path, material, asset };
}

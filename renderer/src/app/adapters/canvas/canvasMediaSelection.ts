import { textNodeContent } from '../../../utils/textNodeContent.ts';
import { t } from '@/i18n';
import { createNodeMediaCatalog, localMediaPath, selectedNodeMedia } from "../../../utils/nodeMedia.ts";

/** Resolve real media identity; names can be duplicated or edited. */
export function findMaterialCanvasTarget(project: Record<string, any>, material: Record<string, any>) {
  const materialId = String(material.materialId || material.id || '');
  const path = localMediaPath(material);
  const url = String(material.url || material.resourceUrl || '');
  const matches = (media: Record<string, any> | undefined) => Boolean(media && (
    (materialId && (String(media.materialId || '') === materialId || String(media.id || '') === materialId))
    || (path && localMediaPath(media) === path)
    || (url && [media.url, media.resourceUrl].includes(url))
  ));
  const catalog = createNodeMediaCatalog(project);
  for (const node of project.nodes || []) {
    if (node.archived) continue;
    const output = catalog.outputs(node).find(matches);
    if (output) return { nodeId: String(node.id), outputId: String(output.id) };
    if (matches(node.uploadedFile) || matches(node)) return { nodeId: String(node.id), outputId: '' };
    if (material.sourceNodeId === node.id && material.sourceText
      && material.sourceText === textNodeContent(node)) return { nodeId: String(node.id), outputId: '' };
  }
  return null;
}
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

/** Lookup the selected result, never a node-wide "saved" flag. */
export function nodeAssetCollections(project: Record<string, any>, node: Record<string, any>, catalog: Record<string, any>) {
  const { material, path, asset } = selectedNodeLocalMedia(project, node);
  const text = node?.type === 'textGeneration' ? textNodeContent(node) : '';
  const projectMaterial = material || (text ? (project.materials || []).find((item: any) => item.sourceNodeId === node.id && item.sourceText === text) : null);
  const projectAsset = asset.id ? asset : projectMaterial && (project.assets || []).find((item: any) => item.materialId === projectMaterial.id);
  const globalMaterial = (catalog.materials || []).find((item: any) =>
    item.id === projectMaterial?.localLibraryMaterialId ||
    (path && [item.path, item.filePath, item.sourceFilePath].includes(path)) ||
    (projectMaterial?.checksum && item.checksum === projectMaterial.checksum) ||
    (text && item.sourceNodeId === node.id && item.sourceText === text)
  );
  const globalAsset = globalMaterial && (catalog.assets || []).find((item: any) => item.materialId === globalMaterial.id);
  return { project: projectAsset || null, global: globalAsset || null };
}

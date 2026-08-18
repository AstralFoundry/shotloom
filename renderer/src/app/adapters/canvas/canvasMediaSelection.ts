export interface SelectedCanvasMedia {
  path: string;
  material: Record<string, any> | null;
  asset: Record<string, any>;
}

export function selectedNodeLocalMedia(
  project: Record<string, any>,
  node: Record<string, any>,
): SelectedCanvasMedia {
  const outputs = Array.isArray(node?.generatedOutputs) ? node.generatedOutputs : [];
  const selectedId = String(node?.selectedOutputNodeId || "").replace(/^material:/, "");
  const selectedOutput = outputs.find((item: any) => String(item?.id || "") === selectedId)
    || outputs.find((item: any) => item?.selected)
    || outputs[outputs.length - 1];
  const nodeMaterials = (project.materials || []).filter((item: any) =>
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
    ? (project.assets || []).find((item: any) => item.materialId === material.id) || {}
    : {};
  return { path, material, asset };
}

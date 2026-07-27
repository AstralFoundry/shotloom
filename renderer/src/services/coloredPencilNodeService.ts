import { desktopApi } from '@/services/desktopApi';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { semanticOutputFileName } from '@/utils/generatedOutputNaming.mjs';
import { uid } from '@/utils/format';

export const COLORED_PENCIL_STYLE_ID = 'colored-pencil';

type LooseRecord = Record<string, any>;

export function rewireColoredPencilDownstreamEdges(
  project: LooseRecord,
  sourceNodeId: string,
  derivedNodeId: string,
  downstreamEdgeIds: string[],
) {
  const wanted = new Set(downstreamEdgeIds);
  let rewired = 0;
  for (const edge of project?.edges || []) {
    if (!wanted.has(edge.id) || edge.source !== sourceNodeId) continue;
    edge.source = derivedNodeId;
    rewired += 1;
  }
  return rewired;
}

export function imageSourcePath(project: LooseRecord, node: LooseRecord): string {
  const selectedId = String(node?.selectedOutputNodeId || '');
  if (selectedId.startsWith('material:')) {
    const selectedMaterial = (project?.materials || []).find((material: LooseRecord) => (
      material.id === selectedId.slice('material:'.length) && material.nodeId === node.id
    ));
    if (selectedMaterial?.path || selectedMaterial?.filePath) {
      return selectedMaterial.path || selectedMaterial.filePath;
    }
  } else if (selectedId) {
    const selectedResource = (project?.nodes || []).find((candidate: LooseRecord) => (
      candidate.id === selectedId
      && candidate.type === 'resource'
      && candidate.generatedFrom?.nodeId === node.id
    ));
    if (selectedResource?.filePath || selectedResource?.path) {
      return selectedResource.filePath || selectedResource.path;
    }
  }
  const latestMaterial = (project?.materials || [])
    .filter((material: LooseRecord) => material.nodeId === node?.id && material.resourceType === 'image')
    .sort((left: LooseRecord, right: LooseRecord) => Date.parse(right.importedAt || 0) - Date.parse(left.importedAt || 0))[0];
  return latestMaterial?.path
    || latestMaterial?.filePath
    || node?.uploadedFile?.path
    || node?.uploadedFile?.filePath
    || node?.filePath
    || '';
}

export async function createColoredPencilImageNode(
  project: LooseRecord,
  sourceNode: LooseRecord,
  options: LooseRecord = {},
) {
  const sourcePath = imageSourcePath(project, sourceNode);
  if (!sourcePath) return { ok: false, error: '当前图片没有可供本地处理的原图文件' };
  const downstreamEdgeIds = (project.edges || [])
    .filter((edge: LooseRecord) => (
      edge.source === sourceNode.id
      && edge.data?.skipTaskInput !== true
    ))
    .map((edge: LooseRecord) => String(edge.id));

  const x = Number(options.position?.x ?? options.x);
  const y = Number(options.position?.y ?? options.y);
  const derived: LooseRecord = {
    id: uid(),
    type: 'imageGeneration',
    ...(options.tempId ? { agentTempId: String(options.tempId) } : {}),
    title: String(options.title || `${sourceNode.title || '图片'}·彩铅`),
    prompt: sourceNode.prompt || '',
    model: sourceNode.model || '',
    config: { ...(sourceNode.config || {}) },
    ...(sourceNode.outputSpec ? { outputSpec: { ...sourceNode.outputSpec } } : {}),
    status: 'running',
    progress: 20,
    error: '',
    width: Number(sourceNode.width) || 600,
    height: Number(sourceNode.height) || 285,
    x: Number.isFinite(x) ? Math.round(x) : Math.round((Number(sourceNode.x) || 0) + 430),
    y: Number.isFinite(y) ? Math.round(y) : Math.round(Number(sourceNode.y) || 0),
    createdAt: new Date().toISOString(),
  };
  project.nodes.push(derived);
  addCanvasEdge(project, sourceNode.id, derived.id, {
    touch: false,
    kind: 'typed-input',
    edge: { data: { inputRole: 'referenceImage', required: true } },
  });
  options.onNodeCreated?.(derived);

  try {
    const outputId = uid();
    const preferredName = semanticOutputFileName(derived.title, 'png');
    const file = await desktopApi.file.applyColoredPencil(
      sourcePath,
      preferredName,
    );
    const filePath = file?.filePath || file?.path || '';
    if (!filePath) throw new Error('本地彩铅处理没有生成输出文件');
    const material = {
      id: outputId,
      name: file.name || preferredName,
      path: filePath,
      filePath,
      ext: 'png',
      size: file.size || 0,
      mimeType: 'image/png',
      resourceType: 'image',
      source: 'generation',
      sourceType: 'local-filter',
      nodeId: derived.id,
      nodeType: derived.type,
      model: derived.model || 'local-colored-pencil',
      metadata: { styleId: COLORED_PENCIL_STYLE_ID, engine: 'local-filter', scope: 'full-image' },
      importedAt: new Date().toISOString(),
    };
    project.materials ||= [];
    project.materials.unshift(material);
    derived.selectedOutputNodeId = `material:${material.id}`;
    derived.selectedOutputTaskId = '';
    derived.status = 'completed';
    derived.progress = 100;
    const rewiredEdgeCount = rewireColoredPencilDownstreamEdges(
      project,
      sourceNode.id,
      derived.id,
      downstreamEdgeIds,
    );
    return { ok: true, node: derived, material, rewiredEdgeCount };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    derived.status = 'failed';
    derived.progress = 0;
    derived.error = error;
    return { ok: false, node: derived, error };
  }
}

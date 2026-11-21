import { canvasVideoSources } from './canvasVideoMergeService';
import { t } from '@/i18n';
import { subscribeDomain } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';
import { addNode, ensureGenerationConfig } from '@/store/nodeStore';
import { assetCategoryFor } from '@/domain/asset/assetCategories';
import { applyMaterialToCanvas, inferFileResourceType } from '@/store/assetStore';
import { textNodeContent } from '@/utils/textNodeContent';
import { selectedNodeMedia } from '@/utils/nodeMedia';
import { addCanvasEdge, wouldCreateCanvasCycle } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { findLatestTaskForNode, runNode } from '@/store/taskStore';
import { isActiveTaskStatus, isFailedTaskStatus, isTerminalTaskStatus } from '@/domain/tasks/TaskStatus';
import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import { canvasNodeDimensions, defaultCanvasNodeDimensions, MEDIA_NODE_MAX_HEIGHT } from '@/domain/graph/CanvasNodeDimensions';
import { defaultInputSlot, type GenerationInputSlot } from '@/domain/graph/GenerationInputContract';
import { uid } from '@/utils/format';
import { showToast } from '@/store/notificationStore';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import {
  STORYBOARD_SCRIPT_SUBTASK,
  STORYBOARD_CONTEXT_HANDLE,
  isStoryboardScriptNode,
  storyboardRowHandle,
  pruneStoryboardRowEdges,
  storyboardShotIdFromHandle,
  STORYBOARD_SCRIPT_VIEW,
  MAX_STORYBOARD_SHOTS,
  createStoryboardShot,
  normalizeStoryboardShots,
  patchStoryboardShot,
  renumberStoryboardShots,
  storyboardShotPrompt,
  storyboardOutputFields,
  storyboardOutputMedia,
  type StoryboardOutputKind,
  storyboardAssetRole,
  type StoryboardAssetBinding,
  type StoryboardAssetRole,
  type StoryboardShot,
  type StoryboardShotPatch,
} from '@/domain/graph/StoryboardScript';

type AnyRecord = Record<string, any>;

type StoryboardBatchStatus = 'waiting' | 'submitting' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type StoryboardBatchItem = {
  shotId: string;
  shotNumber: number;
  status: StoryboardBatchStatus;
  taskId?: string;
  submissionId?: string;
  uncertain?: boolean;
  error?: string;
  attempts: number;
  force?: boolean;
};
type StoryboardBatch = {
  id: string;
  kind: StoryboardOutputKind;
  items: StoryboardBatchItem[];
};

const runningStoryboards = new WeakSet<AnyRecord>();

export function storyboardBatch(node: AnyRecord | null | undefined, kind?: StoryboardOutputKind) {
  const latest = node?.storyboardBatch as StoryboardBatch | undefined;
  const batch = !kind || latest?.kind === kind ? latest : node?.storyboardBatches?.[kind] as StoryboardBatch | undefined;
  if (!node || !batch || !Array.isArray(batch.items)) return null;
  const tasks = new Map<string, AnyRecord>();
  const bySubmission = new Map<string, AnyRecord>();
  for (const task of store.project.tasks as AnyRecord[]) {
    tasks.set(task.id, task);
    if (task.submissionId && !bySubmission.has(task.submissionId)) bySubmission.set(task.submissionId, task);
  }
  const running = runningStoryboards.has(node);
  return {
    ...batch,
    items: batch.items.map((item) => {
      const task = item.taskId ? tasks.get(item.taskId) : item.submissionId ? bySubmission.get(item.submissionId) : undefined;
      let status = item.status;
      if (task && (task.status === 'completed' || task.status === 'cancelled' || isActiveTaskStatus(task.status))) status = task.status;
      else if (isFailedTaskStatus(task?.status)) status = 'failed';
      const interrupted = !running && (status === 'waiting' || status === 'submitting' || (!task && isActiveTaskStatus(status)));
      if (interrupted) status = 'failed';
      const uncertain = task?.submissionUncertain === true || Boolean(item.uncertain) || (!running && item.status === 'submitting' && !task);
      return {
        ...item,
        status,
        uncertain,
        error: String(task?.error || item.error || (interrupted ? t('canvas.storyboard.batchInterrupted') : '')),
        retryable: status === 'failed' && !uncertain,
      };
    }),
  };
}

function storeStoryboardBatch(node: AnyRecord, batch: StoryboardBatch): void {
  if (node.storyboardBatch?.kind && !node.storyboardBatches?.[node.storyboardBatch.kind]) {
    const previous = node.storyboardBatch as StoryboardBatch;
    node.storyboardBatches = { ...node.storyboardBatches, [previous.kind]: previous };
  }
  node.storyboardBatches = { ...node.storyboardBatches, [batch.kind]: batch };
  node.storyboardBatch = batch;
}

export function cancelStoryboardRun(nodeId: string): void {
  const node = projectNode(nodeId);
  if (!node || !runningStoryboards.has(node)) return;
  const batch = node.storyboardBatch as StoryboardBatch | undefined;
  if (!batch) return;
  storeStoryboardBatch(node, {
    ...batch,
    items: batch.items.map((item) => item.status === 'waiting' ? { ...item, status: 'cancelled' } : item),
  });
  touchProject();
}

export function isStoryboardRunActive(nodeId: string): boolean {
  const node = projectNode(nodeId);
  return Boolean(node && (runningStoryboards.has(node) || storyboardBatch(node)?.items.some((item) => isActiveTaskStatus(item.status))));
}

function projectNode(nodeId: string): AnyRecord | null {
  if (!nodeId) return null;
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

export function storyboardShots(node: AnyRecord | null | undefined): StoryboardShot[] {
  return normalizeStoryboardShots(node?.storyboardShots);
}

/** 分镜脚本复用文本生成节点：模型、任务与凭据沿用同一条真实链路。 */
export function createStoryboardScriptNode(
  position: { x: number; y: number }, { history = true, select = true }: { history?: boolean; select?: boolean } = {},
): AnyRecord {
  if (history) recordCanvasHistory(t('canvas.storyboard.create'));
  const node: AnyRecord = addNode('textGeneration', { select });
  node.title = t('canvas.storyboard.title');
  node.titleOverride = node.title;
  node.canvasView = STORYBOARD_SCRIPT_VIEW;
  node.artifactType = 'storyboard';
  node.canvasWidth = 920;
  node.canvasHeight = 360;
  node.x = Math.round(position.x);
  node.y = Math.round(position.y);
  node.prompt = '';
  node.config = { ...(node.config || {}), textSubtask: STORYBOARD_SCRIPT_SUBTASK };
  node.storyboardShots = [1, 2, 3].map((number) => createStoryboardShot(number, { durationSeconds: 6 }));
  node.storyboardShotCount = 0;
  touchProject();
  return node;
}

export function updateStoryboardShot(nodeId: string, shotId: string, patch: StoryboardShotPatch): void {
  const node = projectNode(nodeId);
  if (!node) return;
  node.storyboardShots = storyboardShots(node).map((shot) => (
    shot.id === shotId ? patchStoryboardShot(shot, patch) : shot
  ));
  touchProject({ sessionDelay: 250, coalesceSession: true });
}

export function addStoryboardShot(nodeId: string, afterShotId?: string): StoryboardShot | null {
  const node = projectNode(nodeId);
  if (!node) return null;
  const shots = storyboardShots(node);
  if (shots.length >= MAX_STORYBOARD_SHOTS) {
    showToast(t('canvas.storyboard.limit', { count: MAX_STORYBOARD_SHOTS }));
    return null;
  }
  const index = afterShotId ? shots.findIndex((shot) => shot.id === afterShotId) + 1 : shots.length;
  const shot = createStoryboardShot(index + 1, { durationSeconds: 6 });
  const next = [...shots];
  next.splice(index, 0, shot);
  recordCanvasHistory(t('canvas.storyboard.addShot'));
  node.storyboardShots = renumberStoryboardShots(next);
  touchProject();
  return shot;
}

export function removeStoryboardShot(nodeId: string, shotId: string): void {
  const node = projectNode(nodeId);
  if (!node) return;
  const shots = storyboardShots(node);
  const next = shots.filter((shot) => shot.id !== shotId);
  if (next.length === shots.length) return;
  recordCanvasHistory(t('canvas.storyboard.removeShot'));
  node.storyboardShots = renumberStoryboardShots(next);
  pruneStoryboardRowEdges(store.project, nodeId, next);
  touchProject();
}

export function setStoryboardShotReferences(nodeId: string, shotId: string, referenceNodeIds: string[], roles?: Partial<Record<string, StoryboardAssetRole>>): void {
  const node = projectNode(nodeId);
  if (!node) return;
  if (!storyboardShots(node).some((shot) => shot.id === shotId)) return;
  recordCanvasHistory(t('canvas.storyboard.editAssets'));
  const selected = new Set(referenceNodeIds);
  store.project.edges = store.project.edges.filter((edge: AnyRecord) => edge.target !== nodeId
    || edge.targetHandle !== storyboardRowHandle(shotId, 'in') || selected.has(edge.source));
  node.storyboardShots = storyboardShots(node).map((shot) => (
    shot.id === shotId ? {
      ...shot,
      referenceNodeIds: [...selected],
      assetRoles: Object.fromEntries([...selected].flatMap((id) => {
        const role = roles?.[id] ?? shot.assetRoles?.[id];
        return role ? [[id, role]] : [];
      })),
    } : shot
  ));
  syncStoryboardShotAssets(node, shotId);
  touchProject();
}

export function moveStoryboardShot(nodeId: string, shotId: string, direction: -1 | 1): void {
  const node = projectNode(nodeId);
  if (!node) return;
  const shots = storyboardShots(node);
  const index = shots.findIndex((shot) => shot.id === shotId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= shots.length) return;
  const next = [...shots];
  const [moved] = next.splice(index, 1);
  if (!moved) return;
  next.splice(target, 0, moved);
  recordCanvasHistory(t('canvas.storyboard.moveShot'));
  node.storyboardShots = renumberStoryboardShots(next);
  touchProject();
}

export function setStoryboardGenerationSettings(nodeId: string, settings: {
  model?: string;
  shotCount?: number | 'auto';
  shotDuration?: number | 'auto';
  extraRequirement?: string;
  videoInputMode?: 'direct' | 'keyframe';
}): void {
  const node = projectNode(nodeId);
  if (!node) return;
  if (settings.model) {
    node.model = settings.model;
    ensureGenerationConfig(node);
  }
  if (settings.shotCount !== undefined) {
    node.storyboardShotCount = settings.shotCount === 'auto'
      ? 0
      : Math.max(1, Math.min(MAX_STORYBOARD_SHOTS, Math.round(settings.shotCount)));
  }
  if (settings.shotDuration !== undefined) {
    node.storyboardShotDuration = settings.shotDuration === 'auto' ? 0 : Math.max(1, Math.round(settings.shotDuration));
  }
  if (settings.videoInputMode) node.storyboardVideoInputMode = settings.videoInputMode;
  if (settings.extraRequirement !== undefined) node.storyboardExtraRequirement = settings.extraRequirement;
  touchProject({ sessionDelay: 200, coalesceSession: true });
}

/** 启动一次真实文本任务；失败原因由 runNode 写回节点错误。 */
export function runStoryboardScriptGeneration(nodeId: string): AnyRecord | null {
  const node = projectNode(nodeId);
  if (!node || node.locked) return null;
  if (!String(node.prompt || '').trim()) {
    showToast(t('canvas.storyboard.needSource'));
    return null;
  }
  if (isActiveTaskStatus(node.status)) return null;
  node.storyboardParseError = '';
  return runNode(node, { storyboardRowsAtSubmission: JSON.stringify(storyboardShots(node)) });
}

type StoryboardAssetMedia = 'image' | 'video' | 'audio';

export function storyboardAssetMedia(node: AnyRecord): StoryboardAssetMedia | undefined {
  if (node.archived) return undefined;
  const media = selectedNodeMedia(node, store.project);
  if (!media || !String(media.filePath || media.path || '').trim()) return undefined;
  const type = media.resourceType || node.resourceType || {
    imageGeneration: 'image', videoGeneration: 'video', audioGeneration: 'audio',
  }[String(node.type)] || inferFileResourceType(media);
  return type === 'image' || type === 'video' || type === 'audio' ? type : undefined;
}

export function storyboardAssetDefaultRole(resource: AnyRecord, media?: StoryboardAssetMedia): StoryboardAssetRole {
  const purpose = assetCategoryFor(resource.category || resource.artifactType).purpose;
  if (purpose === 'character' || purpose === 'prop') return purpose;
  if (purpose === 'scene') return 'environment';
  if (media === 'video') return 'motion';
  if (media === 'audio') return 'audio';
  return 'style';
}

export function storyboardAssetCandidates(selectedIds: Set<string>) {
  return (store.project.nodes as AnyRecord[]).flatMap((node) => {
    const media = storyboardAssetMedia(node);
    if (!media || (!selectedIds.has(node.id) && node.storyboardSourceNodeId)) return [];
    return [{ node, media, role: storyboardAssetDefaultRole(node, media) }];
  });
}

export function storyboardProjectAssets() {
  const materials = new Map<string, AnyRecord>((store.project.materials as AnyRecord[]).map((item) => [item.id, item]));
  return (store.project.assets as AnyRecord[]).flatMap((asset) => {
    const material = { ...materials.get(asset.materialId), ...asset };
    const media = material.resourceType || inferFileResourceType(material);
    if ((media !== 'image' && media !== 'video' && media !== 'audio') || !String(material.filePath || material.path || '').trim()) return [];
    return [{ asset, material, media: media as StoryboardAssetMedia, role: storyboardAssetDefaultRole(asset, media) }];
  });
}

export function importStoryboardProjectAsset(assetId: string): StoryboardAssetBinding | null {
  const entry = storyboardProjectAssets().find(({ asset }) => asset.id === assetId);
  if (!entry) return null;
  const existing = store.project.nodes.find((node: AnyRecord) => (node.assetId === assetId || node.materialId === entry.asset.materialId) && storyboardAssetMedia(node));
  const node = existing || applyMaterialToCanvas({ ...entry.material, assetId });
  return node?.id ? { nodeId: String(node.id), role: entry.role } : null;
}

function isStoryboardImageNode(node: AnyRecord): boolean {
  return storyboardAssetMedia(node) === 'image';
}

export function connectStoryboardContext(sourceId: string, scriptId: string): boolean {
  const source = projectNode(sourceId);
  const script = projectNode(scriptId);
  if (!source || source.archived || !script || script.locked || !isStoryboardScriptNode(script)) return false;
  const isText = source.type === 'textGeneration';
  if (!isText && !isStoryboardImageNode(source)) return false;
  const edge = {
    targetHandle: STORYBOARD_CONTEXT_HANDLE,
    kind: 'typed-input',
    data: { inputRole: isText ? 'textContext' : 'referenceImage', required: isText, creationSource: 'storyboard-context' },
  };
  const legacy = (store.project.edges as AnyRecord[]).find((item) => item.source === sourceId && item.target === scriptId
    && item.data?.skipTaskInput !== true && (!item.targetHandle || item.targetHandle === 'port-left' || item.targetHandle === 'port-right'));
  if (legacy) {
    Object.assign(legacy, edge);
    touchProject();
    return true;
  }
  return addCanvasEdge(store.project, sourceId, scriptId, { edge }).ok;
}

function storyboardPromptReferences(node: AnyRecord): Array<{ nodeId: string; alias: string }> {
  return Array.isArray(node.promptReferences) ? node.promptReferences : [];
}

export function storyboardContextReferences(scriptId: string) {
  const node = projectNode(scriptId);
  if (!node) return [];
  const references = storyboardPromptReferences(node);
  const sources = new Set((store.project.edges as AnyRecord[])
    .filter((edge) => edge.target === scriptId && edge.data?.skipTaskInput !== true)
    .map((edge) => String(edge.source)));
  return [...sources].flatMap((id) => {
    const source = projectNode(id);
    if (!source || source.archived) return [];
    const kind = source.type === 'textGeneration' && textNodeContent(source).trim()
      ? 'text' as const
      : isStoryboardImageNode(source) ? 'image' as const : null;
    if (!kind) return [];
    const name = String(source.title || t(kind === 'text' ? 'canvas.storyboard.unnamedContext' : 'canvas.storyboard.referenceFallback'));
    const alias = references.find((item) => item.nodeId === id)?.alias;
    return [{ id, name, kind, alias }];
  });
}

export function insertStoryboardContextMention(scriptId: string, sourceId: string, start: number, end: number) {
  const node = projectNode(scriptId);
  const reference = storyboardContextReferences(scriptId).find((item) => item.id === sourceId);
  if (!node || node.locked || !reference) return null;
  const refs = storyboardPromptReferences(node);
  const base = reference.name.replace(/[@\s，。！？、,]+/gu, '-').replace(/[()（）\[\]{}]/gu, '').slice(0, 48)
    || t('canvas.storyboard.unnamedContext');
  let alias = reference.alias || base;
  for (let suffix = 2; !reference.alias && refs.some((item) => item.alias === alias); suffix += 1) {
    alias = `${base}-${suffix}`;
  }
  const draft = String(node.prompt || '');
  const left = Math.max(0, Math.min(start, draft.length));
  const right = Math.max(left, Math.min(end, draft.length));
  const token = `@${alias} `;
  recordCanvasHistory(t('canvas.storyboard.contextInsert'));
  node.prompt = draft.slice(0, left) + token + draft.slice(right);
  if (!reference.alias) node.promptReferences = [...refs, { nodeId: sourceId, alias }];
  touchProject({ sessionDelay: 250, coalesceSession: true });
  return { caret: left + token.length };
}

function incomingReferenceNodes(scriptNode: AnyRecord): AnyRecord[] {
  const nodes = store.project.nodes as AnyRecord[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const result: AnyRecord[] = [];
  const seen = new Set<string>();
  for (const edge of store.project.edges as AnyRecord[]) {
    if (edge.target !== scriptNode.id || edge.data?.skipTaskInput === true || storyboardShotIdFromHandle(edge.targetHandle, 'in')) continue;
    const source = nodeById.get(edge.source);
    if (!source || source.archived || seen.has(source.id)) continue;
    const media = selectedNodeMedia(source, store.project);
    const path = String(media?.filePath || media?.path || '');
    if (!path) continue;
    const isImage = source.type === 'imageGeneration'
      || String(source.resourceType || source.uploadedFile?.resourceType || '').toLowerCase() === 'image';
    if (!isImage) continue;
    seen.add(source.id);
    result.push(source);
  }
  return result;
}

function storyboardMediaInputRole(media: StoryboardAssetMedia) {
  return media === 'image' ? 'referenceImage' : media === 'video' ? 'inputVideo' : 'referenceAudio';
}

function connectShotNode(scriptNode: AnyRecord, shot: StoryboardShot, output: AnyRecord, references: AnyRecord[]): void {
  // Retain manual edges and reconcile only the inputs derived from this shot.
  const edges = store.project.edges as AnyRecord[];
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edge && edge.target === output.id && edge.data?.creationSource === 'storyboard-script' && ['referenceImage', 'inputVideo', 'referenceAudio'].includes(edge.data?.inputRole)) {
      edges.splice(index, 1);
    }
  }
  addCanvasEdge(store.project, scriptNode.id, output.id, {
    updateExisting: true,
    touch: false,
    edge: { sourceHandle: storyboardRowHandle(shot.id, 'out'), kind: 'typed-input', data: { inputRole: 'textContext', required: false, skipTaskInput: true, creationSource: 'storyboard-script' } },
  });
  const keyframe = output.type === 'videoGeneration' && scriptNode.storyboardVideoInputMode === 'keyframe';
  const modes = getGenerationInputModes(String(output.model || ''));
  const manualImages = edges.filter((edge) => edge.target === output.id && edge.data?.inputRole === 'referenceImage');
  const videoInputs = output.type === 'videoGeneration'
    ? references.flatMap((source) => {
        const media = storyboardAssetMedia(source);
        return media === 'video' || media === 'audio' ? [{ source, media }] : [];
      })
    : [];
  const imageInputs = references.filter((source) => isStoryboardImageNode(source));
  const manualAV = edges.filter((edge) => edge.target === output.id && ['inputVideo', 'referenceAudio'].includes(edge.data?.inputRole));
  const mode = keyframe
    ? modes.find((item) => item.slots.includes('firstFrame') && item.slots.includes('reference'))
      || modes.find((item) => item.value === 'firstFrame')
      || modes.find((item) => item.slots.includes('firstFrame'))
    : modes.find((candidate) => (manualAV.length > 0 || videoInputs.length > 0)
      && videoInputs.every(({ media }) => media === 'video' ? candidate.maxVideos > 0 : candidate.maxAudios > 0)
      && manualAV.every((edge) => edge.data.inputRole === 'inputVideo' ? candidate.maxVideos > 0 : candidate.maxAudios > 0)
      && (!(imageInputs.length || manualImages.length) || candidate.maxImages > 0))
    || (imageInputs.length || manualImages.length
      ? modes.find((item) => item.value === output.inputMode && item.slots.includes('reference'))
        || modes.find((item) => item.slots.includes('reference'))
        || modes.find((item) => item.maxImages > 0)
      : modes.find((item) => item.maxImages === 0 && item.maxAudios === 0 && item.maxVideos === 0));
  if (!mode) return;
  output.inputMode = mode.value;

  const occupied = manualImages.map((edge) => edge.data?.inputSlot).filter(Boolean) as GenerationInputSlot[];
  for (const media of ['video', 'audio'] as const) {
    const inputRole = storyboardMediaInputRole(media);
    const inputSlot = media === 'video' ? 'inputVideo' : 'referenceAudio';
    const capacity = (media === 'video' ? mode.maxVideos : mode.maxAudios)
      - manualAV.filter((edge) => edge.data.inputRole === inputRole).length;
    if (!mode.slots.includes(inputSlot)) continue;
    const candidates = videoInputs.filter((item) => item.media === media && !manualAV.some((edge) => edge.source === item.source.id));
    for (const { source } of candidates.slice(0, Math.max(0, capacity))) {
      addCanvasEdge(store.project, source.id, output.id, {
        touch: false,
        edge: { kind: 'typed-input', data: { inputRole, inputSlot, required: true, creationSource: 'storyboard-script', storyboardAssetRole: shot.assetRoles?.[source.id] ?? storyboardAssetDefaultRole(source, media) } },
      });
    }
  }
  let free = mode.maxImages - manualImages.length;
  if (keyframe && shot.imageNodeId) {
    const frame = projectNode(shot.imageNodeId);
    if (frame && !frame.archived && !occupied.includes('firstFrame') && free > 0) {
      const result = addCanvasEdge(store.project, frame.id, output.id, {
        touch: false,
        edge: {
          kind: 'typed-input',
          data: { inputRole: 'referenceImage', inputSlot: 'firstFrame', required: true, creationSource: 'storyboard-script', storyboardShotImage: true },
        },
      });
      if (result.ok && !result.existed) free -= 1;
    }
    if (!mode.slots.includes('reference')) return;
  }
  for (const source of imageInputs) {
    if (free <= 0) break;
    if (manualImages.some((edge) => edge.source === source.id)) continue;
    const slot = mode.slots.includes('reference') ? 'reference' : defaultInputSlot(mode.value, 'referenceImage', occupied);
    if (!mode.slots.includes(slot) || (slot !== 'reference' && occupied.includes(slot))) continue;
    const result = addCanvasEdge(store.project, source.id, output.id, {
      touch: false,
      edge: {
        kind: 'typed-input',
        data: { inputRole: 'referenceImage', inputSlot: slot, required: true, creationSource: 'storyboard-script', storyboardAssetRole: shot.assetRoles?.[source.id] ?? storyboardAssetDefaultRole(source, 'image') },
      },
    });
    if (result.ok && !result.existed) {
      occupied.push(slot);
      free -= 1;
    }
  }
}

function shotReferenceNodes(scriptNode: AnyRecord, shot: StoryboardShot, outputId?: string): AnyRecord[] {
  const shotReferences = storyboardShotReferenceIds(scriptNode.id, shot)
    .map((id) => projectNode(id))
    .filter((item): item is AnyRecord => Boolean(item && storyboardAssetMedia(item)));
  return [...new Map([...incomingReferenceNodes(scriptNode), ...shotReferences].map((reference) => [reference.id, reference])).values()]
    .filter((reference) => reference.id !== outputId && reference.id !== shot.imageNodeId);
}

function syncStoryboardShotAssets(scriptNode: AnyRecord, shotId: string): void {
  const shot = storyboardShots(scriptNode).find((item) => item.id === shotId);
  if (!shot) return;
  for (const id of [shot.imageNodeId, shot.videoNodeId, shot.actionBoardNodeId]) {
    if (!id) continue;
    const output = projectNode(id);
    if (!output || output.archived || isActiveTaskStatus(output.status)) continue;
    connectShotNode(scriptNode, shot, output, shotReferenceNodes(scriptNode, shot, id));
  }
}

export function ensureStoryboardShotNode(scriptNodeId: string, shotId: string, kind: StoryboardOutputKind): AnyRecord | null {
  const scriptNode = projectNode(scriptNodeId);
  if (!scriptNode) return null;
  const shots = storyboardShots(scriptNode);
  const index = shots.findIndex((shot) => shot.id === shotId);
  const shot = shots[index];
  if (!shot) return null;
  const field = storyboardOutputFields[kind];
  const existing = projectNode(shot[field] || '');
  const outputType = kind === 'video' ? 'videoGeneration' : 'imageGeneration';
  const title = t(kind === 'video' ? 'canvas.storyboard.videoNodeTitle' : kind === 'actionBoard' ? 'canvas.storyboard.actionBoardTitle' : 'canvas.storyboard.imageNodeTitle', { index: shot.shotNumber });
  const references = shotReferenceNodes(scriptNode, shot, existing?.id);
  if (existing && !existing.archived && existing.type === outputType) {
    existing.prompt = storyboardShotPrompt(shot, kind);
    if (kind === 'video') {
      existing.outputSpec = { ...(existing.outputSpec || {}), duration: shot.durationSeconds };
      existing.config = { ...(existing.config || {}), duration: shot.durationSeconds };
      ensureGenerationConfig(existing);
    }
    existing.title ||= title;
    connectShotNode(scriptNode, shot, existing, references);
    touchProject();
    return existing;
  }
  const output: AnyRecord = addNode(outputType, { select: false });
  output.title = title;
  output.prompt = storyboardShotPrompt(shot, kind);
  if (kind === 'video') {
    output.outputSpec = { ...(output.outputSpec || {}), duration: shot.durationSeconds };
    output.config = { ...(output.config || {}), duration: shot.durationSeconds };
    ensureGenerationConfig(output);
  }
  output.artifactType = 'storyboard';
  output.storyboardSourceNodeId = scriptNode.id;
  output.storyboardShotId = shot.id;
  if (kind === 'actionBoard') {
    output.storyboardActionBoard = { columns: 3, rows: 4 };
  }
  const { width, height } = defaultCanvasNodeDimensions(outputType);
  const rowHeight = Math.max(height, MEDIA_NODE_MAX_HEIGHT);
  const gap = 60;
  const column = kind === 'image' ? 0 : kind === 'video' ? 1 : 2;
  const y = Math.round(Number(scriptNode.y || 0) + index * (rowHeight + gap));
  const preferredX = Number(scriptNode.x || 0) + canvasNodeDimensions({ ...scriptNode, type: scriptNode.type }).width + 90 + column * (width + gap);
  // Previously generated shots may use different dimensions and spacing.
  const occupied = (store.project.nodes as AnyRecord[]).flatMap(node => {
    if (node.id === output.id || node.archived || node.storyboardSourceNodeId !== scriptNode.id) return [];
    const size = canvasNodeDimensions({ ...node, type: node.type });
    const otherY = Number(node.y || 0);
    if (otherY >= y + rowHeight + gap || otherY + size.height + gap <= y) return [];
    return [{ x: Number(node.x || 0), width: size.width }];
  }).sort((a, b) => a.x - b.x);
  output.x = Math.round(occupied.reduce((x, other) => (
    x + width + gap > other.x && x < other.x + other.width + gap ? other.x + other.width + gap : x
  ), preferredX));
  output.y = y;
  output.canvasSectionId = scriptNode.canvasSectionId ?? null;
  shot[field] = output.id;
  scriptNode.storyboardShots = shots;
  connectShotNode(scriptNode, shot, output, references);
  touchProject();
  return output;
}

export function storyboardShotReferenceIds(scriptId: string, shot: StoryboardShot): string[] {
  const connected = store.project.edges.filter((edge: AnyRecord) => edge.target === scriptId
    && edge.targetHandle === storyboardRowHandle(shot.id, 'in'));
  return [...new Set([...shot.referenceNodeIds, ...connected.map((edge: AnyRecord) => String(edge.source))])];
}

export function storyboardShotAssetBindings(scriptId: string, shot: StoryboardShot): StoryboardAssetBinding[] {
  return storyboardShotReferenceIds(scriptId, shot).map((nodeId) => {
    const node = projectNode(nodeId);
    return { nodeId, role: shot.assetRoles?.[nodeId] ?? (node ? storyboardAssetDefaultRole(node, storyboardAssetMedia(node)) : 'style') };
  });
}

export function setStoryboardShotAssetBindings(nodeId: string, shotId: string, bindings: StoryboardAssetBinding[]): boolean {
  if (!storyboardShots(projectNode(nodeId)).some((shot) => shot.id === shotId)) return false;
  const valid = bindings.every((binding) => {
    const node = projectNode(binding.nodeId);
    return node && storyboardAssetMedia(node) && storyboardAssetRole(binding.role);
  });
  if (!valid) return false;
  setStoryboardShotReferences(nodeId, shotId, bindings.map((binding) => binding.nodeId),
    Object.fromEntries(bindings.map(({ nodeId, role }) => [nodeId, role])));
  return true;
}

export function connectStoryboardRowAsset(sourceId: string, scriptId: string, shotId: string): boolean {
  const source = projectNode(sourceId);
  const script = projectNode(scriptId);
  const media = source && storyboardAssetMedia(source);
  if (!media || !storyboardShots(script).some((shot) => shot.id === shotId)) return false;
  const result = addCanvasEdge(store.project, sourceId, scriptId, {
    touch: false,
    edge: {
      targetHandle: storyboardRowHandle(shotId, 'in'),
      kind: 'typed-input',
      data: { inputRole: storyboardMediaInputRole(media), skipTaskInput: true, creationSource: 'storyboard-script' },
    },
  });
  if (!result.ok) return false;
  if (!result.existed) {
    if (script) syncStoryboardShotAssets(script, shotId);
    touchProject();
  }
  return true;
}

export function connectStoryboardRowOutput(scriptId: string, shotId: string, targetId: string): boolean {
  const target = projectNode(targetId);
  const shot = storyboardShots(projectNode(scriptId)).find((row) => row.id === shotId);
  if (!shot || !target || (target.type !== 'imageGeneration' && target.type !== 'videoGeneration')) return false;
  if (wouldCreateCanvasCycle(store.project, scriptId, targetId)) return false;
  const kind = target.type === 'imageGeneration' ? 'image' : 'video';
  const field = kind === 'image' ? 'imageNodeId' : 'videoNodeId';
  const previousId = shot[field];
  store.project.edges = store.project.edges.filter((edge: AnyRecord) => !(edge.source === scriptId
    && ((edge.target === previousId && previousId !== targetId && edge.sourceHandle === storyboardRowHandle(shotId, 'out'))
      || (edge.target === targetId && edge.sourceHandle !== storyboardRowHandle(shotId, 'out')))));
  const script = projectNode(scriptId)!;
  script.storyboardShots = storyboardShots(script).map((row) => ({
    ...row, [field]: row.id === shotId ? targetId : row[field] === targetId ? '' : row[field],
  }));
  return Boolean(ensureStoryboardShotNode(scriptId, shotId, kind));
}

export function createStoryboardOutputNodes(scriptId: string, kind: 'image' | 'video'): void {
  const rows = storyboardShots(projectNode(scriptId));
  if (!rows.length) return;
  if (kind === 'image' && rows.some((row) => !storyboardShotPrompt(row, kind).trim())) {
    showToast(t('canvas.storyboard.missingImagePrompt'));
    return;
  }
  recordCanvasHistory(t(kind === 'image' ? 'canvas.storyboard.generateImages' : 'canvas.storyboard.generateVideos'));
  for (const row of rows) {
    const existing = projectNode(kind === 'image' ? row.imageNodeId : row.videoNodeId);
    if (!existing || existing.archived || !isActiveTaskStatus(existing.status)) ensureStoryboardShotNode(scriptId, row.id, kind);
  }
}

export function storyboardReadyVideos(shots: StoryboardShot[]) {
  const included = new Set<string>();
  const sources = new Map(canvasVideoSources(shots.map((shot) => shot.videoNodeId)).map((source) => [source.node.id, source]));
  return shots.flatMap((shot) => {
    const source = sources.get(shot.videoNodeId);
    if (!source || included.has(shot.videoNodeId)) return [];
    included.add(shot.videoNodeId);
    return [{ ...source, shotNumber: shot.shotNumber }];
  });
}

export function storyboardFinalVideo(scriptId: string) {
  const candidates = (store.project.nodes as AnyRecord[]).filter((node) => node.storyboardFinalSourceId === scriptId && !node.archived);
  return canvasVideoSources(candidates.map((node) => node.id)).at(-1)?.node;
}

export function storyboardShotNodes(scriptNodeId: string, shotId: string): { imageNodeId: string; videoNodeId: string } {
  const node = projectNode(scriptNodeId);
  const shot = storyboardShots(node).find((item) => item.id === shotId);
  return { imageNodeId: shot?.imageNodeId || '', videoNodeId: shot?.videoNodeId || '' };
}

function waitForStoryboardTask(taskId: string, project: AnyRecord, node: AnyRecord): Promise<AnyRecord | undefined> {
  return new Promise((resolve) => {
    const check = () => {
      const current = (project.tasks as AnyRecord[]).find((item) => item.id === taskId);
      if (store.project !== project || projectNode(node.id) !== node || node.archived || !current || isTerminalTaskStatus(current.status)) {
        unsubscribe();
        resolve(current);
      }
    };
    const unsubscribe = subscribeDomain(check);
    check();
  });
}

function updateBatchItem(node: AnyRecord, batchId: string, shotId: string, patch: Partial<StoryboardBatchItem>) {
  const batch = node.storyboardBatch as StoryboardBatch | undefined;
  if (batch?.id !== batchId) return;
  storeStoryboardBatch(node, {
    ...batch,
    items: batch.items.map((item) => item.shotId === shotId ? { ...item, ...patch } : item),
  });
  touchProject();
}

async function executeStoryboardBatch(scriptNode: AnyRecord, batch: StoryboardBatch): Promise<void> {
  const project = store.project;
  const ownsBatch = () => store.project === project && projectNode(scriptNode.id) === scriptNode
    && !scriptNode.archived && scriptNode.storyboardBatch?.id === batch.id;
  runningStoryboards.add(scriptNode);
  storeStoryboardBatch(scriptNode, batch);
  touchProject();
  try {
    for (const item of batch.items) {
      if (!ownsBatch()) return;
      const current = (scriptNode.storyboardBatch as StoryboardBatch).items.find((candidate) => candidate.shotId === item.shotId);
      if (current?.status !== 'waiting') continue;
      const fail = (error: string) => updateBatchItem(scriptNode, batch.id, item.shotId, { status: 'failed', error });
      const shot = storyboardShots(scriptNode).find((row) => row.id === item.shotId);
      if (!shot || !storyboardShotPrompt(shot, batch.kind).trim()) {
        fail(t('canvas.storyboard.batchMissingShot'));
        continue;
      }
      const existing = projectNode(shot[storyboardOutputFields[batch.kind]] || '');
      if (existing && isActiveTaskStatus(existing.status)) {
        fail(t('canvas.storyboard.runBusy'));
        continue;
      }
      if (existing && storyboardAssetMedia(existing) === storyboardOutputMedia(batch.kind) && !item.force) {
        updateBatchItem(scriptNode, batch.id, shot.id, { status: 'completed' });
        continue;
      }
      const previousTask = existing ? findLatestTaskForNode(existing.id) : null;
      if (previousTask?.submissionUncertain === true) {
        updateBatchItem(scriptNode, batch.id, shot.id, {
          status: 'failed', error: t('plugins.submissionUnknown'), taskId: String(previousTask.id),
        });
        continue;
      }
      const output = ensureStoryboardShotNode(scriptNode.id, shot.id, batch.kind);
      if (!output) {
        fail(t('canvas.storyboard.batchMissingShot'));
        continue;
      }
      if (batch.kind === 'video' && scriptNode.storyboardVideoInputMode === 'keyframe') {
        const image = projectNode(shot.imageNodeId);
        const connected = project.edges.some((edge: AnyRecord) => edge.target === output.id && edge.source === image?.id && edge.data?.inputSlot === 'firstFrame');
        if (!image || !isStoryboardImageNode(image) || !connected) {
          fail(t('canvas.storyboard.missingKeyframeInput', { index: shot.shotNumber }));
          continue;
        }
      }
      const submissionId = uid();
      updateBatchItem(scriptNode, batch.id, shot.id, { status: 'submitting', submissionId, attempts: current.attempts + 1 });
      const task = runNode(projectNode(output.id), { submissionId });
      if (!task) {
        fail(String(output.error || t('canvas.storyboard.batchSubmissionFailed')));
        continue;
      }
      updateBatchItem(scriptNode, batch.id, shot.id, { status: 'running', taskId: String(task.id) });
      const finished = await waitForStoryboardTask(String(task.id), project, scriptNode);
      if (!ownsBatch()) return;
      updateBatchItem(scriptNode, batch.id, shot.id, {
        status: finished?.status === 'completed' || finished?.status === 'cancelled' ? finished.status : 'failed',
        error: String(finished?.error || (finished ? '' : t('canvas.storyboard.batchInterrupted'))),
      });
    }
  } finally {
    runningStoryboards.delete(scriptNode);
    if (ownsBatch()) touchProject();
  }
}

export async function retryStoryboardBatch(nodeId: string, batchId: string, shotId?: string): Promise<void> {
  const node = projectNode(nodeId);
  if (!node || node.locked || isStoryboardRunActive(nodeId)) return;
  const latest = storyboardBatch(node);
  const batch = latest?.id === batchId ? latest : (['image', 'video', 'actionBoard'] as const)
    .map((kind) => storyboardBatch(node, kind)).find((candidate) => candidate?.id === batchId);
  if (!batch) return;
  const retryIds = new Set(batch.items.filter((item) => item.retryable && (!shotId || item.shotId === shotId)).map((item) => item.shotId));
  if (!retryIds.size) return;
  await executeStoryboardBatch(node, {
    ...batch,
    items: batch.items.map(({ retryable: _retryable, ...item }) => retryIds.has(item.shotId)
      ? { shotId: item.shotId, shotNumber: item.shotNumber, status: 'waiting', attempts: item.attempts, force: item.force === true }
      : item),
  });
}

type StoryboardTargetState = 'ready' | 'done' | 'busy' | 'noPrompt' | 'missingKeyframe' | 'uncertain';

export function storyboardGenerationTargets(scriptNode: AnyRecord, shots: StoryboardShot[], kind: StoryboardOutputKind, force = false) {
  const batch = storyboardBatch(scriptNode, kind);
  const items = new Map(batch?.kind === kind ? batch.items.map((item) => [item.shotId, item]) : []);
  const keyframeMode = kind === 'video' && scriptNode.storyboardVideoInputMode === 'keyframe';
  return shots.map((shot): { shot: StoryboardShot; state: StoryboardTargetState } => {
    const output = projectNode(shot[storyboardOutputFields[kind]] || '');
    const item = items.get(shot.id);
    if (item?.status === 'waiting' || item?.status === 'submitting' || isActiveTaskStatus(item?.status)
      || (output && isActiveTaskStatus(output.status))) return { shot, state: 'busy' };
    if (item?.uncertain || (output && findLatestTaskForNode(output.id)?.submissionUncertain === true)) return { shot, state: 'uncertain' };
    if (!force && output && storyboardAssetMedia(output) === storyboardOutputMedia(kind)) return { shot, state: 'done' };
    if (!storyboardShotPrompt(shot, kind).trim()) return { shot, state: 'noPrompt' };
    const image = keyframeMode && projectNode(shot.imageNodeId);
    if (keyframeMode && (!image || !isStoryboardImageNode(image))) return { shot, state: 'missingKeyframe' };
    return { shot, state: 'ready' };
  });
}

export function storyboardShotInputSources(scriptNode: AnyRecord, shot: StoryboardShot) {
  const bindings = storyboardShotAssetBindings(scriptNode.id, shot);
  const bindingById = new Map(bindings.map((item) => [item.nodeId, item]));
  const shared = new Set(incomingReferenceNodes(scriptNode).map((node) => String(node.id)));
  const sources = new Map<string, Set<'shared' | 'shot' | 'row' | 'image' | 'video' | 'firstFrame' | 'actionBoard'>>();
  const register = (id: string, source: 'shared' | 'shot' | 'row' | 'image' | 'video' | 'firstFrame' | 'actionBoard') => {
    if (!id) return;
    if (!sources.has(id)) sources.set(id, new Set());
    sources.get(id)!.add(source);
  };
  for (const id of shared) register(id, 'shared');
  for (const { nodeId } of bindings) {
    if (shot.referenceNodeIds.includes(nodeId)) register(nodeId, 'shot');
  }
  for (const edge of store.project.edges as AnyRecord[]) {
    if (edge.target === scriptNode.id && edge.targetHandle === storyboardRowHandle(shot.id, 'in')) register(edge.source, 'row');
    if (edge.data?.skipTaskInput === true) continue;
    if (edge.target === shot.imageNodeId) register(edge.source, 'image');
    if (shot.actionBoardNodeId && edge.target === shot.actionBoardNodeId) register(edge.source, 'actionBoard');
    if (edge.target === shot.videoNodeId) register(edge.source, edge.data?.inputSlot === 'firstFrame' ? 'firstFrame' : 'video');
  }
  if (scriptNode.storyboardVideoInputMode === 'keyframe' && projectNode(shot.imageNodeId)) register(shot.imageNodeId, 'firstFrame');
  return [...sources].map(([id, via]) => {
    const node = projectNode(id);
    return { id, node, role: bindingById.get(id)?.role ?? (node ? storyboardAssetDefaultRole(node, storyboardAssetMedia(node)) : undefined), via: [...via] };
  });
}

/** 顺序生成，避免多个付费任务同时抢同一模型；单行按钮也用同一入口。 */
export async function runStoryboardShots(scriptNodeId: string, kind: StoryboardOutputKind, shotIds?: string[], options: { force?: boolean } = {}): Promise<void> {
  const scriptNode = projectNode(scriptNodeId);
  if (!scriptNode) return;
  if (isStoryboardRunActive(scriptNodeId)) {
    showToast(t('canvas.storyboard.runBusy'));
    return;
  }
  if (scriptNode.locked) return;
  const shots = storyboardShots(scriptNode).filter((shot) => !shotIds || shotIds.includes(shot.id));
  const targets = storyboardGenerationTargets(scriptNode, shots, kind, options.force);
  const missing = targets.find((item) => item.state === 'missingKeyframe');
  if (missing) {
    showToast(t('canvas.storyboard.missingKeyframe', { index: missing.shot.shotNumber }));
    return;
  }
  const runnable = targets.filter((item) => item.state === 'ready').map((item) => item.shot);
  if (!runnable.length) {
    showToast(t(targets.some((item) => item.state === 'uncertain') ? 'plugins.submissionUnknown' : 'canvas.storyboard.nothingToRun'));
    return;
  }
  if (!getAvailableModelIdsByType(kind === 'video' ? 'videoGeneration' : 'imageGeneration').length) {
    showToast(t('canvas.storyboard.noModel'));
    return;
  }
  await executeStoryboardBatch(scriptNode, {
    id: uid(),
    kind,
    items: runnable.map((shot) => ({ shotId: shot.id, shotNumber: shot.shotNumber, status: 'waiting', attempts: 0, force: options.force === true })),
  });
}

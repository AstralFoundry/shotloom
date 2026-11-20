import { t } from '@/i18n';
import { store, touchProject } from '@/store/projectStore';
import { addNode, ensureGenerationConfig } from '@/store/nodeStore';
import { selectedNodeMedia } from '@/utils/nodeMedia';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { runNode } from '@/store/taskStore';
import { isActiveTaskStatus, isTerminalTaskStatus } from '@/domain/tasks/TaskStatus';
import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import { defaultInputSlot, type GenerationInputSlot } from '@/domain/graph/GenerationInputContract';
import { showToast } from '@/store/notificationStore';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import {
  STORYBOARD_SCRIPT_SUBTASK,
  STORYBOARD_SCRIPT_VIEW,
  MAX_STORYBOARD_SHOTS,
  createStoryboardShot,
  normalizeStoryboardShots,
  patchStoryboardShot,
  renumberStoryboardShots,
  storyboardShotPrompt,
  type StoryboardShot,
  type StoryboardShotPatch,
} from '@/domain/graph/StoryboardScript';

type AnyRecord = Record<string, any>;

function projectNode(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

export function storyboardShots(node: AnyRecord | null | undefined): StoryboardShot[] {
  return normalizeStoryboardShots(node?.storyboardShots);
}

/** 分镜脚本复用文本生成节点：模型、任务与凭据沿用同一条真实链路。 */
export function createStoryboardScriptNode(position: { x: number; y: number }): AnyRecord {
  recordCanvasHistory(t('canvas.storyboard.create'));
  const node: AnyRecord = addNode('textGeneration');
  node.title = t('canvas.storyboard.title');
  node.titleOverride = node.title;
  node.canvasView = STORYBOARD_SCRIPT_VIEW;
  node.artifactType = 'storyboard';
  node.canvasWidth = 920;
  node.canvasHeight = 440;
  node.x = Math.round(position.x);
  node.y = Math.round(position.y);
  node.prompt = '';
  node.config = { ...(node.config || {}), textSubtask: STORYBOARD_SCRIPT_SUBTASK };
  node.storyboardShots = [];
  node.storyboardShotCount = 8;
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
  const shot = createStoryboardShot(index + 1, { plot: '' });
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
  const next = storyboardShots(node).filter((shot) => shot.id !== shotId);
  recordCanvasHistory(t('canvas.storyboard.removeShot'));
  node.storyboardShots = renumberStoryboardShots(next);
  touchProject();
}

export function setStoryboardShotReferences(nodeId: string, shotId: string, referenceNodeIds: string[]): void {
  const node = projectNode(nodeId);
  if (!node) return;
  recordCanvasHistory(t('canvas.storyboard.editAssets'));
  node.storyboardShots = storyboardShots(node).map((shot) => (
    shot.id === shotId ? { ...shot, referenceNodeIds: [...new Set(referenceNodeIds)] } : shot
  ));
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
  if (settings.extraRequirement !== undefined) node.storyboardExtraRequirement = settings.extraRequirement;
  touchProject({ sessionDelay: 200, coalesceSession: true });
}

/** 启动一次真实文本任务；失败原因由 runNode 写回节点错误。 */
export function runStoryboardScriptGeneration(nodeId: string): AnyRecord | null {
  const node = projectNode(nodeId);
  if (!node) return null;
  if (!String(node.prompt || '').trim()) {
    showToast(t('canvas.storyboard.needSource'));
    return null;
  }
  node.storyboardParseError = '';
  return runNode(node);
}

function isStoryboardImageNode(node: AnyRecord): boolean {
  if (node.archived) return false;
  if (node.type !== 'imageGeneration' && String(node.resourceType || node.uploadedFile?.resourceType || '').toLowerCase() !== 'image') return false;
  const media = selectedNodeMedia(node, store.project);
  return Boolean(String(media?.filePath || media?.path || ''));
}

function incomingReferenceNodes(scriptNode: AnyRecord): AnyRecord[] {
  const nodes = store.project.nodes as AnyRecord[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const result: AnyRecord[] = [];
  const seen = new Set<string>();
  for (const edge of store.project.edges as AnyRecord[]) {
    if (edge.target !== scriptNode.id || edge.data?.skipTaskInput === true) continue;
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

function connectShotImage(output: AnyRecord, imageNodeId: string): void {
  const imageNode = projectNode(imageNodeId);
  if (!imageNode || imageNode.archived) return;
  // 镜头视频本来就应该从这一镜的分镜图开始；用户手工连的其他参考仍保留。
  const edges = store.project.edges as AnyRecord[];
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (!edge || edge.target !== output.id || !edge.data?.storyboardShotImage) continue;
    if (edge.source !== imageNodeId) edges.splice(index, 1);
  }
  if (edges.some((edge) => edge.target === output.id && edge.source === imageNodeId && edge.data?.storyboardShotImage)) return;
  const modes = getGenerationInputModes(String(output.model || ''));
  const mode = modes.find((item) => item.maxImages > 0);
  if (!mode) return;
  output.inputMode = mode.value;
  const slot = mode.slots.includes('firstFrame') ? 'firstFrame' : 'reference';
  addCanvasEdge(store.project, imageNodeId, output.id, {
    edge: {
      kind: 'typed-input',
      data: { inputRole: 'referenceImage', inputSlot: slot, required: true, creationSource: 'storyboard-script', storyboardShotImage: true },
    },
  });
}

function connectShotNode(scriptNode: AnyRecord, output: AnyRecord, references: AnyRecord[]): void {
  // 用户手工加的参考边不动；只同步本功能以前写入、现已不存在的参考。
  const edges = store.project.edges as AnyRecord[];
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (!edge) continue;
    if (edge?.target !== output.id || edge.data?.creationSource !== 'storyboard-script') continue;
    if (edge.data?.inputRole !== 'referenceImage' || edge.data?.storyboardShotImage) continue;
    if (!references.some((source) => source.id === edge.source)) edges.splice(index, 1);
  }
  addCanvasEdge(store.project, scriptNode.id, output.id, {
    edge: { kind: 'typed-input', data: { inputRole: 'textContext', required: false, creationSource: 'storyboard-script' } },
  });
  if (!references.length) return;
  const modes = getGenerationInputModes(String(output.model || ''));
  const mode = modes.find((item) => item.maxImages > 0);
  if (!mode) return;
  output.inputMode = mode.value;
  const occupied = (store.project.edges as AnyRecord[])
    .filter((edge) => edge.target === output.id)
    .map((edge) => edge.data?.inputSlot)
    .filter(Boolean) as GenerationInputSlot[];
  for (const source of references) {
    const slot = defaultInputSlot(mode.value, 'referenceImage', occupied);
    if (slot) occupied.push(slot);
    addCanvasEdge(store.project, source.id, output.id, {
      edge: {
        kind: 'typed-input',
        data: { inputRole: 'referenceImage', ...(slot ? { inputSlot: slot } : {}), required: true, creationSource: 'storyboard-script' },
      },
    });
  }
}

export function ensureStoryboardShotNode(scriptNodeId: string, shotId: string, kind: 'image' | 'video'): AnyRecord | null {
  const scriptNode = projectNode(scriptNodeId);
  if (!scriptNode) return null;
  const shots = storyboardShots(scriptNode);
  const index = shots.findIndex((shot) => shot.id === shotId);
  const shot = shots[index];
  if (!shot) return null;
  const field = kind === 'image' ? 'imageNodeId' : 'videoNodeId';
  const existing = projectNode(shot[field]);
  const outputType = kind === 'image' ? 'imageGeneration' : 'videoGeneration';
  if (existing && existing.type === outputType) {
    existing.prompt = storyboardShotPrompt(shot, kind);
    existing.title ||= t(kind === 'image' ? 'canvas.storyboard.imageNodeTitle' : 'canvas.storyboard.videoNodeTitle', { index: shot.shotNumber });
    touchProject();
    return existing;
  }
  const output: AnyRecord = addNode(outputType, { select: false });
  output.title = t(kind === 'image' ? 'canvas.storyboard.imageNodeTitle' : 'canvas.storyboard.videoNodeTitle', { index: shot.shotNumber });
  output.prompt = storyboardShotPrompt(shot, kind);
  output.artifactType = 'storyboard';
  output.storyboardSourceNodeId = scriptNode.id;
  output.storyboardShotId = shot.id;
  output.x = Math.round(Number(scriptNode.x || 0) + Number(scriptNode.canvasWidth || 1000) + 90);
  output.y = Math.round(Number(scriptNode.y || 0) + index * 330);
  output.canvasSectionId = scriptNode.canvasSectionId ?? null;
  shot[field] = output.id;
  scriptNode.storyboardShots = shots;
  const shotReferences = shot.referenceNodeIds
    .map((id) => projectNode(id))
    .filter((item): item is AnyRecord => Boolean(item) && isStoryboardImageNode(item as AnyRecord));
  connectShotNode(scriptNode, output, shotReferences.length ? shotReferences : incomingReferenceNodes(scriptNode));
  if (kind === 'video' && shot.imageNodeId) connectShotImage(output, shot.imageNodeId);
  touchProject();
  return output;
}

export function storyboardShotNodes(scriptNodeId: string, shotId: string): { imageNodeId: string; videoNodeId: string } {
  const node = projectNode(scriptNodeId);
  const shot = storyboardShots(node).find((item) => item.id === shotId);
  return { imageNodeId: shot?.imageNodeId || '', videoNodeId: shot?.videoNodeId || '' };
}

function waitForNode(nodeId: string, project: AnyRecord, timeoutMs = 15 * 60 * 1000): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (store.project !== project) return resolve();
      const node = projectNode(nodeId);
      if (!node || node.archived) return resolve();
      if (!isActiveTaskStatus(node.status) && (isTerminalTaskStatus(node.status) || node.error)) return resolve();
      if (Date.now() - startedAt > timeoutMs) return resolve();
      window.setTimeout(tick, 1200);
    };
    tick();
  });
}

/** 顺序生成，避免多个付费任务同时抢同一模型；单行按钮也用同一入口。 */
export async function runStoryboardShots(scriptNodeId: string, kind: 'image' | 'video', shotIds?: string[]): Promise<void> {
  const scriptNode = projectNode(scriptNodeId);
  if (!scriptNode) return;
  const project = store.project;
  const targets = storyboardShots(scriptNode)
    .filter((shot) => !shotIds || shotIds.includes(shot.id))
    .filter((shot) => Boolean(storyboardShotPrompt(shot, kind).trim()));
  const runnable = targets.filter((shot) => {
    if (kind === 'image' ? shot.imageNodeId : shot.videoNodeId) {
      if (shotIds) return true;
      const node = projectNode(kind === 'image' ? shot.imageNodeId : shot.videoNodeId);
      if (node?.status === 'completed') return false;
    }
    return true;
  });
  if (!runnable.length) {
    showToast(t('canvas.storyboard.nothingToRun'));
    return;
  }
  if (!getAvailableModelIdsByType(kind === 'image' ? 'imageGeneration' : 'videoGeneration').length) {
    showToast(t('canvas.storyboard.noModel'));
    return;
  }
  for (const shot of runnable) {
    if (store.project !== project) return;
    const output = ensureStoryboardShotNode(scriptNodeId, shot.id, kind);
    if (!output) continue;
    if (output.status === 'completed' && shotIds) continue;
    runNode(output);
    await waitForNode(output.id, project);
  }
}

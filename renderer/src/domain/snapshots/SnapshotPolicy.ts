/**
 * 画布快照的取舍规则。
 *
 * 快照只在「内容真的变了」且「离上次足够久」时写入，并且给单份体积设上限：
 * 项目文件里的撤销栈、选择态、视口都是本机界面状态，不属于作品内容，写进快照
 * 只会让体积翻倍、恢复时把界面状态也带回过去。
 */

import { stableFingerprint, utf8ByteLength } from '@/utils/stableJson';

/** 普通快照的最短间隔：更密集的保存不产生新版本。 */
export const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;
/** 每个项目保留的快照数量。 */
export const SNAPSHOT_LIMIT = 20;
/** 单份快照的 payload 上限，超过时只留元数据（degraded）。 */
export const SNAPSHOT_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export type SnapshotReason = 'auto' | 'manual' | 'before_restore';

export interface SnapshotMeta {
  id?: string;
  createdAt: string;
  contentHash: string;
  payloadBytes?: number;
  reason?: string | undefined;
  degraded?: boolean | undefined;
  /** 该版本引用的素材 id，删除素材前用它判断历史版本是否仍在使用。 */
  mediaRefs?: string[] | undefined;
}

export type SnapshotDecision =
  | { action: 'create'; degraded: boolean }
  | { action: 'skip'; reason: 'unchanged' | 'throttled' };

/**
 * 不属于作品内容的键：撤销栈、选择、视口、书架与克隆进度等本机界面状态。
 * 其中撤销栈每项都是完整的节点/连线副本，是快照体积最大的浪费来源。
 */
const VOLATILE_KEYS = [
  'canvasHistory',
  'selectedNodeId',
  'selectedNodeIds',
  'selectedEdgeId',
  'viewport',
  'recentProjects',
  'projectLibraryEntries',
  'cloneProgressByProject',
  'notifications',
];

/** 生成快照 payload：去掉本机界面状态，并保证与原对象不共享引用。 */
export function snapshotPayload(project: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source = (project || {}) as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (VOLATILE_KEYS.includes(key)) continue;
    clone[key] = value;
  }
  return JSON.parse(JSON.stringify(clone)) as Record<string, unknown>;
}

/** 内容指纹：忽略键序，只反映作品内容。 */
export function snapshotContentHash(payload: unknown): string {
  return stableFingerprint(payload ?? {});
}

/** 序列化后的 UTF-8 字节数，用于体积上限判断。 */
export function snapshotPayloadBytes(payload: unknown): number {
  return utf8ByteLength(JSON.stringify(payload ?? {}));
}

/**
 * 是否写快照。
 *
 * @param options.previous 最近一份快照的元数据（没有则视为首次）
 * @param options.now 当前时间戳（毫秒）
 * @param options.force 手动保存/恢复前备份，跳过间隔限制
 */
export function decideSnapshot({
  reason,
  now,
  previous,
  hash,
  bytes,
}: {
  reason: SnapshotReason;
  now: number;
  previous?: SnapshotMeta | null;
  hash: string;
  bytes: number;
}): SnapshotDecision {
  if (previous && previous.contentHash === hash) return { action: 'skip', reason: 'unchanged' };
  const forced = reason !== 'auto';
  if (!forced && previous) {
    const lastAt = Date.parse(previous.createdAt) || 0;
    if (now - lastAt < SNAPSHOT_MIN_INTERVAL_MS) return { action: 'skip', reason: 'throttled' };
  }
  return { action: 'create', degraded: bytes > SNAPSHOT_MAX_PAYLOAD_BYTES };
}

/**
 * 版本引用的素材 id 集合。
 *
 * 只收集会被 `deleteMaterialFile` 当作删除键的 material id：项目素材表、
 * 节点直接引用的素材、节点上传文件与生成产物。快照里的媒体只是引用，
 * 真正的文件仍归当前项目所有，因此这里只记 id 不记路径。
 */
export function snapshotMediaRefs(payload: Record<string, unknown> | null | undefined): string[] {
  const source = payload || {};
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  for (const material of Array.isArray(source.materials) ? (source.materials as Record<string, unknown>[]) : []) {
    add(material?.id);
  }
  for (const node of Array.isArray(source.nodes) ? (source.nodes as Record<string, unknown>[]) : []) {
    add(node?.materialId);
    add((node?.uploadedFile as Record<string, unknown> | undefined)?.materialId);
    for (const output of Array.isArray(node?.generatedOutputs) ? (node.generatedOutputs as Record<string, unknown>[]) : []) {
      add(output?.materialId);
    }
  }
  return [...ids];
}

/** 列表展示用的摘要：不读取 payload，只看结构与体积。 */
export function snapshotSummary(payload: Record<string, unknown> | null | undefined) {
  const source = payload || {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const edges = Array.isArray(source.edges) ? source.edges : [];
  return {
    title: String(source.name || source.title || ''),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    taskCount: Array.isArray(source.tasks) ? source.tasks.length : 0,
  };
}

/**
 * 只读预览用的结构摘要：不触碰 store，也不把整份 payload 交给界面。
 * 节点清单按画布顺序截断，避免大项目把抽屉撑爆。
 */
export function snapshotPreview(payload: Record<string, unknown> | null | undefined) {
  const source = payload || {};
  const nodes = Array.isArray(source.nodes) ? (source.nodes as Record<string, unknown>[]) : [];
  return {
    ...snapshotSummary(source),
    nodes: nodes.slice(0, 50).map((node) => ({
      id: String(node.id || ''),
      title: String(node.title || node.name || ''),
      type: String(node.type || ''),
    })),
    truncated: nodes.length > 50,
  };
}

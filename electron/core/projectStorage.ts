import { eq, and, asc, desc } from 'drizzle-orm';
import { orm } from './sqliteOrm';
import * as models from './schema';
import type { CollectionName } from './schema';
import type { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';
import { insertCollectionRecord, metadataValue, setMetadataValue, transaction, withDatabase } from './db';

/**
 * 项目数据库（project.sqlite）的读写，对应 src-tauri/src/crud/project_crud.rs。
 * 集合按「删除 + 重新插入」维护位置顺序，和 Rust 的逐行 diff 结果等价，
 * 但 SQL 面更小、更容易验证；外键在事务里仍然生效。
 */

export const SNAPSHOT_LIMIT = 20;

interface CollectionSpec { table: CollectionName; key: string; }

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const COLLECTIONS: CollectionSpec[] = [
  { table: 'nodes', key: 'nodes' },
  { table: 'edges', key: 'edges' },
  { table: 'tasks', key: 'tasks' },
  { table: 'assets', key: 'assets' },
  { table: 'materials', key: 'materials' },
  { table: 'conversations', key: 'harnessSessions' },
  { table: 'production_plans', key: 'productionPlans' },
  { table: 'agent_batches', key: 'agentBatches' },
  { table: 'agent_evaluations', key: 'agentEvaluations' },
];

const PROJECT_ONLY_KEYS = new Set([
  ...COLLECTIONS.map(spec => spec.key),
  'canvasHistory', 'canvasRedoStack', 'storageRevision',
]);

type ProjectRecord = Record<string, unknown>;

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

export function loadProjectFile(path: string): Record<string, unknown> | null {
  return withDatabase(path, (db) => transaction(db, () => loadProject(db)));
}

export function loadProject(db: DatabaseSync): ProjectRecord | null {
  const row = orm(db).select().from(models.projects).where(eq(models.projects.id, 1)).get();
  if (!row) return null;
  const value = parse<ProjectRecord>(row.payload);
  value.storageRevision = Number(row.revision);
  for (const spec of COLLECTIONS) value[spec.key] = loadCollection(db, spec.table);
  value.canvasHistory = loadHistory(db, 'undo');
  value.canvasRedoStack = loadHistory(db, 'redo');
  return value;
}

function loadCollection(db: DatabaseSync, table: CollectionName): unknown[] {
  return (orm(db).select().from(models.collectionTables[table]).orderBy(asc(models.collectionTables[table].position)).all())
    .map(row => parse(row.payload));
}

function loadHistory(db: DatabaseSync, stack: string): unknown[] {
  return (orm(db).select().from(models.canvas_history).where(eq(models.canvas_history.stack, stack)).orderBy(asc(models.canvas_history.position)).all())
    .map(row => parse(row.payload));
}

export function saveProject(db: DatabaseSync, value: ProjectRecord): ProjectRecord {
  const current = orm(db).select().from(models.projects).where(eq(models.projects.id, 1)).get();
  const revision = current ? Number(current.revision) : 0;
  if (typeof value.storageRevision === 'number' && value.storageRevision !== revision) {
    throw new Error(localizedError('native.storage.7a2275e121', {}, '工程已被另一窗口修改，请重新打开后再保存'));
  }
  for (const spec of COLLECTIONS) saveCollection(db, spec, value[spec.key]);
  saveHistory(db, 'undo', value.canvasHistory);
  saveHistory(db, 'redo', value.canvasRedoStack);

  const metadata: ProjectRecord = { ...value };
  for (const key of PROJECT_ONLY_KEYS) delete metadata[key];
  const record = {
    name: text(value.name),
    created_at: text(value.createdAt),
    updated_at: text(value.updatedAt),
    revision: revision + 1,
    payload: JSON.stringify(metadata),
  };
  orm(db).insert(models.projects).values({ id: 1, ...record })
    .onConflictDoUpdate({ target: models.projects.id, set: record }).run();
  return { ...value, storageRevision: revision + 1 };
}

function saveCollection(db: DatabaseSync, spec: CollectionSpec, rawRows: unknown): void {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const seen = new Set<string>();
  for (const payload of rows) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(localizedError('native.storage.67d9a58c03', { collection: spec.key }, `${spec.key}记录缺少稳定 id`));
    }
    const id = (payload as ProjectRecord).id;
    if (typeof id !== 'string' || !id) {
      throw new Error(localizedError('native.storage.67d9a58c03', { collection: spec.key }, `${spec.key}记录缺少稳定 id`));
    }
    if (seen.has(id)) {
      throw new Error(localizedError('native.storage.247978142c', { collection: spec.key, id }, `${spec.key}存在重复 id：${id}`));
    }
    seen.add(id);
  }
  orm(db).delete(models.collectionTables[spec.table]).run();
  rows.forEach((payload, position) => {
    const record = payload as ProjectRecord;
    insertCollectionRecord(db, spec.table, String(record.id), position, record);
  });
}

function saveHistory(db: DatabaseSync, stack: string, rawEntries: unknown): void {
  orm(db).delete(models.canvas_history).where(eq(models.canvas_history.stack, stack)).run();
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  entries.forEach((payload, position) => {
    orm(db).insert(models.canvas_history).values({ stack, position, payload: JSON.stringify(payload) }).run();
  });
}

// ── 画布快照 ────────────────────────────────────────────────────────────────

export function listProjectSnapshots(path: string): unknown[] {
  return withDatabase(path, (db) => {
    const rows = orm(db).select().from(models.project_snapshots).orderBy(desc(models.project_snapshots.created_at)).all();
    return rows.map(row => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      reason: String(row.reason),
      contentHash: String(row.content_hash),
      payloadBytes: Number(row.payload_bytes),
      mediaRefs: parse(row.media_refs),
      degraded: Boolean(row.degraded),
    }));
  });
}

export function createProjectSnapshot(path: string, record: Record<string, unknown>): { saved: true } {
  return withDatabase(path, (db) => transaction(db, () => {
    const id = typeof record.id === 'string' && record.id ? record.id : '';
    if (!id) throw new Error('snapshot record is missing id');
    orm(db).insert(models.project_snapshots).values({
      id, created_at: text(record.createdAt), reason: text(record.reason) || 'auto',
      content_hash: text(record.contentHash), payload_bytes: typeof record.payloadBytes === 'number' ? record.payloadBytes : 0,
      media_refs: JSON.stringify(Array.isArray(record.mediaRefs) ? record.mediaRefs : []), degraded: record.degraded === true ? 1 : 0,
      payload: record.payload === undefined || record.payload === null ? null : JSON.stringify(record.payload),
    }).run();
    const stale = orm(db).select({ id: models.project_snapshots.id }).from(models.project_snapshots)
      .orderBy(desc(models.project_snapshots.created_at)).all().slice(SNAPSHOT_LIMIT);
    for (const row of stale) orm(db).delete(models.project_snapshots).where(eq(models.project_snapshots.id, row.id)).run();
    return { saved: true } as const;
  }));
}

export function readProjectSnapshot(path: string, id: string): unknown {
  return withDatabase(path, (db) => {
    const row = orm(db).select().from(models.project_snapshots).where(eq(models.project_snapshots.id, id)).get();
    return row && row.payload !== null ? parse(row.payload) : null;
  });
}

// ── 编辑器快照 / 片段记录 ───────────────────────────────────────────────────

/** Include editor undo/history records, which live outside the project JSON. */
export function editorMediaState(path: string): unknown[] {
  return withDatabase(path, db => [
    ...orm(db).select({ payload: models.editor_snapshots.payload }).from(models.editor_snapshots).all(),
    ...orm(db).select({ payload: models.editor_records.payload }).from(models.editor_records).all(),
  ].map(row => JSON.parse(row.payload)));
}

export function editorSnapshot(path: string, nodeId: string): unknown {
  return withDatabase(path, (db) => {
    const row = orm(db).select().from(models.editor_snapshots).where(eq(models.editor_snapshots.node_id, nodeId)).get();
    return row ? parse(row.payload) : null;
  });
}

export function saveEditorSnapshot(path: string, nodeId: string, payload: unknown): unknown {
  return withDatabase(path, (db) => transaction(db, () => {
    const existing = orm(db).select().from(models.editor_snapshots).where(eq(models.editor_snapshots.node_id, nodeId)).get();
    const value = { node_id: nodeId, revision: existing ? existing.revision + 1 : 1, payload: JSON.stringify(payload) };
    orm(db).insert(models.editor_snapshots).values(value)
      .onConflictDoUpdate({ target: models.editor_snapshots.node_id, set: value }).run();
    return payload;
  }));
}

export function editorRecord(path: string, nodeId: string, key: string): unknown {
  return withDatabase(path, (db) => {
    const row = orm(db).select().from(models.editor_records).where(and(eq(models.editor_records.node_id, nodeId), eq(models.editor_records.key, key))).get();
    return row ? parse(row.payload) : null;
  });
}

export function setEditorRecord(path: string, nodeId: string, key: string, payload: unknown): void {
  withDatabase(path, (db) => transaction(db, () => {
    if (payload === undefined || payload === null) {
      orm(db).delete(models.editor_records).where(and(eq(models.editor_records.node_id, nodeId), eq(models.editor_records.key, key))).run();
      return;
    }
    const value = { node_id: nodeId, key, payload: JSON.stringify(payload) };
    orm(db).insert(models.editor_records).values(value)
      .onConflictDoUpdate({ target: [models.editor_records.node_id, models.editor_records.key], set: { payload: value.payload } }).run();
  }));
}

export { metadataValue, setMetadataValue };

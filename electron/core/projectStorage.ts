import type { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';
import { insertRecord, metadataValue, setMetadataValue, transaction, withDatabase, type Row } from './db';

/**
 * 项目数据库（project.sqlite）的读写，对应 src-tauri/src/crud/project_crud.rs。
 * 集合按「删除 + 重新插入」维护位置顺序，和 Rust 的逐行 diff 结果等价，
 * 但 SQL 面更小、更容易验证；外键在事务里仍然生效。
 */

export const SNAPSHOT_LIMIT = 20;

interface CollectionSpec { table: string; key: string; columns: (payload: Record<string, unknown>) => Record<string, unknown>; }

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const COLLECTIONS: CollectionSpec[] = [
  { table: 'nodes', key: 'nodes', columns: payload => ({ kind: text(payload.type), title: text(payload.title) }) },
  { table: 'edges', key: 'edges', columns: payload => ({ source: text(payload.source), target: text(payload.target) }) },
  { table: 'tasks', key: 'tasks', columns: payload => ({ node_id: typeof payload.nodeId === 'string' ? payload.nodeId : null, status: text(payload.status) }) },
  { table: 'assets', key: 'assets', columns: payload => ({ material_id: typeof payload.materialId === 'string' ? payload.materialId : null }) },
  { table: 'materials', key: 'materials', columns: payload => ({ file_path: typeof payload.filePath === 'string' ? payload.filePath : (typeof payload.path === 'string' ? payload.path : null) }) },
  { table: 'conversations', key: 'harnessSessions', columns: payload => ({ agent_id: text(payload.agentId) }) },
  { table: 'production_plans', key: 'productionPlans', columns: payload => ({ name: text(payload.name) }) },
  { table: 'agent_batches', key: 'agentBatches', columns: payload => ({ name: text(payload.name) }) },
  { table: 'agent_evaluations', key: 'agentEvaluations', columns: payload => ({ name: text(payload.name) }) },
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
  const row = db.prepare('SELECT payload, revision FROM projects WHERE id = 1').get() as Row | undefined;
  if (!row) return null;
  const value = parse<ProjectRecord>(row.payload);
  value.storageRevision = Number(row.revision);
  for (const spec of COLLECTIONS) value[spec.key] = loadCollection(db, spec.table);
  value.canvasHistory = loadHistory(db, 'undo');
  value.canvasRedoStack = loadHistory(db, 'redo');
  return value;
}

function loadCollection(db: DatabaseSync, table: string): unknown[] {
  return (db.prepare(`SELECT payload FROM "${table}" ORDER BY position ASC`).all() as Row[])
    .map(row => parse(row.payload));
}

function loadHistory(db: DatabaseSync, stack: string): unknown[] {
  return (db.prepare('SELECT payload FROM canvas_history WHERE stack = ? ORDER BY position ASC').all(stack) as Row[])
    .map(row => parse(row.payload));
}

export function saveProject(db: DatabaseSync, value: ProjectRecord): ProjectRecord {
  const current = db.prepare('SELECT revision FROM projects WHERE id = 1').get() as Row | undefined;
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
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    revision: revision + 1,
    payload: JSON.stringify(metadata),
  };
  if (current) {
    db.prepare('UPDATE projects SET name = ?, created_at = ?, updated_at = ?, revision = ?, payload = ? WHERE id = 1')
      .run(record.name, record.createdAt, record.updatedAt, record.revision, record.payload);
  } else {
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at, revision, payload) VALUES (1, ?, ?, ?, ?, ?)')
      .run(record.name, record.createdAt, record.updatedAt, record.revision, record.payload);
  }
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
  if (spec.table === 'edges') db.prepare('DELETE FROM edges').run();
  else db.prepare(`DELETE FROM "${spec.table}"`).run();
  rows.forEach((payload, position) => {
    const record = payload as ProjectRecord;
    insertRecord(db, spec.table, {
      table: spec.table,
      columns: {
        ...spec.columns(record),
        id: String(record.id),
        position,
        payload: JSON.stringify(record),
      },
    });
  });
}

function saveHistory(db: DatabaseSync, stack: string, rawEntries: unknown): void {
  db.prepare('DELETE FROM canvas_history WHERE stack = ?').run(stack);
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  entries.forEach((payload, position) => {
    db.prepare('INSERT INTO canvas_history (stack, position, payload) VALUES (?, ?, ?)')
      .run(stack, position, JSON.stringify(payload));
  });
}

// ── 画布快照 ────────────────────────────────────────────────────────────────

export function listProjectSnapshots(path: string): unknown[] {
  return withDatabase(path, (db) => {
    const rows = db.prepare('SELECT * FROM project_snapshots ORDER BY created_at DESC').all() as Row[];
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
    db.prepare('INSERT INTO project_snapshots (id, created_at, reason, content_hash, payload_bytes, media_refs, degraded, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        text(record.createdAt),
        typeof record.reason === 'string' && record.reason ? record.reason : 'auto',
        text(record.contentHash),
        typeof record.payloadBytes === 'number' ? record.payloadBytes : 0,
        JSON.stringify(Array.isArray(record.mediaRefs) ? record.mediaRefs : []),
        record.degraded === true ? 1 : 0,
        record.payload === undefined || record.payload === null ? null : JSON.stringify(record.payload),
      );
    const stale = db.prepare('SELECT id FROM project_snapshots ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(SNAPSHOT_LIMIT) as Row[];
    for (const row of stale) db.prepare('DELETE FROM project_snapshots WHERE id = ?').run(String(row.id));
    return { saved: true } as const;
  }));
}

export function readProjectSnapshot(path: string, id: string): unknown {
  return withDatabase(path, (db) => {
    const row = db.prepare('SELECT payload FROM project_snapshots WHERE id = ?').get(id) as Row | undefined;
    return row && row.payload !== null ? parse(row.payload) : null;
  });
}

// ── 编辑器快照 / 片段记录 ───────────────────────────────────────────────────

export function editorSnapshot(path: string, nodeId: string): unknown {
  return withDatabase(path, (db) => {
    const row = db.prepare('SELECT payload FROM editor_snapshots WHERE node_id = ?').get(nodeId) as Row | undefined;
    return row ? parse(row.payload) : null;
  });
}

export function saveEditorSnapshot(path: string, nodeId: string, payload: unknown): unknown {
  return withDatabase(path, (db) => transaction(db, () => {
    const existing = db.prepare('SELECT revision FROM editor_snapshots WHERE node_id = ?').get(nodeId) as Row | undefined;
    const revision = existing ? Number(existing.revision) + 1 : 1;
    if (existing) {
      db.prepare('UPDATE editor_snapshots SET revision = ?, payload = ? WHERE node_id = ?')
        .run(revision, JSON.stringify(payload), nodeId);
    } else {
      db.prepare('INSERT INTO editor_snapshots (node_id, revision, payload) VALUES (?, ?, ?)')
        .run(nodeId, revision, JSON.stringify(payload));
    }
    return payload;
  }));
}

export function editorRecord(path: string, nodeId: string, key: string): unknown {
  return withDatabase(path, (db) => {
    const row = db.prepare('SELECT payload FROM editor_records WHERE node_id = ? AND key = ?').get(nodeId, key) as Row | undefined;
    return row ? parse(row.payload) : null;
  });
}

export function setEditorRecord(path: string, nodeId: string, key: string, payload: unknown): void {
  withDatabase(path, (db) => transaction(db, () => {
    if (payload === undefined || payload === null) {
      db.prepare('DELETE FROM editor_records WHERE node_id = ? AND key = ?').run(nodeId, key);
      return;
    }
    const existing = db.prepare('SELECT node_id FROM editor_records WHERE node_id = ? AND key = ?').get(nodeId, key);
    if (existing) db.prepare('UPDATE editor_records SET payload = ? WHERE node_id = ? AND key = ?').run(JSON.stringify(payload), nodeId, key);
    else db.prepare('INSERT INTO editor_records (node_id, key, payload) VALUES (?, ?, ?)').run(nodeId, key, JSON.stringify(payload));
  }));
}

export { metadataValue, setMetadataValue };

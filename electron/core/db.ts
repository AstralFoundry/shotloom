import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';

/**
 * 存储生命周期：打开 / 迁移 / 事务。领域查询在 storage.ts。
 *
 * 表结构与 src-tauri 的 sea-orm 实体逐列对齐（列名、可空性、外键），
 * 这样同一个 `app.sqlite` / `project.sqlite` 在两种运行时之间可以直接互换。
 */
export const DATABASE_VERSION = 3;

const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog_metadata ("scope" varchar NOT NULL PRIMARY KEY, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS canvas_history ("stack" varchar NOT NULL, "position" integer NOT NULL, "payload" json NOT NULL, PRIMARY KEY ("stack", "position"));
CREATE TABLE IF NOT EXISTS production_plans ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "name" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS agent_batches ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "name" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS agent_evaluations ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "name" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS projects ("id" integer NOT NULL PRIMARY KEY, "name" varchar NOT NULL, "created_at" varchar NOT NULL, "updated_at" varchar NOT NULL, "revision" bigint NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS project_snapshots ("id" varchar NOT NULL PRIMARY KEY, "created_at" varchar NOT NULL, "reason" varchar NOT NULL, "content_hash" varchar NOT NULL, "payload_bytes" bigint NOT NULL, "media_refs" json NOT NULL DEFAULT '[]', "degraded" boolean NOT NULL, "payload" json);
CREATE TABLE IF NOT EXISTS nodes ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "kind" varchar NOT NULL, "title" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS edges ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "source" varchar NOT NULL, "target" varchar NOT NULL, "payload" json NOT NULL,
  FOREIGN KEY ("source") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("target") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE IF NOT EXISTS tasks ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "node_id" varchar, "status" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS assets ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "material_id" varchar, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS materials ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "file_path" varchar, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS conversations ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "agent_id" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_sessions ("window_label" varchar NOT NULL PRIMARY KEY, "project_dir" varchar);
CREATE TABLE IF NOT EXISTS editor_snapshots ("node_id" varchar NOT NULL PRIMARY KEY, "revision" bigint NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS settings ("key" varchar NOT NULL PRIMARY KEY, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS skills ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "name" varchar NOT NULL, "enabled" boolean NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS recipes ("id" varchar NOT NULL PRIMARY KEY, "position" integer NOT NULL, "name" varchar NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS editor_records ("node_id" varchar NOT NULL, "key" varchar NOT NULL, "payload" json NOT NULL, PRIMARY KEY ("node_id", "key"));
CREATE TABLE IF NOT EXISTS recent_projects ("file_path" varchar NOT NULL PRIMARY KEY, "opened_at" bigint NOT NULL, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_records ("kind" varchar NOT NULL PRIMARY KEY, "payload" json NOT NULL);
CREATE TABLE IF NOT EXISTS clipboard_records ("id" varchar NOT NULL PRIMARY KEY, "payload" json NOT NULL);
`;

const INDEX_SCHEMA = [
  ['nodes', 'kind'], ['edges', 'source'], ['edges', 'target'], ['tasks', 'node_id'], ['tasks', 'status'],
  ['assets', 'material_id'], ['materials', 'file_path'], ['conversations', 'agent_id'], ['skills', 'enabled'],
] as const;

export type Row = Record<string, unknown>;

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = 10000');
  migrate(db);
  return db;
}

export function withDatabase<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = openDatabase(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function metadataValue(db: DatabaseSync, scope: string, key = 'payload'): unknown {
  const row = db.prepare(`SELECT "${key}" AS value FROM catalog_metadata WHERE scope = ?`).get(scope) as Row | undefined;
  return row ? JSON.parse(String(row.value)) : undefined;
}

export function setMetadataValue(db: DatabaseSync, scope: string, payload: unknown): void {
  const existing = db.prepare('SELECT scope FROM catalog_metadata WHERE scope = ?').get(scope);
  if (existing) db.prepare('UPDATE catalog_metadata SET payload = ? WHERE scope = ?').run(JSON.stringify(payload), scope);
  else db.prepare('INSERT INTO catalog_metadata (scope, payload) VALUES (?, ?)').run(scope, JSON.stringify(payload));
}

/**
 * 迁移必须在同一事务里完成：v1 的旧库要重建集合表，任何一步失败都要整体回滚，
 * 否则用户会得到一个"版本号还是旧的、表已经改了一半"的库。
 */
function migrate(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    // 首次建库与旧库补表都走同一份 DDL；已有表不会被改写，列结构升级靠下面的迁移。
    db.exec(TABLE_SCHEMA);
    // v3 之前的快照表没有 media_refs 列：补列必须早于版本短路，已存在时忽略错误。
    try { db.exec("ALTER TABLE project_snapshots ADD COLUMN media_refs json NOT NULL DEFAULT '[]'"); } catch { /* 列已存在 */ }
    const version = metadataValue(db, 'database-version');
    if (version === DATABASE_VERSION) {
      createIndexes(db);
      db.exec('COMMIT');
      return;
    }
    if (version !== undefined && version !== 1 && version !== 2) {
      throw new Error(localizedError('native.storage.dc6f57487e', {}, '数据库版本不受支持'));
    }
    const restore = version === 1 ? readLegacyCollections(db) : new Map<string, Row[]>();
    if (version === 1) {
      for (const name of ['edges', 'nodes', 'tasks', 'assets', 'materials', 'conversations', 'skills', 'recipes']) {
        db.exec(`DROP TABLE IF EXISTS "${name}"`);
      }
      db.exec('DROP TABLE IF EXISTS "editor_records"');
    }
    db.exec(TABLE_SCHEMA);
    for (const [name, rows] of restore) restoreLegacyCollection(db, name, rows);
    createIndexes(db);
    setMetadataValue(db, 'database-version', DATABASE_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createIndexes(db: DatabaseSync): void {
  for (const [table, column] of INDEX_SCHEMA) {
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${table}_${column}" ON "${table}" ("${column}")`);
  }
}

const LEGACY_COLLECTIONS = ['nodes', 'edges', 'tasks', 'assets', 'materials', 'conversations', 'skills', 'recipes'];

function readLegacyCollections(db: DatabaseSync): Map<string, Row[]> {
  const previous = new Map<string, Row[]>();
  for (const name of LEGACY_COLLECTIONS) {
    const rows = db.prepare(`SELECT id, position, payload FROM "${name}"`).all() as Row[];
    previous.set(name, rows);
  }
  return previous;
}

/**
 * 旧库只保留 id / position / payload 三列，索引列按当前写入路径的同一套模型函数重建。
 */
function restoreLegacyCollection(db: DatabaseSync, table: string, rows: Row[]): void {
  for (const row of rows) {
    const id = String(row.id);
    const position = Number(row.position);
    const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
    insertRecord(db, table, recordColumns(table, id, position, payload));
  }
}

interface RecordColumns { table: string; columns: Record<string, unknown>; }

function recordColumns(table: string, id: string, position: number, payload: Record<string, unknown>): RecordColumns {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const columns: Record<string, unknown> = { id, position, payload: JSON.stringify(payload) };
  switch (table) {
    case 'nodes': columns.kind = text(payload.type); columns.title = text(payload.title); break;
    case 'edges': columns.source = text(payload.source); columns.target = text(payload.target); break;
    case 'tasks': columns.node_id = typeof payload.nodeId === 'string' ? payload.nodeId : null; columns.status = text(payload.status); break;
    case 'assets': columns.material_id = typeof payload.materialId === 'string' ? payload.materialId : null; break;
    case 'materials': columns.file_path = typeof payload.filePath === 'string' ? payload.filePath : (typeof payload.path === 'string' ? payload.path : null); break;
    case 'conversations': columns.agent_id = text(payload.agentId); break;
    case 'skills': columns.name = text(payload.name); columns.enabled = payload.enabled !== false ? 1 : 0; break;
    case 'recipes': columns.name = text(payload.name); break;
    default: break;
  }
  return { table, columns };
}

export function insertRecord(db: DatabaseSync, table: string, record: RecordColumns): void {
  const keys = Object.keys(record.columns);
  const sql = `INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...keys.map(key => record.columns[key] as string | number | null));
}

export function updateRecord(db: DatabaseSync, table: string, keyColumn: string, keyValue: unknown, record: RecordColumns): void {
  const keys = Object.keys(record.columns).filter(key => key !== keyColumn);
  const sql = `UPDATE "${table}" SET ${keys.map(key => `"${key}" = ?`).join(', ')} WHERE "${keyColumn}" = ?`;
  db.prepare(sql).run(...keys.map(key => record.columns[key] as string | number | null), keyValue as string | number);
}

/** 数据库在线备份用 SQLite 自己的 VACUUM INTO，不复制正在写入的文件。 */
export function backupDatabase(source: string, destination: string): void {
  const db = openDatabase(source);
  try {
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { eq } from 'drizzle-orm';
import { orm } from './sqliteOrm';
import { migrate } from './migrations';
import { catalog_metadata, collectionTables, type CollectionName } from './schema';

/**
 * 存储生命周期：打开 / 迁移 / 事务。领域查询在 storage.ts。
 *
 * 表结构与 src-tauri 的 sea-orm 实体逐列对齐（列名、可空性、外键），
 * 这样同一个 `app.sqlite` / `project.sqlite` 在两种运行时之间可以直接互换。
 */
export const DATABASE_VERSION = 3;

export type Row = Record<string, unknown>;

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA busy_timeout = 10000');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
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
  return orm(db).transaction(() => work());
}

export function metadataValue(db: DatabaseSync, scope: string): unknown {
  const row = orm(db).select().from(catalog_metadata).where(eq(catalog_metadata.scope, scope)).get();
  return row ? JSON.parse(row.payload) : undefined;
}
export function setMetadataValue(db: DatabaseSync, scope: string, payload: unknown): void {
  const value = JSON.stringify(payload);
  orm(db).insert(catalog_metadata).values({ scope, payload: value })
    .onConflictDoUpdate({ target: catalog_metadata.scope, set: { payload: value } }).run();
}

export function insertCollectionRecord(db: DatabaseSync, table: CollectionName, id: string, position: number, payload: Record<string, unknown>): void {
  const base = { id, position, payload: JSON.stringify(payload) };
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const nullable = (value: unknown) => typeof value === 'string' ? value : null;
  const database = orm(db);
  switch (table) {
    case 'nodes': database.insert(collectionTables.nodes).values({ ...base, kind: text(payload.type), title: text(payload.title) }).run(); break;
    case 'edges': database.insert(collectionTables.edges).values({ ...base, source: text(payload.source), target: text(payload.target) }).run(); break;
    case 'tasks': database.insert(collectionTables.tasks).values({ ...base, node_id: nullable(payload.nodeId), status: text(payload.status) }).run(); break;
    case 'assets': database.insert(collectionTables.assets).values({ ...base, material_id: nullable(payload.materialId) }).run(); break;
    case 'materials': database.insert(collectionTables.materials).values({ ...base, file_path: nullable(payload.filePath) ?? nullable(payload.path) }).run(); break;
    case 'conversations': database.insert(collectionTables.conversations).values({ ...base, agent_id: text(payload.agentId) }).run(); break;
    case 'skills': database.insert(collectionTables.skills).values({ ...base, name: text(payload.name), enabled: payload.enabled === false ? 0 : 1 }).run(); break;
    case 'recipes': database.insert(collectionTables.recipes).values({ ...base, name: text(payload.name) }).run(); break;
    case 'production_plans': database.insert(collectionTables.production_plans).values({ ...base, name: text(payload.name) }).run(); break;
    case 'agent_batches': database.insert(collectionTables.agent_batches).values({ ...base, name: text(payload.name) }).run(); break;
    case 'agent_evaluations': database.insert(collectionTables.agent_evaluations).values({ ...base, name: text(payload.name) }).run(); break;
  }
}

/** 数据库在线备份用 SQLite 自己的 VACUUM INTO，不复制正在写入的文件。 */
export function backupDatabase(source: string, destination: string): void {
  const db = openDatabase(source);
  try {
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
}

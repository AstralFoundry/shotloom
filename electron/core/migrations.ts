import type { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';
import { metadataValue, setMetadataValue, insertCollectionRecord, type Row, DATABASE_VERSION } from './db';
import { orm } from './sqliteOrm';
import { collectionTables, type CollectionName } from './schema';

// Only schema migrations and connection maintenance use literal SQL.
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

const INDEX_STATEMENTS: Record<string, string> = {
  'nodes.kind': 'CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes (kind)',
  'edges.source': 'CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source)',
  'edges.target': 'CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target)',
  'tasks.node_id': 'CREATE INDEX IF NOT EXISTS idx_tasks_node_id ON tasks (node_id)',
  'tasks.status': 'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)',
  'assets.material_id': 'CREATE INDEX IF NOT EXISTS idx_assets_material_id ON assets (material_id)',
  'materials.file_path': 'CREATE INDEX IF NOT EXISTS idx_materials_file_path ON materials (file_path)',
  'conversations.agent_id': 'CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations (agent_id)',
  'skills.enabled': 'CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills (enabled)',
};
const DROP_LEGACY_TABLES: Record<string, string> = {
  nodes: 'DROP TABLE IF EXISTS nodes',
  edges: 'DROP TABLE IF EXISTS edges',
  tasks: 'DROP TABLE IF EXISTS tasks',
  assets: 'DROP TABLE IF EXISTS assets',
  materials: 'DROP TABLE IF EXISTS materials',
  conversations: 'DROP TABLE IF EXISTS conversations',
  skills: 'DROP TABLE IF EXISTS skills',
  recipes: 'DROP TABLE IF EXISTS recipes',
};
/**
 * 迁移必须在同一事务里完成：v1 的旧库要重建集合表，任何一步失败都要整体回滚，
 * 否则用户会得到一个"版本号还是旧的、表已经改了一半"的库。
 */
export function migrate(db: DatabaseSync): void {
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
        db.exec(DROP_LEGACY_TABLES[name]);
      }
      db.exec('DROP TABLE IF EXISTS "editor_records"');
    }
    db.exec(TABLE_SCHEMA);
    for (const [name, rows] of restore) restoreLegacyCollection(db, name as CollectionName, rows);
    createIndexes(db);
    setMetadataValue(db, 'database-version', DATABASE_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createIndexes(db: DatabaseSync): void {
  for (const statement of Object.values(INDEX_STATEMENTS)) {
    db.exec(statement);
  }
}

const LEGACY_COLLECTIONS = ['nodes', 'edges', 'tasks', 'assets', 'materials', 'conversations', 'skills', 'recipes'] as const;

function readLegacyCollections(db: DatabaseSync): Map<string, Row[]> {
  const previous = new Map<string, Row[]>();
  for (const name of LEGACY_COLLECTIONS) {
    const table = collectionTables[name];
    const rows = orm(db).select({ id: table.id, position: table.position, payload: table.payload }).from(table).all();
    previous.set(name, rows);
  }
  return previous;
}

function restoreLegacyCollection(db: DatabaseSync, table: CollectionName, rows: Row[]): void {
  for (const row of rows) {
    insertCollectionRecord(db, table, String(row.id), Number(row.position), JSON.parse(String(row.payload)));
  }
}

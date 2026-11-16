import { eq, ne, desc, asc } from 'drizzle-orm';
import { orm } from './sqliteOrm';
import * as models from './schema';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';
import { withDatabase, transaction, metadataValue, setMetadataValue, insertCollectionRecord } from './db';

/**
 * 持久化的事务边界，对应 src-tauri/src/services/storage_service.rs：
 * 这里只做「打开库 + 事务 + 调用目录/设置读写」，领域读写统一使用 Drizzle 表模型。
 */

export const APP_DATABASE = 'app.sqlite';

function parsePayload<T = unknown>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── 设置 ────────────────────────────────────────────────────────────────────

export function loadSettings(db: DatabaseSync, defaults: unknown): unknown {
  const merged: Record<string, unknown> = isRecord(defaults) ? { ...defaults } : {};
  const rows = orm(db).select().from(models.settings).all();
  for (const row of rows) merged[String(row.key)] = parsePayload(row.payload);
  return merged;
}

export function saveSettings(db: DatabaseSync, value: unknown): void {
  if (!isRecord(value)) {
    throw new Error(localizedError('native.storage.b9d0cbaaeb', {}, '设置必须是对象'));
  }
  // 下载目录有独立 IPC 归属：设置表单快照不得覆盖它，也不能把它擦掉。
  orm(db).delete(models.settings).where(ne(models.settings.key, 'downloadDirectory')).run();
  for (const [key, payload] of Object.entries(value)) {
    if (key === 'downloadDirectory') continue;
    orm(db).insert(models.settings).values({ key, payload: JSON.stringify(payload) }).run();
  }
}

export function settingsField(db: DatabaseSync, key: string): unknown {
  const row = orm(db).select().from(models.settings).where(eq(models.settings.key, key)).get();
  return row ? parsePayload(row.payload) : undefined;
}

export function setSettingsField(db: DatabaseSync, key: string, payload: unknown): void {
  const value = JSON.stringify(payload);
  orm(db).insert(models.settings).values({ key, payload: value })
    .onConflictDoUpdate({ target: models.settings.key, set: { payload: value } }).run();
}

export function setTokenGroup(file: string, id: unknown, defaults: unknown): unknown {
  return withDatabase(file, (db) => transaction(db, () => {
    let settings = loadSettings(db, {}) as Record<string, unknown>;
    if (Object.keys(settings).length === 0) settings = { ...(isRecord(defaults) ? defaults : {}) };
    settings.activeTokenGroupId = id;
    saveSettings(db, settings);
    return settings;
  }));
}

// ── 目录 ────────────────────────────────────────────────────────────────────

const CATALOG_COLLECTIONS = [
  { kind: 'skills', table: 'skills', key: 'skills' },
  { kind: 'recipes', table: 'recipes', key: 'recipes' },
  { kind: 'assets', table: 'assets', key: 'assets' },
  { kind: 'materials', table: 'materials', key: 'materials' },
] as const;

export function loadCatalog(db: DatabaseSync, kind: string): unknown {
  // 厂商插件目录是纯元数据目录，没有集合表；和 Rust catalog() 的 metadata 分支一致。
  if (kind === 'provider-plugins' || kind === 'provider-plugin-submissions') {
    return metadataValue(db, kind);
  }
  const collection = CATALOG_COLLECTIONS.find(item => item.kind === kind);
  if (!collection) throw new Error(unknownCatalog(kind));
  const metadata = orm(db).select().from(models.catalog_metadata).where(eq(models.catalog_metadata.scope, kind)).get();
  if (!metadata) return undefined;
  const value = parsePayload<Record<string, unknown>>(metadata.payload);
  value[collection.key] = (orm(db).select().from(models.collectionTables[collection.table]).orderBy(asc(models.collectionTables[collection.table].position)).all())
    .map(row => parsePayload(row.payload));
  if (kind === 'assets') {
    // 素材目录把 materials 挂回同一份快照，和 Rust 侧 catalog() 的合并行为一致。
    const materials = orm(db).select().from(models.materials).orderBy(asc(models.materials.position)).all();
    value.materials = materials.map(row => parsePayload(row.payload));
  }
  return value;
}

export function saveCatalog(db: DatabaseSync, kind: string, value: unknown): void {
  if (kind === 'provider-plugins' || kind === 'provider-plugin-submissions') {
    if (!isRecord(value)) throw new Error(localizedError('native.storage.1f02fc7c88', {}, '目录必须是对象'));
    setMetadataValue(db, kind, value);
    return;
  }
  if (kind === 'assets') {
    if (!isRecord(value)) throw new Error(localizedError('native.storage.d5455edb54', {}, '素材目录必须是对象'));
    const assets: Record<string, unknown> = { ...value };
    delete assets.materials;
    saveCollection(db, 'assets', assets);
    saveCollection(db, 'materials', { materials: Array.isArray(value.materials) ? value.materials : [] });
    return;
  }
  const collection = CATALOG_COLLECTIONS.find(item => item.kind === kind);
  if (!collection) throw new Error(unknownCatalog(kind));
  if (!isRecord(value)) throw new Error(localizedError('native.storage.1f02fc7c88', {}, '目录必须是对象'));
  saveCollection(db, collection.table, value);
}

function unknownCatalog(kind: string): string {
  return localizedError('native.storage.46f6ec5e08', { kind }, `未知目录：${kind}`);
}

function saveCollection(db: DatabaseSync, table: 'skills' | 'recipes' | 'assets' | 'materials', value: Record<string, unknown>): void {
  const key = table === 'assets' ? 'assets' : table === 'materials' ? 'materials' : table;
  const rows = Array.isArray(value[key]) ? value[key] as unknown[] : [];
  orm(db).delete(models.collectionTables[table]).run();
  rows.forEach((payload, position) => {
    const id = isRecord(payload) && typeof payload.id === 'string' && payload.id ? payload.id : '';
    if (!id) throw new Error(localizedError('native.storage.fdc388af1b', { collection: key }, `${key}记录缺少 id`));
    insertCollectionRecord(db, table, id, position, payload as Record<string, unknown>);
  });
  const metadata: Record<string, unknown> = { ...value };
  delete metadata[key];
  setMetadataValue(db, key, metadata);
}

// ── 最近项目 ────────────────────────────────────────────────────────────────

export function recentList(db: DatabaseSync): unknown[] {
  return (orm(db).select().from(models.recent_projects).orderBy(desc(models.recent_projects.opened_at)).limit(20).all())
    .map(row => parsePayload(row.payload));
}

export function addRecent(db: DatabaseSync, project: unknown): void {
  if (!isRecord(project) || typeof project.filePath !== 'string' || !project.filePath) {
    throw new Error(localizedError('native.storage.f19026e6f4', {}, '最近项目缺少路径'));
  }
  const filePath = project.filePath;
  const openedAt = Date.now() * 1000;
  const value = { file_path: filePath, opened_at: openedAt, payload: JSON.stringify(project) };
  orm(db).insert(models.recent_projects).values(value)
    .onConflictDoUpdate({ target: models.recent_projects.file_path, set: value }).run();
}

export function removeRecent(db: DatabaseSync, filePath: string): void {
  orm(db).delete(models.recent_projects).where(eq(models.recent_projects.file_path, filePath)).run();
}

// ── 恢复记录 / 剪贴板记录 / 窗口绑定 ────────────────────────────────────────

export function loadRecovery(db: DatabaseSync, kind: string): unknown {
  const row = orm(db).select().from(models.recovery_records).where(eq(models.recovery_records.kind, kind)).get();
  return row ? parsePayload(row.payload) : null;
}

export function saveRecovery(db: DatabaseSync, kind: string, payload: unknown): void {
  const value = { kind: kind, payload: JSON.stringify(payload) };
  orm(db).insert(models.recovery_records).values(value)
    .onConflictDoUpdate({ target: models.recovery_records.kind, set: value }).run();
}

export function loadClipboard(db: DatabaseSync, id: string): unknown {
  const row = orm(db).select().from(models.clipboard_records).where(eq(models.clipboard_records.id, id)).get();
  if (!row) throw new Error(localizedError('native.storage.acc492d403', {}, '暂存工作流不存在，请重新复制'));
  return parsePayload(row.payload);
}

export function saveClipboard(db: DatabaseSync, id: string, payload: unknown): void {
  const value = { id: id, payload: JSON.stringify(payload) };
  orm(db).insert(models.clipboard_records).values(value)
    .onConflictDoUpdate({ target: models.clipboard_records.id, set: value }).run();
}

export function windowProject(db: DatabaseSync, label: string): string | null {
  const row = orm(db).select().from(models.workspace_sessions).where(eq(models.workspace_sessions.window_label, label)).get();
  return row && typeof row.project_dir === 'string' ? row.project_dir : null;
}

export function bindWindowProject(db: DatabaseSync, label: string, directory: string | null): void {
  const value = { window_label: label, project_dir: directory };
  orm(db).insert(models.workspace_sessions).values(value)
    .onConflictDoUpdate({ target: models.workspace_sessions.window_label, set: value }).run();
}

export function downloadDirectory(db: DatabaseSync): unknown {
  return settingsField(db, 'downloadDirectory') ?? '';
}

export function setDownloadDirectory(db: DatabaseSync, directory: string): void {
  setSettingsField(db, 'downloadDirectory', directory);
}

export function databaseFileExists(path: string): boolean {
  return existsSync(path);
}

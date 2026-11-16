import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { localizedError } from './errors';
import { withDatabase, transaction, type Row } from './db';

/**
 * 持久化的事务边界，对应 src-tauri/src/services/storage_service.rs：
 * 这里只做「打开库 + 事务 + 调用目录/设置读写」，SQL 都在下面的领域函数里。
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
  const rows = db.prepare('SELECT key, payload FROM settings').all() as Row[];
  for (const row of rows) merged[String(row.key)] = parsePayload(row.payload);
  return merged;
}

export function saveSettings(db: DatabaseSync, value: unknown): void {
  if (!isRecord(value)) {
    throw new Error(localizedError('native.storage.b9d0cbaaeb', {}, '设置必须是对象'));
  }
  // 下载目录有独立 IPC 归属：设置表单快照不得覆盖它，也不能把它擦掉。
  db.prepare("DELETE FROM settings WHERE key <> 'downloadDirectory'").run();
  for (const [key, payload] of Object.entries(value)) {
    if (key === 'downloadDirectory') continue;
    db.prepare('INSERT INTO settings (key, payload) VALUES (?, ?)').run(key, JSON.stringify(payload));
  }
}

export function settingsField(db: DatabaseSync, key: string): unknown {
  const row = db.prepare('SELECT payload FROM settings WHERE key = ?').get(key) as Row | undefined;
  return row ? parsePayload(row.payload) : undefined;
}

export function setSettingsField(db: DatabaseSync, key: string, payload: unknown): void {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) db.prepare('UPDATE settings SET payload = ? WHERE key = ?').run(JSON.stringify(payload), key);
  else db.prepare('INSERT INTO settings (key, payload) VALUES (?, ?)').run(key, JSON.stringify(payload));
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
    const row = db.prepare('SELECT payload FROM catalog_metadata WHERE scope = ?').get(kind) as Row | undefined;
    return row ? parsePayload(row.payload) : undefined;
  }
  const collection = CATALOG_COLLECTIONS.find(item => item.kind === kind);
  if (!collection) throw new Error(unknownCatalog(kind));
  const metadata = db.prepare('SELECT payload FROM catalog_metadata WHERE scope = ?').get(kind) as Row | undefined;
  if (!metadata) return undefined;
  const value = parsePayload<Record<string, unknown>>(metadata.payload);
  value[collection.key] = (db.prepare(`SELECT payload FROM "${collection.table}" ORDER BY position ASC`).all() as Row[])
    .map(row => parsePayload(row.payload));
  if (kind === 'assets') {
    // 素材目录把 materials 挂回同一份快照，和 Rust 侧 catalog() 的合并行为一致。
    const materials = db.prepare('SELECT payload FROM materials ORDER BY position ASC').all() as Row[];
    value.materials = materials.map(row => parsePayload(row.payload));
  }
  return value;
}

export function saveCatalog(db: DatabaseSync, kind: string, value: unknown): void {
  if (kind === 'provider-plugins' || kind === 'provider-plugin-submissions') {
    if (!isRecord(value)) throw new Error(localizedError('native.storage.1f02fc7c88', {}, '目录必须是对象'));
    setCatalogMetadata(db, kind, value);
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

function setCatalogMetadata(db: DatabaseSync, scope: string, payload: unknown): void {
  const existing = db.prepare('SELECT scope FROM catalog_metadata WHERE scope = ?').get(scope);
  if (existing) db.prepare('UPDATE catalog_metadata SET payload = ? WHERE scope = ?').run(JSON.stringify(payload), scope);
  else db.prepare('INSERT INTO catalog_metadata (scope, payload) VALUES (?, ?)').run(scope, JSON.stringify(payload));
}

function saveCollection(db: DatabaseSync, table: string, value: Record<string, unknown>): void {
  const key = table === 'assets' ? 'assets' : table === 'materials' ? 'materials' : table;
  const rows = Array.isArray(value[key]) ? value[key] as unknown[] : [];
  db.prepare(`DELETE FROM "${table}"`).run();
  rows.forEach((payload, position) => {
    const id = isRecord(payload) && typeof payload.id === 'string' && payload.id ? payload.id : '';
    if (!id) throw new Error(localizedError('native.storage.fdc388af1b', { collection: key }, `${key}记录缺少 id`));
    insertCatalogRow(db, table, id, position, payload as Record<string, unknown>);
  });
  const metadata: Record<string, unknown> = { ...value };
  delete metadata[key];
  setCatalogMetadata(db, key, metadata);
}

function insertCatalogRow(db: DatabaseSync, table: string, id: string, position: number, payload: Record<string, unknown>): void {
  const name = typeof payload.name === 'string' ? payload.name : '';
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  switch (table) {
    case 'skills':
      db.prepare('INSERT INTO skills (id, position, name, enabled, payload) VALUES (?, ?, ?, ?, ?)')
        .run(id, position, name, payload.enabled === false ? 0 : 1, JSON.stringify(payload));
      break;
    case 'recipes':
      db.prepare('INSERT INTO recipes (id, position, name, payload) VALUES (?, ?, ?, ?)')
        .run(id, position, name, JSON.stringify(payload));
      break;
    case 'assets':
      db.prepare('INSERT INTO assets (id, position, material_id, payload) VALUES (?, ?, ?, ?)')
        .run(id, position, text(payload.materialId), JSON.stringify(payload));
      break;
    case 'materials':
      db.prepare('INSERT INTO materials (id, position, file_path, payload) VALUES (?, ?, ?, ?)')
        .run(id, position, text(payload.filePath) ?? text(payload.path), JSON.stringify(payload));
      break;
    default:
      throw new Error(`unknown catalog table: ${table}`);
  }
}

// ── 最近项目 ────────────────────────────────────────────────────────────────

export function recentList(db: DatabaseSync): unknown[] {
  return (db.prepare('SELECT payload FROM recent_projects ORDER BY opened_at DESC LIMIT 20').all() as Row[])
    .map(row => parsePayload(row.payload));
}

export function addRecent(db: DatabaseSync, project: unknown): void {
  if (!isRecord(project) || typeof project.filePath !== 'string' || !project.filePath) {
    throw new Error(localizedError('native.storage.f19026e6f4', {}, '最近项目缺少路径'));
  }
  const filePath = project.filePath;
  const openedAt = Date.now() * 1000;
  const existing = db.prepare('SELECT file_path FROM recent_projects WHERE file_path = ?').get(filePath);
  if (existing) {
    db.prepare('UPDATE recent_projects SET opened_at = ?, payload = ? WHERE file_path = ?')
      .run(openedAt, JSON.stringify(project), filePath);
  } else {
    db.prepare('INSERT INTO recent_projects (file_path, opened_at, payload) VALUES (?, ?, ?)')
      .run(filePath, openedAt, JSON.stringify(project));
  }
}

export function removeRecent(db: DatabaseSync, filePath: string): void {
  db.prepare('DELETE FROM recent_projects WHERE file_path = ?').run(filePath);
}

// ── 恢复记录 / 剪贴板记录 / 窗口绑定 ────────────────────────────────────────

export function loadRecovery(db: DatabaseSync, kind: string): unknown {
  const row = db.prepare('SELECT payload FROM recovery_records WHERE kind = ?').get(kind) as Row | undefined;
  return row ? parsePayload(row.payload) : null;
}

export function saveRecovery(db: DatabaseSync, kind: string, payload: unknown): void {
  const existing = db.prepare('SELECT kind FROM recovery_records WHERE kind = ?').get(kind);
  if (existing) db.prepare('UPDATE recovery_records SET payload = ? WHERE kind = ?').run(JSON.stringify(payload), kind);
  else db.prepare('INSERT INTO recovery_records (kind, payload) VALUES (?, ?)').run(kind, JSON.stringify(payload));
}

export function loadClipboard(db: DatabaseSync, id: string): unknown {
  const row = db.prepare('SELECT payload FROM clipboard_records WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error(localizedError('native.storage.acc492d403', {}, '暂存工作流不存在，请重新复制'));
  return parsePayload(row.payload);
}

export function saveClipboard(db: DatabaseSync, id: string, payload: unknown): void {
  const existing = db.prepare('SELECT id FROM clipboard_records WHERE id = ?').get(id);
  if (existing) db.prepare('UPDATE clipboard_records SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id);
  else db.prepare('INSERT INTO clipboard_records (id, payload) VALUES (?, ?)').run(id, JSON.stringify(payload));
}

export function windowProject(db: DatabaseSync, label: string): string | null {
  const row = db.prepare('SELECT project_dir FROM workspace_sessions WHERE window_label = ?').get(label) as Row | undefined;
  return row && typeof row.project_dir === 'string' ? row.project_dir : null;
}

export function bindWindowProject(db: DatabaseSync, label: string, directory: string | null): void {
  const existing = db.prepare('SELECT window_label FROM workspace_sessions WHERE window_label = ?').get(label);
  if (existing) db.prepare('UPDATE workspace_sessions SET project_dir = ? WHERE window_label = ?').run(directory, label);
  else db.prepare('INSERT INTO workspace_sessions (window_label, project_dir) VALUES (?, ?)').run(label, directory);
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

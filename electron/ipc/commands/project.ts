import { existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { shell } from 'electron';
import { defineCommand } from '../registry';
import { withDatabase, transaction } from '../../core/db';
import { localizedError } from '../../core/errors';
import { appDataDir } from '../../core/paths';
import {
  PROJECT_FILE, SHARED_ASSET_LIBRARY_FILE, copyDir, uniqueDir,
} from '../../core/files';
import { loadCatalog, saveCatalog } from '../../core/storage';
import { backupDatabase } from '../../core/db';
import { StoredZipReader, StoredZipWriter } from '../../core/zip';
import {
  createProjectSnapshot, editorRecord, editorSnapshot, listProjectSnapshots, loadProjectFile,
  readProjectSnapshot, saveProject, setEditorRecord, saveEditorSnapshot,
} from '../../core/projectStorage';

/**
 * 项目通道：目录树、工程数据库、共享素材库合并。
 * 语义与 src-tauri/src/commands/project.rs 一致，路径与错误信封逐项对齐。
 */

const PROJECT_SCHEMA = 'shotloom-project';
const PROJECT_SCHEMA_VERSION = 2;
const SHARED_ASSET_LIBRARY_SCHEMA = 'shotloom-project-assets';
const MAX_PROJECT_TREE_DEPTH = 8;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function values(project: Json, key: string): unknown[] {
  return Array.isArray(project[key]) ? project[key] as unknown[] : [];
}

function valueId(value: unknown): string {
  return isRecord(value) && typeof value.id === 'string' ? value.id : '';
}

function upsertById(target: unknown[], value: unknown): void {
  const id = valueId(value);
  if (!id) return;
  const index = target.findIndex(item => valueId(item) === id);
  if (index >= 0) target[index] = value;
  else target.push(value);
}

function sharedAssetBoundary(project: Json, field: 'rootDir' | 'assetRootDir'): string | null {
  for (const key of ['library', 'series']) {
    const boundary = project[key];
    if (!isRecord(boundary)) continue;
    if (boundary.enabled === false) continue;
    const root = typeof boundary[field] === 'string' ? boundary[field].trim() : '';
    if (root) return root;
  }
  return null;
}

/** 共享素材库的读写必须串行：两个窗口同时合并同一份清单会互相覆盖。 */
let assetLock: Promise<unknown> = Promise.resolve();
function withAssetLock<T>(work: () => T): Promise<T> {
  const run = assetLock.then(work, work);
  assetLock = run.catch(() => undefined);
  return run;
}

function libraryCatalogPath(project: Json): string | null {
  const root = sharedAssetBoundary(project, 'rootDir');
  return root ? join(root, SHARED_ASSET_LIBRARY_FILE) : null;
}

export function validateCurrentProject(project: unknown): asserts project is Json {
  if (!isRecord(project) || project.schema !== PROJECT_SCHEMA) {
    throw new Error(localizedError('native.error.c17248e2d5', {}, '项目格式无效：不是 Shotloom 项目'));
  }
  const version = project.schemaVersion;
  if (typeof version !== 'number') {
    throw new Error(localizedError('native.error.689ca0e5ac', {}, '项目数据缺少有效的 schemaVersion'));
  }
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(localizedError('native.error.f2e402a2db',
      { PROJECT_SCHEMA_VERSION: String(PROJECT_SCHEMA_VERSION), version: String(version) },
      `项目版本不受支持：需要 v${PROJECT_SCHEMA_VERSION}，实际为 v${version}`));
  }
}

function applySharedAssetCatalog(project: Json, catalog: Json): void {
  const assets = values(catalog, 'assets');
  const sharedMaterials = values(catalog, 'materials');
  const materials = [...values(project, 'materials')];
  for (const material of sharedMaterials) upsertById(materials, material);
  project.assets = assets;
  project.materials = materials;
  project.sharedLibraryDeletedAssetIds = values(catalog, 'deletedAssetIds');
}

function emptyCatalog(): Json {
  return {
    schema: SHARED_ASSET_LIBRARY_SCHEMA,
    schemaVersion: 1,
    assets: [],
    materials: [],
    deletedAssetIds: [],
    migratedProjectIds: [],
  };
}

function persistSharedAssetCatalog(project: Json): void {
  const path = libraryCatalogPath(project);
  if (!path) return;
  const stored = withDatabase(path, db => loadCatalog(db, 'assets'));
  let catalog = isRecord(stored) && stored.schema === SHARED_ASSET_LIBRARY_SCHEMA ? stored as Json : emptyCatalog();

  const deleted = new Set<string>(values(catalog, 'deletedAssetIds').filter((id): id is string => typeof id === 'string'));
  for (const id of values(project, 'sharedLibraryDeletedAssetIds')) if (typeof id === 'string') deleted.add(id);

  const assets = [...values(catalog, 'assets')];
  for (const asset of values(project, 'assets')) {
    if (!deleted.has(valueId(asset))) upsertById(assets, asset);
  }
  const keptAssets = assets.filter(asset => !deleted.has(valueId(asset)));

  const materialIds = new Set(keptAssets
    .map(asset => isRecord(asset) && typeof asset.materialId === 'string' ? asset.materialId : '')
    .filter(Boolean));
  const materials = [...values(catalog, 'materials')];
  for (const material of values(project, 'materials')) {
    if (materialIds.has(valueId(material))) upsertById(materials, material);
  }
  const keptMaterials = materials.filter(material => materialIds.has(valueId(material)));

  const migrated = new Set<string>(values(catalog, 'migratedProjectIds').filter((id): id is string => typeof id === 'string'));
  if (typeof project.id === 'string' && project.id) migrated.add(project.id);

  catalog = {
    schema: SHARED_ASSET_LIBRARY_SCHEMA,
    schemaVersion: 1,
    assets: keptAssets,
    materials: keptMaterials,
    deletedAssetIds: [...deleted],
    migratedProjectIds: [...migrated],
  };
  withDatabase(path, db => transaction(db, () => { saveCatalog(db, 'assets', catalog); }));
  applySharedAssetCatalog(project, catalog);
}

function hydrateSharedAssetCatalog(project: Json): void {
  const path = libraryCatalogPath(project);
  if (!path) return;
  const stored = withDatabase(path, db => loadCatalog(db, 'assets'));
  if (!isRecord(stored) || stored.schema !== SHARED_ASSET_LIBRARY_SCHEMA) {
    persistSharedAssetCatalog(project);
    return;
  }
  const catalog = stored as Json;
  const projectId = typeof project.id === 'string' ? project.id : '';
  const migrated = values(catalog, 'migratedProjectIds').some(id => id === projectId);
  if (!migrated) {
    // 每份旧画布只贡献一次内嵌素材；迁移标记避免后来的同项目画布把已删素材复活。
    persistSharedAssetCatalog(project);
    return;
  }
  applySharedAssetCatalog(project, catalog);
}

const LOCAL_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']);

function localImagePath(media: unknown, directory: string): string | null {
  if (!isRecord(media)) return null;
  const source = typeof media.filePath === 'string' ? media.filePath : (typeof media.path === 'string' ? media.path : '');
  if (!source || source.includes('://') || source.startsWith('data:') || source.startsWith('blob:')) return null;
  const extension = source.split('.').pop()?.toLowerCase() || '';
  if (!LOCAL_IMAGE_EXTENSIONS.has(extension)) return null;
  return source.startsWith('/') ? source : join(directory, source);
}

function projectCoverSource(project: Json, directory: string): string | null {
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const outputs = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
    const selected = outputs.find(item => isRecord(item) && item.id !== undefined && item.id === node.selectedOutputNodeId);
    const selectedPath = selected ? localImagePath(selected, directory) : null;
    if (selectedPath) return selectedPath;
    for (const output of [...outputs].reverse()) {
      const path = localImagePath(output, directory);
      if (path) return path;
    }
    if (node.uploadedFile) {
      const path = localImagePath(node.uploadedFile, directory);
      if (path) return path;
    }
    const nodePath = localImagePath(node, directory);
    if (nodePath) return nodePath;
  }
  const nodeIds = new Set(nodes.filter(isRecord).map(node => typeof node.id === 'string' ? node.id : '').filter(Boolean));
  for (const material of Array.isArray(project.materials) ? project.materials : []) {
    if (isRecord(material) && typeof material.nodeId === 'string' && nodeIds.has(material.nodeId)) {
      const path = localImagePath(material, directory);
      if (path) return path;
    }
  }
  return null;
}

async function listProjectTree(root: string, depth: number): Promise<unknown[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const hasLibrary = entries.some(entry => entry.name === SHARED_ASSET_LIBRARY_FILE);
  const directories = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !(hasLibrary && entry.name === 'assets'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const result: unknown[] = [];
  for (const entry of directories) {
    const directory = join(root, entry.name);
    const metadata = await stat(directory).catch(() => null);
    const createdAt = metadata ? Math.round(metadata.birthtimeMs) : null;
    const updatedAt = metadata ? Math.round(metadata.mtimeMs) : null;
    const projectPath = join(directory, PROJECT_FILE);
    // 只有已经存在的工程库才是项目；遍历时绝不能为每个目录顺手建一个空库。
    const loaded = existsSync(projectPath) ? loadProjectFile(projectPath) : null;
    if (loaded) {
      const projectName = typeof loaded.name === 'string' && loaded.name ? loaded.name : entry.name;
      result.push({
        kind: 'project', name: projectName, filePath: projectPath, projectDir: directory,
        createdAt: loaded.createdAt ?? null, updatedAt: loaded.updatedAt ?? null,
        coverSource: projectCoverSource(loaded, directory),
      });
    } else if (depth >= MAX_PROJECT_TREE_DEPTH) {
      result.push({ kind: 'folder', name: entry.name, folderDir: directory, createdAt, updatedAt, children: [], truncated: true });
    } else {
      result.push({ kind: 'folder', name: entry.name, folderDir: directory, createdAt, updatedAt, children: await listProjectTree(directory, depth + 1) });
    }
  }
  return result;
}

function projectsRoot(): string {
  return join(appDataDir(), 'projects');
}

async function ensureAbsoluteDirectory(root: string, fallbackRoot: string): Promise<string> {
  const requested = root.trim();
  const target = requested && requested.startsWith('/') ? requested : fallbackRoot;
  await mkdir(target, { recursive: true });
  return target;
}

async function saveProjectToDirectory(directory: string, project: Json): Promise<Json> {
  validateCurrentProject(project);
  await withAssetLock(() => { persistSharedAssetCatalog(project); });
  const assetDirectory = sharedAssetBoundary(project, 'assetRootDir') || join(directory, 'assets');
  await mkdir(assetDirectory, { recursive: true });
  const path = join(directory, PROJECT_FILE);
  const saved = withDatabase(path, db => transaction(db, () => saveProject(db, project)));
  return { filePath: path, projectDir: directory, project: saved };
}

async function readProjectFile(path: string): Promise<Json> {
  const loaded = loadProjectFile(path);
  validateCurrentProject(loaded);
  await withAssetLock(() => { hydrateSharedAssetCatalog(loaded); });
  return loaded;
}

async function openProjectFolder(directory: string): Promise<Json> {
  const path = join(directory, PROJECT_FILE);
  const loaded = loadProjectFile(path);
  if (!loaded) {
    throw new Error(localizedError('native.error.6324562919', {}, '所选目录不是 Shotloom 画布'));
  }
  validateCurrentProject(loaded);
  await withAssetLock(() => { hydrateSharedAssetCatalog(loaded); });
  return { ok: true, filePath: path, projectDir: directory, project: loaded };
}

defineCommand('project_get_default_root', async () => {
  const root = projectsRoot();
  await mkdir(root, { recursive: true });
  return root;
});

defineCommand('project_ensure_root', async (args) => {
  const root = String(args.root ?? '');
  return ensureAbsoluteDirectory(root, projectsRoot());
});

defineCommand('project_create_folder', async (args) => {
  const parent = String(args.parent ?? '');
  await mkdir(parent, { recursive: true });
  const target = uniqueDir(parent, String(args.name ?? ''));
  await mkdir(target, { recursive: false });
  return target;
});

defineCommand('project_create_library_folder', async (args) => {
  const target = uniqueDir(String(args.parent ?? ''), String(args.name ?? ''));
  await mkdir(target, { recursive: true });
  return { kind: 'folder', name: basename(target), folderDir: target };
});

defineCommand('project_list_root', async (args) => listProjectTree(String(args.root ?? ''), 0));

defineCommand('project_save', async (args) => saveProjectToDirectory(String(args.directory ?? ''), args.project as Json));

defineCommand('project_read_file', async (args) => readProjectFile(String(args.path ?? '')));

defineCommand('project_open_folder', async (args) => openProjectFolder(String(args.directory ?? '')));

defineCommand('project_rename_entry', async (args) => {
  const source = String(args.path ?? '');
  const parent = source.replace(/[\\/][^\\/]+$/, '');
  if (!parent || parent === source) throw new Error(localizedError('native.error.db9eb77b5a', {}, '目录没有父级'));
  const target = uniqueDir(parent, String(args.name ?? ''));
  await rename(source, target);
  const actualName = basename(target);
  let storageRevision: unknown = null;
  const projectPath = join(target, PROJECT_FILE);
  try {
    const project = await readProjectFile(projectPath);
    if (project) {
      project.name = actualName;
      const saved = await saveProjectToDirectory(target, project);
      storageRevision = (saved.project as Json).storageRevision ?? null;
    }
  } catch (error) {
    try {
      await rename(target, source);
    } catch (rollbackError) {
      throw new Error(localizedError('native.error.a1819e93de', {
        error: String(error instanceof Error ? error.message : error),
        rollback_error: String(rollbackError instanceof Error ? rollbackError.message : rollbackError),
      }, `更新项目名称失败：${String(error)}；目录回滚失败：${String(rollbackError)}`));
    }
    throw new Error(localizedError('native.error.78d9312625',
      { error: String(error instanceof Error ? error.message : error) },
      `更新项目名称失败：${String(error)}`));
  }
  return { oldDir: source, newDir: target, name: actualName, storageRevision };
});

defineCommand('project_clone_entry', async (args) => {
  const source = String(args.path ?? '');
  const fallback = `${basename(source)}-copy`;
  const preferred = typeof args.name === 'string' && args.name ? args.name : fallback;
  const parent = source.replace(/[\\/][^\\/]+$/, '');
  if (!parent || parent === source) throw new Error(localizedError('native.error.db9eb77b5a', {}, '目录没有父级'));
  const target = uniqueDir(parent, preferred);
  await copyDir(source, target);
  return { ok: true, projectDir: target, folderDir: target, name: basename(target) };
});

// 快照与编辑状态都存在项目目录内的 project.sqlite 里。
function projectDatabase(directory: string): string {
  return join(directory, PROJECT_FILE);
}

defineCommand('project_snapshot_list', (args) => listProjectSnapshots(projectDatabase(String(args.directory ?? ''))));
defineCommand('project_snapshot_create', (args) => createProjectSnapshot(projectDatabase(String(args.directory ?? '')), (args.record ?? {}) as Json));
defineCommand('project_snapshot_read', (args) => readProjectSnapshot(projectDatabase(String(args.directory ?? '')), String(args.id ?? '')));

defineCommand('editor_snapshot_get', (args) => editorSnapshot(projectDatabase(String(args.directory ?? '')), String(args.nodeId ?? '')));
defineCommand('editor_snapshot_set', (args) => {
  const directory = String(args.directory ?? '');
  const nodeId = String(args.nodeId ?? '');
  saveEditorSnapshot(projectDatabase(directory), nodeId, args.snapshot);
  return { saved: true };
});
defineCommand('editor_record_get', (args) => editorRecord(projectDatabase(String(args.directory ?? '')), String(args.nodeId ?? ''), String(args.key ?? '')));
defineCommand('editor_record_set', (args) => {
  const directory = String(args.directory ?? '');
  const nodeId = String(args.nodeId ?? '');
  const key = String(args.key ?? '');
  setEditorRecord(projectDatabase(directory), nodeId, key, args.value);
  return null;
});

// ── 项目包 ──────────────────────────────────────────────────────────────────

const PROJECT_PACKAGE_SCHEMA = 'shotloom-project-package';
const MAX_PACKAGE_FILES = 20_000;
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024 * 1024;

async function writeProjectArchive(
  archive: StoredZipWriter, sourceRoot: string, directory: string, counts: { count: number; totalSize: number },
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await writeProjectArchive(archive, sourceRoot, path, counts);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.sqlite-wal') || entry.name.endsWith('.sqlite-shm')) continue;
    const relative = path.slice(sourceRoot.length).replace(/^[\\/]/, '').split(sep).join('/');
    if (!relative || relative.includes('../')) continue;
    if (entry.name.endsWith('.sqlite')) {
      // 导出的是数据库的一致快照，而不是可能正在写入的 WAL 现场。
      const snapshot = join(tmpdir(), `shotloom-export-${process.pid}-${Date.now()}-${counts.count}.sqlite`);
      backupDatabase(path, snapshot);
      try {
        const size = (await stat(snapshot)).size;
        counts.totalSize += await archive.addFile(`project/${relative}`, snapshot, size);
        counts.count += 1;
      } finally {
        await rm(snapshot, { force: true });
      }
      continue;
    }
    const size = (await stat(path)).size;
    counts.totalSize += await archive.addFile(`project/${relative}`, path, size);
    counts.count += 1;
  }
}

async function exportProjectPackage(source: string, target: string): Promise<Json> {
  const projectPath = join(source, PROJECT_FILE);
  if (!existsSync(projectPath)) {
    throw new Error(localizedError('native.error.490282ece2', {}, '项目目录无效或缺少 project.sqlite'));
  }
  if (target === source || target.startsWith(source + sep)) {
    throw new Error(localizedError('native.error.35af4b8578', {}, '项目包不能保存到项目目录内部'));
  }
  await mkdir(source.replace(/[\\/][^\\/]+$/, '') || '.', { recursive: true });
  const project = await readProjectFile(projectPath);
  const temporary = join(target.replace(/[\\/][^\\/]+$/, '') || '.', `.${basename(target)}.${Date.now()}.partial`);
  const counts = { count: 0, totalSize: 0 };
  const archive = await StoredZipWriter.create(temporary);
  try {
    const manifest = {
      schema: PROJECT_PACKAGE_SCHEMA,
      version: 1,
      projectName: typeof project.name === 'string' ? project.name : '未命名项目',
      projectFile: `project/${PROJECT_FILE}`,
      sourceProjectDir: source,
      exportedAtMs: String(Date.now()),
    };
    await archive.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    await writeProjectArchive(archive, source, source, counts);
    await archive.close();
  } catch (error) {
    await archive.abort();
    await rm(temporary, { force: true });
    throw error;
  }
  await rm(target, { force: true });
  await rename(temporary, target);
  return { ok: true, filePath: target, count: counts.count, totalSize: counts.totalSize };
}

function rewriteImportedProjectPaths(value: unknown, sourceRoot: string, targetRoot: string): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteImportedProjectPaths(item, sourceRoot, targetRoot);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Json)) {
      if (typeof item === 'string') {
        (value as Json)[key] = rewritePath(item, sourceRoot, targetRoot);
      } else rewriteImportedProjectPaths(item, sourceRoot, targetRoot);
    }
  }
}

function rewritePath(text: string, sourceRoot: string, targetRoot: string): string {
  if (!sourceRoot) return text;
  const normalizedSource = sourceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedText = text.replace(/\\/g, '/');
  if (normalizedText !== normalizedSource && !normalizedText.startsWith(`${normalizedSource}/`)) return text;
  const suffix = normalizedText.slice(normalizedSource.length).replace(/^\/+/, '');
  const parts = suffix.split('/').filter(Boolean);
  return [targetRoot, ...parts].join(sep);
}

async function importProjectPackage(source: string, targetRoot: string): Promise<Json> {
  if (!existsSync(source)) throw new Error(localizedError('native.error.bdaff3d4e7', {}, '项目包不存在'));
  await mkdir(targetRoot, { recursive: true });
  const reader = await StoredZipReader.open(source, (await stat(source)).size).catch((error: unknown) => {
    throw new Error(localizedError('native.error.7c6b74d5d2', { error: String(error) }, `项目包格式无效：${String(error)}`));
  });
  const manifestEntry = reader.entry('manifest.json');
  if (!manifestEntry) throw new Error(localizedError('native.error.271d00e74f', {}, '项目包缺少 manifest.json'));
  if (manifestEntry.size > 1024 * 1024) throw new Error(localizedError('native.error.17726343ad', {}, '项目包清单过大'));
  let manifest: Json;
  try {
    manifest = JSON.parse((await reader.readBuffer('manifest.json')).toString('utf8')) as Json;
  } catch (error) {
    throw new Error(localizedError('native.error.05db8b0431', { error: String(error) }, `项目包清单无效：${String(error)}`));
  }
  if (manifest.schema !== PROJECT_PACKAGE_SCHEMA || manifest.version !== 1 || manifest.projectFile !== `project/${PROJECT_FILE}`) {
    throw new Error(localizedError('native.error.b97ed0790b', {}, '不是受支持的 Shotloom 项目包'));
  }
  let fileCount = 0;
  let totalSize = 0;
  for (const entry of reader.entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (name === 'manifest.json' || name === 'project/') continue;
    if (!name.startsWith('project/') || name.includes('../')) {
      throw new Error(localizedError('native.error.0f90da86b1', { name }, `项目包包含不安全路径：${name}`));
    }
    fileCount += 1;
    totalSize += entry.size;
    if (fileCount > MAX_PACKAGE_FILES) throw new Error(localizedError('native.error.5dae9149f2', {}, '项目包文件数超过上限'));
    if (totalSize > MAX_PACKAGE_BYTES) throw new Error(localizedError('native.error.6c9bb31fda', {}, '项目包解压体积超过 20GB 上限'));
  }
  const projectName = typeof manifest.projectName === 'string' ? manifest.projectName : '导入项目';
  const target = uniqueDir(targetRoot, projectName);
  const temporary = join(targetRoot, `.shotloom-import-${Date.now()}.partial`);
  try {
    await mkdir(temporary, { recursive: true });
    for (const entry of reader.entries) {
      const name = entry.name.replace(/\\/g, '/');
      if (name === 'manifest.json' || name === 'project/') continue;
      const relative = name.slice('project/'.length);
      if (!relative) continue;
      const parts = relative.split('/').filter(Boolean);
      if (parts.some(part => part === '..')) {
        throw new Error(localizedError('native.error.b9f84a3f77', {}, '项目包路径无效'));
      }
      const output = join(temporary, ...parts);
      await mkdir(output.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
      await pipeline(reader.read(name), createWriteStream(output));
    }
    const projectPath = join(temporary, PROJECT_FILE);
    const project = loadProjectFile(projectPath);
    try {
      validateCurrentProject(project);
    } catch (error) {
      throw new Error(localizedError('native.error.fbd533a5a7', { error: String(error instanceof Error ? error.message : error) }, `项目包中的 project.sqlite 无效：${String(error)}`));
    }
    rewriteImportedProjectPaths(project, typeof manifest.sourceProjectDir === 'string' ? manifest.sourceProjectDir : '', target);
    const saved = withDatabase(projectPath, db => transaction(db, () => saveProject(db, project)));
    await rename(temporary, target);
    return {
      ok: true, projectDir: target, filePath: join(target, PROJECT_FILE), project: saved,
      count: fileCount, totalSize,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

defineCommand('project_export_package', (args) => exportProjectPackage(String(args.source ?? ''), String(args.target ?? '')));

defineCommand('project_import_package', (args) => importProjectPackage(String(args.source ?? ''), String(args.targetRoot ?? '')));

defineCommand('project_create_episode_folder', async (args) => {
  const target = uniqueDir(String(args.parent ?? ''), String(args.name ?? ''));
  await mkdir(target, { recursive: true });
  const assets = join(String(args.shared ?? ''), 'assets');
  await mkdir(assets, { recursive: true });
  return { projectDir: target, seriesDir: String(args.shared ?? ''), assetRootDir: assets };
});

defineCommand('project_trash_entry', async (args) => {
  const target = String(args.path ?? '');
  if (existsSync(target)) await shell.trashItem(target);
  return { ok: true };
});

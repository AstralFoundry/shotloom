import { Zip, ZipPassThrough, Unzip, AsyncUnzipInflate, type UnzipFile } from 'fflate';
import { mediaExtension, MEDIA_MIME_BY_EXTENSION } from '../utils/mediaType';
import { isDirectorModelPackage } from './cloudDirectorModels';

type RecordValue = Record<string, unknown>;
export interface ProjectBundle {
  project: RecordValue;
  snapshots: Array<{ nodeId: string; payload: unknown }>;
  records: Array<{ nodeId: string; key: string; payload: unknown }>;
}
const mediaFields = new Set(['path', 'filePath', 'localPath', 'sourceFile', 'sourceUrl', 'url', 'remoteUrl',
  'previewUrl', 'posterPath', 'thumbnailPath', 'coverPath', 'maskFile', 'exportedFile', 'objectUrl', 'dataUrl']);
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

export function projectBundle(value: unknown): ProjectBundle {
  const bundle = value as ProjectBundle | null;
  if (!bundle?.project || bundle.project.schema !== 'shotloom-project' || bundle.project.schemaVersion !== 2
    || !Array.isArray(bundle.project.nodes) || !Array.isArray(bundle.snapshots) || !Array.isArray(bundle.records)
    || bundle.snapshots.some(row => !row || typeof row.nodeId !== 'string' || !row.nodeId || !('payload' in row))
    || bundle.records.some(row => !row || typeof row.nodeId !== 'string' || !row.nodeId || typeof row.key !== 'string' || !row.key || !('payload' in row))) {
    throw new Error('项目包结构无效或版本不受支持');
  }
  return bundle;
}

/** Rewrite only declared media fields; prompts and other user text remain byte-for-byte. */
export async function mapProjectMedia(bundle: ProjectBundle, resolve: (source: string) => Promise<string>): Promise<ProjectBundle> {
  const mapped = new Map<string, string>();
  const walk = async (value: unknown, key = '', depth = 0): Promise<unknown> => {
    if (depth > 128) throw new Error('项目数据嵌套层数过多');
    // Model filenames address bytes already embedded in their portable package.
    if (key === 'package' && isDirectorModelPackage(value)) return structuredClone(value);
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await walk(item, key, depth + 1));
      return result;
    }
    if (value && typeof value === 'object') {
      const result: RecordValue = Object.create(null);
      for (const [field, item] of Object.entries(value)) result[field] = await walk(item, field, depth + 1);
      return result;
    }
    if (typeof value === 'string' && value && mediaFields.has(key)) {
      if (!mapped.has(value)) mapped.set(value, await resolve(value));
      return mapped.get(value)!;
    }
    return value;
  };
  return await walk(bundle) as ProjectBundle;
}

export async function exportProjectPackage(bundle: ProjectBundle, read: (source: string) => Promise<Blob>): Promise<Blob> {
  const parts: BlobPart[] = [];
  let size = 0;
  let failure: Error | undefined;
  const archive = new Zip((error, data) => {
    if (error) { failure = error; return; }
    size += data.length;
    if (size > MAX_PACKAGE_BYTES) { failure = new Error('项目包超过 2 GiB，请拆分后导出'); return; }
    parts.push(data as Uint8Array<ArrayBuffer>);
  });
  const add = async (name: string, blob: Blob) => {
    if (blob.size > MAX_FILE_BYTES) throw new Error('单个媒体文件不能超过 500 MiB');
    const file = new ZipPassThrough(name);
    archive.add(file);
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        file.push(next.value);
        if (failure) throw failure;
      }
      file.push(new Uint8Array(), true);
    } finally { await reader.cancel(); }
    if (failure) throw failure;
  };
  try {
    const mapped = await mapProjectMedia(bundle, async source => {
      const extension = mediaExtension(source);
      const path = `media/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
      await add(path, await read(source));
      return `package://${path}`;
    });
    await add('manifest.json', new Blob([JSON.stringify({ schema: 'shotloom-project-package', version: 2 })]));
    await add('project.json', new Blob([JSON.stringify(mapped)]));
    archive.end();
    if (failure) throw failure;
    return new Blob(parts, { type: 'application/zip' });
  } catch (error) { archive.terminate(); throw error; }
}

export async function readProjectPackage(input: Blob): Promise<{ bundle: ProjectBundle; files: Map<string, Blob> }> {
  if (input.size > MAX_PACKAGE_BYTES) throw new Error('项目包不能超过 2 GiB');
  const files = new Map<string, Blob>();
  const pending: Promise<void>[] = [];
  const active: UnzipFile[] = [];
  let total = 0;
  let failure: Error | undefined;
  const archive = new Unzip(file => {
    if (files.has(file.name) || !/^(?:manifest\.json|project\.json|media\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)$/.test(file.name)) throw new Error('项目包包含重复或不安全的文件名');
    if (files.size >= 20_000) throw new Error('项目包文件数超过上限');
    files.set(file.name, new Blob());
    active.push(file);
    const parts: BlobPart[] = [];
    let size = 0;
    pending.push(new Promise<void>((resolve, reject) => {
      file.ondata = (error, data, final) => {
        if (error) { failure = error; file.terminate(); reject(error); return; }
        size += data.length; total += data.length;
        if (size > MAX_FILE_BYTES || total > MAX_PACKAGE_BYTES || (file.name.endsWith('.json') && !file.name.startsWith('media/') && size > 32 * 1024 * 1024)) {
          failure = new Error('项目包解压体积超过上限'); file.terminate(); reject(failure); return;
        }
        parts.push(data as Uint8Array<ArrayBuffer>);
        if (final) {
          files.set(file.name, new Blob(parts, { type: MEDIA_MIME_BY_EXTENSION[mediaExtension(file.name)] || 'application/octet-stream' }));
          resolve();
        }
      };
      file.start();
    }));
    // A worker can fail while the next input chunk is still being read.
    void pending.at(-1)!.catch(() => {});
  });
  archive.register(AsyncUnzipInflate);
  const reader = input.stream().getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      archive.push(next.value);
      if (failure) throw failure;
    }
    archive.push(new Uint8Array(), true);
    await Promise.all(pending);
    const manifest = JSON.parse(await files.get('manifest.json')?.text() || 'null');
    if (manifest?.schema !== 'shotloom-project-package' || manifest.version !== 2) throw new Error('此项目包版本不受支持，旧 SQLite 项目包请先用桌面客户端导入');
    const bundle = projectBundle(JSON.parse(await files.get('project.json')?.text() || 'null'));
    return { bundle, files };
  } finally { for (const file of active) file.terminate(); await reader.cancel(); }
}

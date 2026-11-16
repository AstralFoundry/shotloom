import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { localizedError } from './errors';
import { backupDatabase } from './db';

/** 文件路径上有产品语义的公共工具，对应 src-tauri/src/commands/common.rs。 */

export const PROJECT_FILE = 'project.sqlite';
export const SHARED_ASSET_LIBRARY_FILE = 'assets.sqlite';

export function sanitizeName(value: string, fallback: string): string {
  const sanitized = String(value || '').trim().replace(/[/\\:*?"<>|]/g, '-');
  return sanitized || fallback;
}

export function uniqueDir(parent: string, preferred: string): string {
  const name = sanitizeName(preferred, '未命名项目');
  let target = join(parent, name);
  for (let index = 2; index < 10_000; index += 1) {
    if (!existsSync(target)) break;
    target = join(parent, `${name}-${index}`);
  }
  return existsSync(target) ? join(parent, `${name}-copy`) : target;
}

export function uniqueFilePath(directory: string, name: string): string {
  const requested = sanitizeName(name, 'resource.bin');
  const extension = extname(requested);
  const stem = basename(requested, extension) || 'resource';
  let target = join(directory, requested);
  for (let index = 2; index < 10_000; index += 1) {
    if (!existsSync(target)) break;
    target = join(directory, extension ? `${stem}-${index}${extension}` : `${stem}-${index}`);
  }
  return target;
}

export async function copyDir(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const name = entry.name;
    if (name.endsWith('.sqlite-wal') || name.endsWith('.sqlite-shm') || entry.isSymbolicLink()) continue;
    const sourcePath = join(source, name);
    const targetPath = join(target, name);
    if (entry.isDirectory()) await copyDir(sourcePath, targetPath);
    else if (extname(name) === '.sqlite') backupDatabase(sourcePath, targetPath);
    else await copyFile(sourcePath, targetPath);
  }
}

export interface FileResult {
  filePath: string;
  path: string;
  name: string;
  size: number;
}

export async function fileResult(path: string): Promise<FileResult> {
  const metadata = await stat(path);
  return { filePath: path, path, name: basename(path), size: metadata.size };
}

/** 打开系统程序的边界：只允许目录与媒体文件，可执行 bundle/脚本一律拒绝。 */
const MEDIA_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'mp4',
  'mov', 'm4v', 'webm', 'avi', 'mkv', 'mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus',
];
const EXECUTABLE_BUNDLE_SUFFIXES = [
  'app', 'pkg', 'dmg', 'command', 'workflow', 'band', 'component', 'framework', 'kext',
  'bundle', 'plugin', 'service', 'xpc', 'prefpane', 'mdimporter', 'qlgenerator',
];

export function isMediaExtension(path: string): boolean {
  return MEDIA_EXTENSIONS.includes(extname(path).slice(1).toLowerCase());
}

export function isSafeOpenTarget(target: string): boolean {
  if (isMediaExtension(target)) return true;
  try {
    if (!statSync(target).isDirectory()) return false;
  } catch {
    return false;
  }
  return !EXECUTABLE_BUNDLE_SUFFIXES.includes(extname(target).slice(1).toLowerCase());
}

export function requireSafeOpenTarget(target: string): void {
  if (!isSafeOpenTarget(target)) {
    throw new Error(localizedError('native.file.unsafePath', { path: target }, `只能打开目录或媒体文件：${target}`));
  }
}

export async function readArrayBufferBase64(path: string): Promise<string> {
  return (await readFile(path)).toString('base64');
}

export async function writeBase64(path: string, data: string, append: boolean): Promise<FileResult> {
  const bytes = Buffer.from(data, 'base64');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: append ? 'a' : 'w' });
  return fileResult(path);
}

export async function copyFileResult(source: string, target: string): Promise<FileResult> {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return fileResult(target);
}

/** 校验和对象可能是几 GB 的视频：分块喂哈希器，不整体读进内存。 */
export async function fileChecksum(path: string): Promise<{ checksum: string; checksumAlgorithm: string; size: number }> {
  const digest = createHash('sha256');
  const size = statSync(path).size;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { checksum: digest.digest('hex'), checksumAlgorithm: 'sha256', size };
}

export function listDirectories(root: string): { name: string; path: string }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, path: join(root, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readHead(path: string, bytes: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

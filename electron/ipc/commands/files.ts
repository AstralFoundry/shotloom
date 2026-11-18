import { shell } from 'electron';
import { realpath } from 'node:fs/promises';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { defineCommand } from '../registry';
import { localizedError } from '../../core/errors';
import { appDataDir } from '../../core/paths';
import {
  copyFileResult, fileChecksum, readArrayBufferBase64, requireSafeOpenTarget,
  uniqueFilePath, writeBase64,
} from '../../core/files';

/** 与 Tauri 版本一致的「文件基础通道」，对应 src-tauri/src/commands/file.rs 的前半部分。 */

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

function dataPath(...parts: string[]): string {
  return join(appDataDir(), ...parts);
}

defineCommand('file_global_asset_root', async () => {
  const root = dataPath('local-asset-library', 'blobs');
  await mkdir(root, { recursive: true });
  return root;
});

defineCommand('file_trash', async (args) => {
  const path = String(args.path ?? '');
  if (!(await exists(path))) return { ok: true, missing: true };
  if (args.projectDirectory) {
    const directory = await realpath(String(args.projectDirectory));
    const root = join(directory, 'assets');
    const actualRoot = await realpath(root);
    const actualPath = await realpath(path);
    const child = relative(root, actualPath);
    if (actualRoot !== root || !child || child === '..' || child.startsWith('../')
      || child.startsWith('..\\') || isAbsolute(child)) {
      throw new Error('Project asset cleanup cannot trash files outside the project assets directory');
    }
  }
  // Electron 的 trashItem 就是各平台的系统回收站；不自己实现删除语义。
  await shell.trashItem(path);
  return { ok: true, path };
});

defineCommand('file_show_item_in_folder', async (args) => {
  const path = String(args.path ?? '');
  if (!(await exists(path))) {
    throw new Error(localizedError('native.file.missing', {}, '要定位的文件不存在'));
  }
  shell.showItemInFolder(path);
  return { ok: true, path };
});

defineCommand('file_open_path', async (args) => {
  const requested = String(args.path ?? '');
  let target: string;
  try {
    target = await realpath(requested);
  } catch {
    throw new Error(localizedError('native.file.pathMissing', { path: requested }, `要打开的路径不存在：${requested}`));
  }
  requireSafeOpenTarget(target);
  const failure = await shell.openPath(target);
  if (failure) {
    throw new Error(localizedError('native.file.openFailed', { detail: failure }, `无法打开路径：${failure}`));
  }
  return { ok: true, path: target };
});

defineCommand('file_read_array_buffer', (args) => readArrayBufferBase64(String(args.path ?? '')));

defineCommand('file_write', (args) => writeBase64(String(args.path ?? ''), String(args.data ?? ''), Boolean(args.append)));

defineCommand('file_copy', (args) => copyFileResult(String(args.source ?? ''), String(args.target ?? '')));

defineCommand('file_path_exists', async (args) => exists(String(args.path ?? '')));

defineCommand('file_checksum', (args) => fileChecksum(String(args.path ?? '')));

defineCommand('file_resolve_unique_path', (args) => uniqueFilePath(String(args.directory ?? ''), String(args.name ?? '')));

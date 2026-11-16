import { clipboard } from 'electron';
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand } from '../registry';
import { withDatabase, transaction } from '../../core/db';
import { localizedError } from '../../core/errors';
import { appDataDir } from '../../core/paths';
import { sanitizeName } from '../../core/files';
import { loadClipboard, saveClipboard } from '../../core/storage';

/**
 * 工作流剪贴板：把一次复制涉及的素材冻结到应用数据目录，系统剪贴板里只放
 * 一个 sentinel 标识；粘贴时再从暂存目录恢复。失败的新复制不能覆盖旧快照。
 */

const SENTINEL_PREFIX = 'shotloom-workflow:';

function validSnapshotId(id: string): boolean {
  return Boolean(id) && /^[A-Za-z0-9_-]+$/.test(id);
}

function clipboardRoot(): string {
  return join(appDataDir(), 'workflow-clipboard');
}

type Json = Record<string, unknown>;

async function stageWorkflow(root: string, payload: Json): Promise<Json> {
  const id = typeof payload.snapshotId === 'string' ? payload.snapshotId : '';
  if (!validSnapshotId(id) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error(localizedError('native.error.985d66180d', {}, '工作流剪贴板数据无效，未暂存'));
  }
  await mkdir(root, { recursive: true });
  const directory = join(root, id);
  try {
    await mkdir(directory, { recursive: false });
  } catch (error) {
    throw new Error(localizedError('native.error.26533634c6', { error: String(error) }, `无法创建工作流暂存目录：${String(error)}`));
  }
  try {
    let count = 0;
    const resources = Array.isArray(payload.resources) ? payload.resources as unknown[] : [];
    for (const [index, resource] of resources.entries()) {
      if (!resource || typeof resource !== 'object') continue;
      const record = resource as Json;
      const source = ['path', 'filePath', 'localPath']
        .map(key => record[key])
        .find((value): value is string => typeof value === 'string' && value.length > 0);
      if (!source) continue;
      const metadata = await stat(source).catch(() => null);
      if (!metadata?.isFile()) {
        throw new Error(localizedError('native.error.275ec0efca', { source }, `工作流素材不存在：${source}`));
      }
      const name = sanitizeName(source.split(/[\\/]/).pop() || 'media', 'media');
      const target = join(directory, `${index}-${name}`);
      await copyFile(source, target).catch((error: unknown) => {
        throw new Error(localizedError('native.error.6f326882a2', { source, error: String(error) }, `暂存素材失败（${source}）：${String(error)}`));
      });
      const handle = await open(target, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      record.stagedPath = target;
      count += 1;
    }
    withDatabase(join(root, 'clipboard.sqlite'), db => transaction(db, () => {
      saveClipboard(db, id, payload);
    }));
    return { snapshotId: id, stagingDir: directory, filesCopied: count, summary: payload.summary };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function loadWorkflow(root: string, id: string): Json {
  if (!validSnapshotId(id)) {
    throw new Error(localizedError('native.error.5223f52609', {}, '工作流剪贴板标识无效'));
  }
  const value = withDatabase(join(root, 'clipboard.sqlite'), db => loadClipboard(db, id));
  return value as Json;
}

defineCommand('clipboard_stage_workflow', async (args) => {
  const root = clipboardRoot();
  const payload = args.payload;
  if (!payload || typeof payload !== 'object') {
    throw new Error(localizedError('native.error.985d66180d', {}, '工作流剪贴板数据无效，未暂存'));
  }
  const result = await stageWorkflow(root, payload as Json);
  const id = typeof result.snapshotId === 'string' ? result.snapshotId : '';
  if (!id) throw new Error(localizedError('native.error.883cbbd57d', {}, '暂存结果缺少标识'));
  clipboard.writeText(`${SENTINEL_PREFIX}${id}`);
  return result;
});

defineCommand('clipboard_read_staged_sentinel', async () => {
  const text = await clipboard.readText();
  if (!text.startsWith(SENTINEL_PREFIX)) return null;
  const id = text.slice(SENTINEL_PREFIX.length);
  return validSnapshotId(id) ? { snapshotId: id } : null;
});

defineCommand('clipboard_load_staged_payload', (args) => {
  return loadWorkflow(clipboardRoot(), String(args.snapshotId ?? ''));
});

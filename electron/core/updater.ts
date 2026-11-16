import { app, BrowserWindow } from 'electron';
import { CancellationToken, autoUpdater } from 'electron-updater';
import { emitEvent } from '../ipc/registry';

/**
 * 自动更新：electron-builder 发布时生成 latest*.yml，客户端用 electron-updater
 * 读取同一份 Release 元数据。检查与下载分开，下载进度通过 update-progress 事件
 * 回推给渲染进程；安装时退出并按需重启。
 *
 * 未打包的开发运行不检查更新（electron-updater 在非打包环境不可用）。
 */

type UpdateInfo = { version: string; body: string };

let pendingVersion: string | null = null;
let cancelled = false;
let downloaded = false;
let token: CancellationToken | null = null;
let progressHandler: ((progress: { delta?: number; total?: number }) => void) | null = null;

function broadcast(payload: unknown): void {
  const contents = BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents && !contents.isDestroyed()) emitEvent(contents, 'update-progress', payload);
}

function releaseNotesText(releaseNotes: unknown): string {
  if (typeof releaseNotes === 'string') return releaseNotes;
  if (Array.isArray(releaseNotes)) {
    return releaseNotes.map(item => {
      if (item && typeof item === 'object' && 'note' in item) {
        const note = (item as { note?: unknown }).note;
        return typeof note === 'string' ? note : '';
      }
      return '';
    }).filter(Boolean).join('\n\n');
  }
  return '';
}

function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[.-]/).map(part => Number(part) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function configureUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('download-progress', (progress) => {
    if (progressHandler) progressHandler(progress);
  });
}

configureUpdater();

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!app.isPackaged) return null;
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  if (!info || compareVersions(info.version, app.getVersion()) <= 0) {
    pendingVersion = null;
    return null;
  }
  pendingVersion = info.version;
  downloaded = false;
  cancelled = false;
  return { version: info.version, body: releaseNotesText(info.releaseNotes) };
}

export async function downloadUpdate(version: string): Promise<{ ok: boolean; error?: string }> {
  if (!pendingVersion || pendingVersion !== version) {
    return { ok: false, error: 'no pending update for that version' };
  }
  if (downloaded) return { ok: true };
  cancelled = false;
  token = new CancellationToken();
  let total = 0;
  progressHandler = (progress) => {
    total = Number(progress.total) || total;
    broadcast({ id: version, event: 'Progress', data: { chunkLength: Number(progress.delta) || 0, contentLength: total } });
  };
  broadcast({ id: version, event: 'Started', data: { contentLength: 0 } });
  try {
    await autoUpdater.downloadUpdate(token);
    if (cancelled) return { ok: false, error: 'update download cancelled' };
    downloaded = true;
    broadcast({ id: version, event: 'Finished', data: { contentLength: total } });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    progressHandler = null;
    token = null;
  }
}

export function cancelUpdateDownload(version: string): { ok: boolean } {
  cancelled = true;
  token?.cancel();
  if (pendingVersion === version) downloaded = false;
  return { ok: true };
}

export function installUpdate(version: string): { ok: boolean; error?: string } {
  if (!downloaded || pendingVersion !== version) {
    return { ok: false, error: 'no downloaded update for that version' };
  }
  // quitAndInstall 会触发 before-quit（清理 Agent Host/恢复日志），再重启到新版本。
  setImmediate(() => { autoUpdater.quitAndInstall(false, true); });
  return { ok: true };
}

import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { assertTrustedSender, isTrustedPage, emitEvent, registerCommandChannel } from './ipc/registry';
import { initializeNativeMenu } from './ipc/commands/settings';
import './ipc/commands/recent';
import './ipc/commands/files';
import './ipc/commands/project';
import './ipc/commands/clipboard';
import './ipc/commands/diagnostics';
import './ipc/commands/recovery';
import './ipc/commands/harness';
import './ipc/commands/media';
import './ipc/commands/generation';
import './ipc/commands/openreel';
import './ipc/commands/plugins';
import './ipc/commands/videoExport';
import './ipc/commands/agentE2e';
import { initializeRecovery, markCleanExit } from './core/recovery';
import { shutdownHarnessRuntime } from './core/harness';
import { cancelUpdateDownload, checkForUpdate, downloadUpdate, installUpdate } from './core/updater';

const isDevelopment = Boolean(process.env.SHOTLOOM_DEV_URL);
const smoke = process.env.SHOTLOOM_SMOKE;
if (process.env.SHOTLOOM_USER_DATA) app.setPath('userData', process.env.SHOTLOOM_USER_DATA);
if (smoke) {
  // Agent/CI 的沙箱里没有可用的 GPU 与 Chromium sandbox：冒烟模式只验证主进程与 IPC。
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
}
const rootDir = process.env.SHOTLOOM_ROOT || app.getAppPath();
const rendererRoot = join(rootDir, 'dist', 'renderer');
// electron-builder 为安装包写入应用图标；直接运行 Electron 时需单独设置。
const developmentIcon = app.isPackaged ? undefined : join(rootDir, 'electron', 'build', 'icons', 'app.png');
app.setName('Shotloom');

const windowConfig = (() => {
  try {
    const parsed = JSON.parse(process.env.SHOTLOOM_WINDOW || '{}');
    return {
      width: Number(parsed.width) || 1440,
      height: Number(parsed.height) || 900,
      minWidth: Number(parsed.minWidth) || 1080,
      minHeight: Number(parsed.minHeight) || 720,
      title: typeof parsed.title === 'string' ? parsed.title : 'Shotloom',
    };
  } catch {
    return { width: 1440, height: 900, minWidth: 1080, minHeight: 720, title: 'Shotloom' };
  }
})();

// 渲染进程走自定义 scheme（而不是 file://）：只有 standard scheme 才有可用的 origin，
// CSP 的 'self'、localStorage 与 Worker 都会随 file:// 一起失效。
protocol.registerSchemesAsPrivileged([
  { scheme: 'shotloom', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let mainWindow: BrowserWindow | null = null;
let quitRequested = false;
let quitApproved = false;
let relaunchRequested = false;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
};

function mimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
}

function rendererFile(requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath || '/').replace(/^\/+/, '');
  const relative = decoded === '' ? 'index.html' : decoded;
  const target = resolve(rendererRoot, relative);
  if (target !== rendererRoot && !target.startsWith(rendererRoot + sep)) return null;
  if (existsSync(target) && statSync(target).isFile()) return target;
  // SPA 深链接回落到 index.html；其余静态资源缺失照常 404。
  const index = join(rendererRoot, 'index.html');
  return extname(decoded) ? null : index;
}

function assetResponse(request: Request): Response {
  const url = new URL(request.url);
  const file = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!file || !existsSync(file)) return new Response('Not Found', { status: 404 });
  const size = statSync(file).size;
  const type = mimeType(file);
  const range = request.headers.get('range');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (start >= size || end < start) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const stream = createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'content-type': type,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
        },
      });
    }
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
    status: 200,
    headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' },
  });
}

async function handleProtocolRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === 'asset') return assetResponse(request);
  const file = rendererFile(url.pathname);
  if (!file) return new Response('Not Found', { status: 404 });
  return new Response(await readFile(file), { status: 200, headers: { 'content-type': mimeType(file) } });
}

function registerDialogs(): void {
  ipcMain.handle('shotloom:dialog-open', async (event, options: Record<string, unknown> = {}) => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const properties: ('openFile' | 'openDirectory' | 'multiSelections')[] = [];
    properties.push(options.directory ? 'openDirectory' : 'openFile');
    if (options.multiple) properties.push('multiSelections');
    const filters = Array.isArray(options.filters)
      ? (options.filters as { name?: string; extensions?: string[] }[]).map(filter => ({ name: filter.name || 'Files', extensions: filter.extensions || ['*'] }))
      : [];
    const pickOptions = {
      title: typeof options.title === 'string' ? options.title : undefined,
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
      properties,
      filters,
    };
    const result = window ? await dialog.showOpenDialog(window, pickOptions) : await dialog.showOpenDialog(pickOptions);
    if (result.canceled || result.filePaths.length === 0) return null;
    return options.multiple ? result.filePaths : result.filePaths[0];
  });

  ipcMain.handle('shotloom:dialog-save', async (event, options: Record<string, unknown> = {}) => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const filters = Array.isArray(options.filters)
      ? (options.filters as { name?: string; extensions?: string[] }[]).map(filter => ({ name: filter.name || 'Files', extensions: filter.extensions || ['*'] }))
      : [];
    const saveOptions = {
      title: typeof options.title === 'string' ? options.title : undefined,
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
      filters,
    };
    const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions);
    return result.canceled || !result.filePath ? null : result.filePath;
  });
}

function registerWindowControls(): void {
  ipcMain.handle('shotloom:window', async (event, action: unknown, value: unknown) => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!window) return null;
    switch (String(action)) {
      case 'minimize': window.minimize(); return null;
      case 'maximize': window.isMaximized() ? window.unmaximize() : window.maximize(); return window.isMaximized();
      case 'close': window.close(); return null;
      case 'destroy':
        if (quitRequested) { quitApproved = true; app.quit(); }
        else window.destroy();
        return null;
      case 'cancel-close': quitRequested = false; relaunchRequested = false; return null;
      case 'is-maximized': return window.isMaximized();
      case 'title': return window.getTitle();
      case 'set-title': window.setTitle(String(value ?? '')); return null;
      default: throw new Error(`unknown window action: ${String(action)}`);
    }
  });
  ipcMain.handle('shotloom:relaunch', (event) => {
    assertTrustedSender(event);
    relaunchRequested = true;
    app.quit();
  });
  ipcMain.handle('shotloom:update-check', (event) => { assertTrustedSender(event); return checkForUpdate(); });
  ipcMain.handle('shotloom:update-download', (event, version: unknown) => { assertTrustedSender(event); return downloadUpdate(String(version ?? '')); });
  ipcMain.handle('shotloom:update-cancel', (event, version: unknown) => { assertTrustedSender(event); return cancelUpdateDownload(String(version ?? '')); });
  ipcMain.handle('shotloom:update-install', (event, version: unknown) => { assertTrustedSender(event); return installUpdate(String(version ?? '')); });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: windowConfig.width,
    height: windowConfig.height,
    minWidth: windowConfig.minWidth,
    minHeight: windowConfig.minHeight,
    title: windowConfig.title,
    ...(developmentIcon ? { icon: developmentIcon } : {}),
    show: false,
    backgroundColor: '#000000',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 21 } } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedPage(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => { window.show(); });
  window.on('resize', () => { emitEvent(window.webContents, 'window-resized', {}); });
  window.on('maximize', () => { emitEvent(window.webContents, 'window-resized', {}); });
  window.on('unmaximize', () => { emitEvent(window.webContents, 'window-resized', {}); });
  // 关闭请求交给渲染进程决定（未保存确认/最小化到后台），与 Tauri 的 onCloseRequested 一致。
  window.on('close', (event) => {
    if (quitApproved || window.webContents.isDestroyed()) return;
    event.preventDefault();
    emitEvent(window.webContents, 'window-close-requested', { reason: 'close' });
  });
  window.on('closed', () => { mainWindow = null; });

  if (isDevelopment) void window.loadURL(process.env.SHOTLOOM_DEV_URL as string);
  else void window.loadURL('shotloom://app/index.html');
  return window;
}

async function runSmoke(window: BrowserWindow): Promise<void> {
  const timeout = setTimeout(() => {
    console.error('[smoke] timed out waiting for renderer');
    app.exit(1);
  }, 60_000);
  const consoleErrors: string[] = [];
  window.webContents.on('console-message', (details) => {
    console.log(`[renderer] ${details.message}`);
    if (details.level === 'error') consoleErrors.push(details.message);
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const agentHost = process.env.SHOTLOOM_AGENT_HOST || '';
      const report = await window.webContents.executeJavaScript(`(async () => {
        const invoke = (command, args) => window.shotloomDesktop.invoke(command, args).then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
        const settings = await invoke('settings_get');
        const root = await invoke('project_get_default_root');
        const recent = await invoke('recent_list');
        const storage = await invoke('storage_get', { name: 'skills', fallback: { storageVersion: 1, skills: [] } });
        const diagnostics = await invoke('diagnostics_build', { files: { 'README.txt': 'smoke' } });
        // 端到端：建项目 → 保存 → 读取 → 快照 → 导出包 → 导入包 → 最近项目。
        // 媒体层：写入 1x1 PNG，再用真实 ffmpeg/ffprobe 探测与生成预览。
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const mediaPath = root.value + '/smoke.png';
        await invoke('file_write', { path: mediaPath, data: png, append: false });
        const probe = await invoke('file_probe_media', { source: mediaPath });
        const preview = await invoke('file_read_image_preview', { path: mediaPath, maxSize: 64 });
        // 厂商插件发行包：list 会按需安装默认发行包，必须先有这个目录。
        const plugins = await invoke('provider_plugins', { operation: 'list', args: {} });
        const folder = await invoke('project_create_folder', { parent: root.value, name: 'Smoke Project' });
        const project = {
          schema: 'shotloom-project', schemaVersion: 2, id: 'smoke', name: 'Smoke Project',
          createdAt: '1', updatedAt: '1',
          nodes: [{ id: 'n1', type: 'text', title: 'hello' }], edges: [], tasks: [], assets: [], materials: [],
          harnessSessions: [], productionPlans: [], agentBatches: [], agentEvaluations: [],
          canvasHistory: [{ step: 1 }], canvasRedoStack: [],
        };
        const saved = await invoke('project_save', { directory: folder.value, project });
        const read = await invoke('project_read_file', { path: saved.ok ? saved.value.filePath : '' });
        const snapshot = await invoke('project_snapshot_create', { directory: folder.value, record: { id: 'snap-1', createdAt: '1', reason: 'auto', contentHash: 'h', payloadBytes: 2, mediaRefs: [] } });
        const snapshots = await invoke('project_snapshot_list', { directory: folder.value });
        const pkg = root.value + '/smoke-project.zip';
        const exported = await invoke('project_export_package', { source: folder.value, target: pkg });
        const imported = await invoke('project_import_package', { source: pkg, targetRoot: root.value + '/imports' });
        const importedRead = await invoke('project_read_file', { path: imported.ok ? imported.value.filePath : '' });
        // Harness：真实拉起 Agent Host，等到既 running 又 ready，再优雅停止。
        const agentHost = ${JSON.stringify(process.env.SHOTLOOM_AGENT_HOST || '')};
        let harness = { skipped: true };
        if (agentHost) {
          const started = await invoke('start_harness_runtime', { options: { sourceRoot: agentHost } });
          let status = started;
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline && !(status.ok && status.value.ready)) {
            await new Promise(resolve => setTimeout(resolve, 250));
            status = await invoke('harness_runtime_status');
          }
          const stopped = await invoke('stop_harness_runtime');
          harness = {
            running: status.ok ? status.value.running : status.error,
            ready: status.ok ? status.value.ready : status.error,
            stoppedRunning: stopped.ok ? stopped.value.running : stopped.error,
          };
        }
        const added = await invoke('recent_add', { project: { filePath: saved.ok ? saved.value.filePath : '', name: 'Smoke Project' } });
        const removed = await invoke('recent_remove', { path: saved.ok ? saved.value.filePath : '' });
        return {
          bridge: Boolean(window.shotloomDesktop),
          platform: await invoke('platform'),
          appHtmlLength: document.querySelector('#app')?.innerHTML.length ?? 0,
          bodyText: (document.body.innerText || '').slice(0, 120),
          settingsVersion: settings.ok ? settings.value.storageVersion : settings.error,
          projectsRoot: root.ok ? root.value : root.error,
          recentCount: recent.ok ? recent.value.length : recent.error,
          storageOk: storage.ok && Array.isArray(storage.value.skills),
          diagnosticsBytes: diagnostics.ok ? diagnostics.value.length : diagnostics.error,
          savedNodes: saved.ok ? saved.value.project.nodes.length : saved.error,
          readRevision: read.ok ? read.value.storageRevision : read.error,
          historyEntries: read.ok ? (read.value.canvasHistory || []).length : read.error,
          snapshots: snapshots.ok ? snapshots.value.length : snapshots.error,
          exported: exported.ok ? { count: exported.value.count, totalSize: exported.value.totalSize } : exported.error,
          importedNodes: importedRead.ok ? importedRead.value.nodes.length : importedRead.error,
          recentAfterAdd: added.ok ? added.value.length : added.error,
          recentAfterRemove: removed.ok ? removed.value.length : removed.error,
          snapshotCreate: snapshot.ok ? snapshot.value.saved : snapshot.error,
          probe: probe.ok ? { width: probe.value.width, height: probe.value.height, kind: probe.value.kind } : probe.error,
          pluginCount: plugins.ok && Array.isArray(plugins.value.plugins) ? plugins.value.plugins.length : plugins.error,
          previewBytes: preview.ok ? String(preview.value).length : preview.error,
          harness,
        };
      })()`);
      console.log(`[smoke] ${JSON.stringify(report)}`);
      if (consoleErrors.length) console.log(`[smoke] console errors: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
      const passed = report.bridge && report.platform?.ok === true && report.platform.value === process.platform && report.appHtmlLength > 0
        && report.settingsVersion === 7 && typeof report.projectsRoot === 'string' && typeof report.recentCount === 'number'
        && report.storageOk && typeof report.diagnosticsBytes === 'number' && report.diagnosticsBytes > 0
        && report.savedNodes === 1 && report.readRevision === 1 && report.historyEntries === 1
        && report.snapshots === 1 && report.exported && report.exported.count >= 1
        && report.importedNodes === 1 && report.recentAfterAdd === 1 && report.recentAfterRemove === 0
        && report.snapshotCreate === true
        && report.probe && report.probe.width === 1 && report.probe.height === 1
        && typeof report.pluginCount === 'number' && report.pluginCount > 0
        && typeof report.previewBytes === 'number' && report.previewBytes > 0
        && (!agentHost || (report.harness.running === true && report.harness.ready === true && report.harness.stoppedRunning === false));
      clearTimeout(timeout);
      app.exit(passed ? 0 : 1);
    } catch (error) {
      clearTimeout(timeout);
      console.error('[smoke] failed', error);
      app.exit(1);
    }
  });
}

app.whenReady().then(async () => {
  if (developmentIcon && process.platform === 'darwin') app.dock?.setIcon(developmentIcon);
  protocol.handle('shotloom', handleProtocolRequest);
  // 只允许本机渲染进程使用原生通道；不做任意来源的 IPC。
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(['clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen'].includes(permission));
  });
  registerCommandChannel();
  registerDialogs();
  registerWindowControls();
  initializeRecovery();
  initializeNativeMenu();
  mainWindow = createWindow();
  if (smoke) {
    await runSmoke(mainWindow);
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 系统退出与窗口关闭共用渲染层的保存/任务守卫。
app.on('before-quit', (event) => {
  if (!quitApproved && mainWindow && !mainWindow.webContents.isDestroyed()) {
    event.preventDefault();
    if (!quitRequested) {
      quitRequested = true;
      emitEvent(mainWindow.webContents, 'window-close-requested', { reason: 'quit' });
    }
    return;
  }
  if (relaunchRequested) app.relaunch();
  shutdownHarnessRuntime();
  markCleanExit();
});

import { BrowserWindow } from 'electron';
import { defineCommand, emitEvent } from '../registry';
import { appDataDir, appDataFile, APP_DATABASE } from '../../core/paths';
import {
  cancelGenerationRequest,
  parseGenerationDownload,
  parseGenerationRequest,
  runGenerationDownload,
  runGenerationRequest,
  runGenerationStream,
  type GatewayEnvironment,
  type GenerationStreamEventPayload,
} from '../../core/gateway';

/**
 * 生成网关 IPC：generation_request / generation_stream / generation_download / generation_cancel。
 * 对应 src-tauri/src/commands/generation_gateway.rs；凭据解析、出网边界与 multipart 在 core/gateway.ts。
 */

function gatewayEnvironment(): GatewayEnvironment {
  return { appData: appDataDir(), settingsFile: appDataFile(APP_DATABASE) };
}

/**
 * Rust 用 `app.emit` 做应用级广播，Electron 主进程没有等价 API；本应用始终只有
 * label 'main' 一个业务窗口，所以 `BrowserWindow.getAllWindows()` 里的这个主窗口
 * 就是广播目标，行为与 Rust 一致。
 * 发送失败（窗口正在销毁）时静默丢弃，和 Rust 忽略 emit 结果一致。
 */
function emitGenerationStreamEvent(payload: GenerationStreamEventPayload): void {
  try {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && !candidate.webContents.isDestroyed(),
    );
    if (window) emitEvent(window.webContents, 'generation-stream-event', payload);
  } catch (error) {
    console.error('[electron] unable to emit generation stream event', error);
  }
}

defineCommand('generation_request', (args) => {
  return runGenerationRequest(parseGenerationRequest(args.request), gatewayEnvironment());
});

defineCommand('generation_stream', (args) => {
  return runGenerationStream(
    parseGenerationRequest(args.request),
    gatewayEnvironment(),
    emitGenerationStreamEvent,
  );
});

defineCommand('generation_download', (args) => {
  return runGenerationDownload(parseGenerationDownload(args.request), gatewayEnvironment());
});

defineCommand('generation_cancel', (args) => cancelGenerationRequest(String(args.requestId ?? '')));

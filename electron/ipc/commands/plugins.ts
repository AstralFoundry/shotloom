import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { defineCommand, emitEvent } from '../registry';
import { APP_DATABASE, appDataDir, appDataFile } from '../../core/paths';
import {
  callProviderPlugin, cancelPluginCall, configureProviderPlugins, fetchProviderPluginIndex,
  inspectProviderPackage, installProviderPackage, listProviderPlugins, mutateProviderPlugin,
  parsePluginCallArguments, readProviderPluginDocumentation, searchProviderPlugins,
  type JsonObject, type PluginEnvironment,
} from '../../core/plugins';

/**
 * 厂商插件 IPC：provider_plugins / provider_plugin_call / provider_plugin_cancel。
 * 对应 src-tauri/src/commands/provider_plugins.rs；包解析、安装与子进程宿主在 core/plugins.ts。
 *
 * 产品边界：插件代码只在独立 Node 子进程里执行，主进程不 import 任何插件模块；
 * 目录变更写库成功后广播 provider-plugins-changed，渲染进程据此重读快照。
 */

function runtimeResourceRoot(): string {
  // 与 electron/core/harness.ts 的 agent-host 定位一致：开发期读仓库产物，发行期读打包资源。
  if (!app.isPackaged) return join(app.getAppPath(), 'src-tauri', 'resources');
  return join(process.resourcesPath, 'resources');
}

function pluginEnvironment(): PluginEnvironment {
  return {
    appData: appDataDir(),
    databaseFile: appDataFile(APP_DATABASE),
    distributionDir: join(runtimeResourceRoot(), 'provider-plugins'),
    runtimeRoot: join(runtimeResourceRoot(), 'agent-host'),
    appVersion: app.getVersion(),
  };
}

function emitPluginsChanged(): void {
  try {
    // 应用始终只有 label 'main' 一个业务窗口；发送失败（窗口销毁）时静默丢弃，和 Rust 忽略 emit 一致。
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (!contents || contents.isDestroyed()) return;
    emitEvent(contents, 'provider-plugins-changed', null);
  } catch (error) {
    console.error('[electron] unable to emit provider plugin change', error);
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, key: string): string {
  if (!isRecord(value)) return '';
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : '';
}

defineCommand('provider_plugins', async (raw) => {
  const operation = text(raw, 'operation');
  const args = isRecord(raw.args) ? raw.args : {};
  if (operation === 'list') {
    const result = await listProviderPlugins(pluginEnvironment());
    if (result.changed) emitPluginsChanged();
    return result.state;
  }
  if (operation === 'search') return searchProviderPlugins(args);
  if (operation === 'inspect') {
    return inspectProviderPackage(pluginEnvironment(), text(args, 'source'), text(args, 'registry'));
  }
  if (operation === 'install') {
    const state = await installProviderPackage(
      pluginEnvironment(),
      text(args, 'source'),
      text(args, 'digest'),
      args.trustedCode === true,
      text(args, 'registry'),
    );
    emitPluginsChanged();
    return state;
  }
  if (operation === 'documentation') {
    return readProviderPluginDocumentation(pluginEnvironment(), text(args, 'id'), text(args, 'path'));
  }
  if (operation === 'index') return fetchProviderPluginIndex(text(args, 'url'));
  if (operation === 'configure') {
    const state = await configureProviderPlugins(pluginEnvironment(), args);
    emitPluginsChanged();
    return state;
  }
  if (operation === 'enable' || operation === 'remove' || operation === 'rollback') {
    const state = await mutateProviderPlugin(pluginEnvironment(), operation, args);
    emitPluginsChanged();
    return state;
  }
  throw new Error('Unknown plugin operation');
});

defineCommand('provider_plugin_call', (raw) => {
  return callProviderPlugin(pluginEnvironment(), parsePluginCallArguments(raw));
});

defineCommand('provider_plugin_cancel', (raw) => {
  cancelPluginCall(text(raw, 'requestId'));
  return null;
});

import { defineCommand } from '../registry';
import { withDatabase, transaction } from '../../core/db';
import { localizedError } from '../../core/errors';
import { appDataFile } from '../../core/paths';
import {
  bindWindowProject, downloadDirectory, loadSettings, saveSettings, saveCatalog, loadCatalog,
  setDownloadDirectory, setTokenGroup, windowProject,
} from '../../core/storage';
import { applyNativeMenu } from '../../core/menu';
import defaults from '../../../renderer/src/config/shotloom-defaults.generated.json';

const SETTINGS_STORAGE_VERSION = 7;

/** 当前窗口标签：Tauri 用窗口 label 绑定项目，Electron 只有一个主窗口。 */
export function windowLabel(): string {
  return 'main';
}

function currentSettingsDefaults(): Record<string, unknown> {
  return {
    storageVersion: SETTINGS_STORAGE_VERSION,
    providerConfigs: {},
    tokenGroups: [],
    agentCanRunNodes: false,
    canvasActionShortcuts: {},
    ...(defaults.appSettings as Record<string, unknown>),
  };
}

function validateCurrentSettings(settings: unknown): asserts settings is Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(localizedError('native.settings.invalid', {}, '设置数据格式无效：必须是 JSON 对象'));
  }
  const value = settings as Record<string, unknown>;
  const version = value.storageVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error(localizedError('native.settings.versionMissing', {}, '设置数据缺少 storageVersion'));
  }
  if (version !== SETTINGS_STORAGE_VERSION) {
    throw new Error(localizedError('native.settings.versionUnsupported',
      { expected: SETTINGS_STORAGE_VERSION, actual: version },
      `设置数据版本不受支持：需要 v${SETTINGS_STORAGE_VERSION}，实际为 v${version}`));
  }
}

export function readSettings(): Record<string, unknown> {
  return withDatabase(appDataFile('app.sqlite'), (db) => {
    const settings = loadSettings(db, currentSettingsDefaults()) as Record<string, unknown>;
    validateCurrentSettings(settings);
    return settings;
  });
}

/** 设置落盘后同步原生菜单与语言，和 Tauri 的 native_ui::sync 行为一致。 */
export function writeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  validateCurrentSettings(settings);
  settings.updatedAt = String(Date.now());
  withDatabase(appDataFile('app.sqlite'), (db) => { saveSettings(db, settings); });
  applyNativeMenu(String(settings.locale ?? 'zh-CN'));
  return settings;
}

defineCommand('platform', () => process.platform);

defineCommand('settings_get', () => readSettings());

defineCommand('settings_set', (args) => {
  const settings = args.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(localizedError('native.settings.invalid', {}, '设置数据格式无效：必须是 JSON 对象'));
  }
  return writeSettings({ ...(settings as Record<string, unknown>) });
});

defineCommand('settings_set_token_group', (args) => {
  return setTokenGroup(appDataFile('app.sqlite'), args.id, currentSettingsDefaults());
});

defineCommand('storage_get', (args) => {
  const name = String(args.name ?? '');
  const fallback = args.fallback;
  return withDatabase(appDataFile('app.sqlite'), (db) => {
    const value = loadCatalog(db, name);
    return value === undefined ? fallback : value;
  });
});

defineCommand('storage_set', (args) => {
  const name = String(args.name ?? '');
  const value = args.value;
  withDatabase(appDataFile('app.sqlite'), (db) => { saveCatalog(db, name, value); });
  return value;
});

defineCommand('workspace_project_get', () => {
  return withDatabase(appDataFile('app.sqlite'), (db) => windowProject(db, windowLabel()));
});

defineCommand('workspace_project_set', (args) => {
  const directory = typeof args.directory === 'string' && args.directory ? args.directory : null;
  withDatabase(appDataFile('app.sqlite'), (db) => {
    transaction(db, () => { bindWindowProject(db, windowLabel(), directory); });
  });
  return null;
});

defineCommand('download_directory_get', () => {
  return withDatabase(appDataFile('app.sqlite'), (db) => downloadDirectory(db));
});

defineCommand('download_directory_set', (args) => {
  const directory = String(args.directory ?? '');
  withDatabase(appDataFile('app.sqlite'), (db) => { setDownloadDirectory(db, directory); });
  return null;
});

// 应用启动时按已保存的语言建立原生菜单。
export function initializeNativeMenu(): void {
  try {
    const settings = readSettings();
    applyNativeMenu(String(settings.locale ?? 'zh-CN'));
  } catch (error) {
    console.error('[electron] unable to read menu language', error);
    applyNativeMenu('zh-CN');
  }
}

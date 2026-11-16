import { app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 用户数据的根目录必须和 Tauri 版本一致（`com.shotloom.app`），
 * 否则升级到 Electron 后用户会看到空的项目列表和丢失的设置。
 */
export const APP_IDENTIFIER = 'com.shotloom.app';

export function appDataDir(): string {
  // 测试与多份开发环境要能隔离用户数据；正式启动不设这个变量。
  const override = process.env.SHOTLOOM_APPDATA_DIR;
  if (override) return override;
  if (process.platform === 'linux') {
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    return join(dataHome, APP_IDENTIFIER);
  }
  return join(app.getPath('appData'), APP_IDENTIFIER);
}

export function userFile(name: string): string {
  return join(appDataDir(), name);
}

export const APP_DATABASE = 'app.sqlite';
export const PROJECT_DATABASE = 'project.sqlite';

export function appDataFile(name: string): string {
  return userFile(name);
}

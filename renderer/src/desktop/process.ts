import { desktopBridge } from './core.ts';

/** 重启应用（安装更新后调用），对应 Tauri 的 plugin-process::relaunch。 */
export async function relaunch(): Promise<void> {
  await desktopBridge()?.update.relaunch();
}

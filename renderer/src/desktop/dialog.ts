import { desktopBridge } from './core.ts';
import type { DesktopDialogOptions } from './types.ts';

/**
 * 系统文件对话框。`recursive` 是 Tauri dialog 的选项（选择目录时递归列出内容），
 * Electron 的 openDirectory 本身就能选中目录，这里保留字段只为调用方签名不变。
 */

export async function open(options: DesktopDialogOptions = {}): Promise<string | string[] | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return await bridge.dialog.open(options);
}

export async function save(options: DesktopDialogOptions = {}): Promise<string | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return await bridge.dialog.save(options);
}

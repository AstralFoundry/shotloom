import { app } from 'electron';
import { defineCommand } from '../registry';
import {
  cancelOpenReelExport,
  finishOpenReelExport,
  shutdownOpenReelExports,
  startOpenReelExport,
  writeOpenReelExport,
} from '../../core/openreel';

/**
 * OpenReel 原生编辑器导出命令，对应 src-tauri/src/commands/openreel_export.rs。
 * 状态机、临时文件与 ffmpeg 参数在 core/openreel.ts；这里只做 IPC 入参整形。
 *
 * Tauri 用 window.label() 分配 job 所有权；Electron 只有一个业务窗口，固定为 'main'。
 */
const OWNER = 'main';

/** Rust 用 base64 STANDARD 引擎解码：非法字符或长度会直接失败，不能静默丢弃。 */
function decodeBase64(data: string): Buffer {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('Invalid base64 data');
  }
  return Buffer.from(data, 'base64');
}

/** position 在 Rust 是 u64，由 serde 把关；这里保持非负安全整数语义。 */
function u64(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid position: ${String(value)}`);
  }
  return value;
}

defineCommand('openreel_export_start', args => (
  startOpenReelExport(OWNER, String(args.projectDir ?? ''), args.settings)
));

defineCommand('openreel_export_write', args => (
  writeOpenReelExport(
    OWNER,
    String(args.jobId ?? ''),
    String(args.kind ?? ''),
    decodeBase64(String(args.data ?? '')),
    u64(args.position),
  )
));

defineCommand('openreel_export_finish', args => finishOpenReelExport(OWNER, String(args.jobId ?? '')));

defineCommand('openreel_export_cancel', args => cancelOpenReelExport(OWNER, String(args.jobId ?? '')));

// Rust 在窗口 Destroyed 与 RunEvent::Exit 时 shutdown 导出注册表；
// Electron 里对应窗口全部关闭与应用退出，未完成的 job 走取消路径而不是继续编码。
app.on('window-all-closed', () => shutdownOpenReelExports());
app.on('before-quit', () => shutdownOpenReelExports());

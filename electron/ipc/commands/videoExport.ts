import { defineCommand } from '../registry';
import { beginMediaTask, finishMediaTask } from '../../core/media';
import { exportVideoEditorProject, parseVideoEditorProject } from '../../core/videoExport';

/**
 * 剪辑导出 IPC：file_export_video_project。
 * 对应 src-tauri/src/commands/video_export.rs；命令名与参数形状（requestId/target/project）
 * 沿用 Tauri 契约，渲染进程 services/tauriApi.ts 不需要改映射。
 *
 * 取消不在这里另注册命令：Rust 的导出与其它长时媒体任务共用 media_task_cancel +
 * requestId 登记表，Electron 侧同一份登记表在 core/media.ts（media_task_cancel 由媒体命令模块拥有）。
 * 这里只把本次导出登记进去，渲染进程取消时仍走 media_task_cancel 同一个 requestId。
 *
 * Rust 版导出不 emit 任何进度事件，因此这里也不广播事件；调用方通过 Promise 的
 * 完成/拒绝观察结果（取消映射为 native.error.931ead0596）。
 */
defineCommand('file_export_video_project', async (args) => {
  const requestId = String(args.requestId ?? '');
  const target = String(args.target ?? '');
  const project = parseVideoEditorProject(args.project);
  const cancelled = beginMediaTask(requestId);
  try {
    return await exportVideoEditorProject(target, project, cancelled);
  } finally {
    finishMediaTask(requestId);
  }
});

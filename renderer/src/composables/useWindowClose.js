import { flushAutoSave, store, saveProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { showToast } from '@/composables/useToast';
import { getAgentRuntimeHealth } from '@/agent/runtime/runStore';

let cleanCloseSnapshot = '';

/**
 * 创建当前项目状态的快照字符串，用于比较是否有未保存的更改。
 * @returns {string}
 */
function createCloseSnapshot() {
  return JSON.stringify({
    project: store.project,
    projectDir: store.projectDir,
    filePath: store.filePath,
  });
}

/**
 * 将当前项目状态标记为"干净"（已保存）。
 * 通常在保存或打开新项目后调用。
 */
export function markProjectCleanForClose() {
  cleanCloseSnapshot = createCloseSnapshot();
}

/**
 * 检查当前项目相比最后标记的干净状态是否有未保存更改。
 * @returns {boolean}
 */
export function hasUnsavedProjectChanges() {
  return cleanCloseSnapshot && cleanCloseSnapshot !== createCloseSnapshot();
}

/**
 * 注册窗口关闭确认桥接。
 * 当用户关闭窗口时，主进程请求确认 → 检查未保存更改 → 提示保存/放弃/取消。
 * 在应用根组件挂载时调用，并在卸载时执行返回的清理函数。
 * @returns {function(): void} 清理函数
 */
export function useWindowClose() {
  if (useWindowClose.dispose) return useWindowClose.dispose;

  markProjectCleanForClose();
  useWindowClose.dispose = desktopApi.window.onCloseRequested?.(async (action) => {
    try {
      const autoSaved = await flushAutoSave();
      if (autoSaved) markProjectCleanForClose();
      const runtimeHealth = getAgentRuntimeHealth();
      if (!runtimeHealth.safeToClose) {
        const shouldInterrupt = window.confirm(
          `当前项目仍有运行中的工作：\n${runtimeHealth.blockingReasons.map((reason) => `• ${reason}`).join('\n')}\n\n仍然关闭会中断当前运行；已保存的待处理问题可以在重新打开项目后继续。是否仍要关闭？`,
        );
        if (!shouldInterrupt) {
          await desktopApi.window.cancelClose?.();
          return;
        }
      }
      if (hasUnsavedProjectChanges()) {
        const shouldSave = window.confirm('项目有未保存的更改。点击"确定"保存后关闭，点击"取消"选择其他操作。');
        if (shouldSave) {
          const saved = await saveProject();
          if (saved) markProjectCleanForClose();
          if (!saved) {
            await desktopApi.window.cancelClose?.();
            return;
          }
        } else {
          const shouldDiscard = window.confirm('不保存当前更改并关闭窗口？');
          if (!shouldDiscard) {
            await desktopApi.window.cancelClose?.();
            return;
          }
        }
      }
      await desktopApi.window.confirmClose?.(action);
    } catch (error) {
      showToast(error?.message || '关闭窗口失败');
      await desktopApi.window.cancelClose?.();
    }
  });
  return useWindowClose.dispose;
}

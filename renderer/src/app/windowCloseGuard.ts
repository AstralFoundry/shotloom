import { t } from '@/i18n';
import { confirmAction } from "./ui/confirm/confirmService";
// 关闭确认守卫：桌面窗口请求关闭时，先把"有没有未保存改动"和"有没有仍在运行的 Agent"
// 变成一次明确的确认，再放行原生层。它属于应用生命周期，不是 React Hook——
// 根组件挂载时注册一次，卸载时执行返回的清理函数。
import { desktopApi } from "@/services/desktopApi";
import { flushAutoSave, saveProject, store } from "@/store/projectStore";
import { showErrorMessage } from "@/store/notificationStore";
import { assertProjectOperationIdle } from "@/services/projectOperationGuards";

// 桌面桥的回执与异常按松散 JSON 读取。
type AnyRecord = Record<string, any>;

let cleanCloseSnapshot = "";
let windowCloseDisposable: (() => void) | undefined;

function createCloseSnapshot() {
  return JSON.stringify({
    project: store.project,
    projectDir: store.projectDir,
    filePath: store.filePath,
  });
}

// 保存成功或打开新项目之后把当前状态记为"干净"；快照为空表示还没有基准，不报未保存。
function markProjectClean() {
  cleanCloseSnapshot = createCloseSnapshot();
}

function hasUnsavedProjectChanges() {
  return Boolean(cleanCloseSnapshot) && cleanCloseSnapshot !== createCloseSnapshot();
}

export function registerWindowCloseGuard() {
  if (windowCloseDisposable) return windowCloseDisposable;

  markProjectClean();
  windowCloseDisposable = desktopApi.window.onCloseRequested?.(async (action: string) => {
    try {
      assertProjectOperationIdle(store.project);
      const autoSaved = await flushAutoSave();
      if (autoSaved) markProjectClean();
      if (hasUnsavedProjectChanges()) {
        const shouldSave = await confirmAction({ title: t("ui.windowCloseGuard.text.8b41a3a0") });
        if (shouldSave) {
          const saved = await saveProject();
          if (saved) markProjectClean();
          if (!saved) {
            await desktopApi.window.cancelClose?.();
            return;
          }
        } else {
          const shouldDiscard = await confirmAction({ title: t("ui.windowCloseGuard.text.0aff0649"), danger: true });
          if (!shouldDiscard) {
            await desktopApi.window.cancelClose?.();
            return;
          }
        }
      }
      await desktopApi.window.confirmClose?.(action);
    } catch (error) {
      showErrorMessage((error as AnyRecord)?.message || t("ui.windowCloseGuard.text.5e330be2"), t("ui.windowCloseGuard.text.4064c8ee"));
      await desktopApi.window.cancelClose?.();
    }
  });
  return windowCloseDisposable;
}

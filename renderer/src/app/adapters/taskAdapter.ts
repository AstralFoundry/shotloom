import { t } from '@/i18n';
import { isActiveTaskStatus } from '../../domain/tasks/TaskStatus';
import {
  adoptRemoteTask,
  cancelTask,
  canAdoptRemoteTask,
  canRetryTask,
  clearTasks,
  failedTaskStatuses,
  isHistoricalModelTask,
  retryTask,
  statusLabel,
} from "../../store/taskStore.ts";
import { store } from "../../store/projectStore.ts";
import type { GenerationTask } from "../views/TasksView";

export const taskTypeLabels: Record<string, string> = {
  imageGeneration: t("ui.taskAdapter.imageGeneration.1f6a9dab"),
  videoGeneration: t("ui.taskAdapter.videoGeneration.19978a8d"),
  audioGeneration: t("ui.taskAdapter.audioGeneration.d371481a"),
  textGeneration: t("ui.taskAdapter.textGeneration.9612898b"),
};

export function taskTypeLabel(task: GenerationTask) {
  return taskTypeLabels[task.type || ""] || task.type || t("ui.taskAdapter.text.cafe3d5c");
}

/** 搜索按界面上看得见的中文标签命中，原始枚举与 ID 片段一并保留，贴日志时仍能搜到。 */
export function taskSearchText(task: GenerationTask) {
  return [
    task.title,
    taskTypeLabel(task),
    task.type,
    statusLabel(task.status),
    task.historical ? statusLabel("historical") : "",
    task.status,
    task.model,
    task.error,
    task.nodeId,
    task.id ? `#${String(task.id).slice(-8)}` : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

export interface TaskStatusFilter {
  key: string;
  label: string;
  match: (task: GenerationTask) => boolean;
}

/** 状态筛选用 taskStore 的真实状态集合分桶，历史任务的底层状态仍是它当时的结果。 */
export const taskStatusFilters: TaskStatusFilter[] = [
  { key: "all", label: t("ui.taskAdapter.label.778fc8f9"), match: () => true },
  {
    key: "active",
    label: t("ui.taskAdapter.label.6f1972e4"),
    match: (task) => isActiveTaskStatus(task.status),
  },
  { key: "failed", label: t("ui.taskAdapter.label.3e3c8068"), match: (task) => failedTaskStatuses.has(task.status) },
  { key: "completed", label: t("ui.taskAdapter.label.e99b48a2"), match: (task) => task.status === "completed" },
];

/**
 * 上游错误形如「中文摘要：reqwest/网关原文」。冒号后的原文不丢掉也不抢主行：
 * URL 能看出请求实际打到了哪个厂商，是排查凭据与路由问题的第一手信息。
 */
export function splitTaskError(error: string) {
  const index = error.indexOf("：");
  return index > 0
    ? { summary: error.slice(0, index), detail: error.slice(index + 1).trim() }
    : { summary: error, detail: "" };
}

export function taskViewData(): GenerationTask[] {
  return (store.project.tasks || []).map((task: GenerationTask) => ({
    ...task,
    historical: isHistoricalModelTask(task),
    canRetry: canRetryTask(task),
    canAdoptRemote: canAdoptRemoteTask(task),
  }));
}
export const taskController = {
  cancel: cancelTask,
  retry: retryTask,
  adoptRemote: adoptRemoteTask,
  clear: clearTasks,
};

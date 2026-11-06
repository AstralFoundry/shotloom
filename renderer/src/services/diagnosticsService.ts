/**
 * 诊断事件采集与诊断包导出。
 *
 * 事件落 localStorage（有界环形缓冲），任务与运行信息在导出时现取；
 * 诊断包的具体结构与体积策略在 `domain/diagnostics`，这里只做 IO 与适配。
 */

import { desktopApi } from '@/services/desktopApi';
import { settingsStore } from '@/store/settingsStore';
import { store } from '@/store/projectStore';
import { getLocale } from '@/i18n';
import { uid } from '@/utils/format';
import {
  appendDiagnosticEvent,
  type DiagnosticCategory,
  type DiagnosticEvent,
  type DiagnosticLevel,
} from '@/domain/diagnostics/DiagnosticsLog';
import { buildDiagnosticsBundle, type DiagnosticsBundle } from '@/domain/diagnostics/Bundle';
import { redactEventData } from '@/domain/diagnostics/Redaction';

type AnyRecord = Record<string, any>;

const STORAGE_KEY = 'shotloom:diagnostics:events:v1';

function readPersisted(): DiagnosticEvent[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event.at === 'number') : [];
  } catch {
    return [];
  }
}

function persist(events: DiagnosticEvent[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // 存储不可用（隐私模式/配额满）时保留内存视图，不阻断主流程。
  }
}

let events: DiagnosticEvent[] = readPersisted();

export function listDiagnosticEvents(): DiagnosticEvent[] {
  return events;
}

export function recordDiagnosticEvent(input: {
  level?: DiagnosticLevel;
  category: DiagnosticCategory;
  name: string;
  data?: Record<string, unknown>;
}) {
  const event: DiagnosticEvent = {
    id: uid(),
    at: Date.now(),
    level: input.level || 'info',
    category: input.category,
    name: String(input.name || '').slice(0, 200),
    ...(input.data ? { data: redactEventData(input.data) } : {}),
  };
  events = appendDiagnosticEvent(events, event);
  persist(events);
  return event;
}

export function clearDiagnosticEvents() {
  events = [];
  persist(events);
}

/** 模型配置只导出「有哪些厂商/模型」，不导出任何密钥或地址。 */
function modelConfigSummary() {
  const configs = (settingsStore.providerConfigs || {}) as Record<string, AnyRecord>;
  return {
    providers: Object.entries(configs).map(([provider, config]) => ({
      provider,
      configured: Boolean(String(config?.apiKey || '').trim()),
    })),
    defaultModels: {
      text: settingsStore.agentPreferredTextModel || '',
      image: settingsStore.agentPreferredImageModel || '',
      video: settingsStore.agentPreferredVideoModel || '',
    },
  };
}

function taskSummary(task: AnyRecord) {
  return {
    id: task.id,
    nodeId: task.nodeId,
    type: task.type,
    model: task.model,
    status: task.status,
    progress: task.progress,
    attempt: task.attempt,
    retryCount: task.retryCount,
    error: task.error ? String(task.error).slice(0, 400) : '',
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    submissionId: task.submissionId,
  };
}

function runtimeSummary() {
  return {
    platform: desktopApi.platform,
    locale: getLocale(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    desktop: Boolean(globalThis.window?.__TAURI_INTERNALS__),
    nodeCount: Array.isArray(store.project?.nodes) ? store.project.nodes.length : 0,
    edgeCount: Array.isArray(store.project?.edges) ? store.project.edges.length : 0,
    taskCount: Array.isArray(store.project?.tasks) ? store.project.tasks.length : 0,
  };
}

export function collectDiagnosticsBundle(now = Date.now()): DiagnosticsBundle {
  const tasks = (Array.isArray(store.project?.tasks) ? store.project.tasks : []).map(taskSummary);
  return buildDiagnosticsBundle({
    events,
    tasks,
    runtime: runtimeSummary(),
    modelConfig: modelConfigSummary(),
    project: store.project ? { id: store.project.id, name: store.project.name } : null,
  }, now);
}

export interface DiagnosticsPreview {
  eventCount: number;
  taskCount: number;
  bytes: number;
  truncated: boolean;
  coverage: DiagnosticsBundle['coverage'];
  files: string[];
}

/** 导出前给用户看数量与体积，避免「点了导出才知道很大」。 */
export function previewDiagnostics(): DiagnosticsPreview {
  const bundle = collectDiagnosticsBundle();
  return {
    eventCount: events.length,
    taskCount: (Array.isArray(store.project?.tasks) ? store.project.tasks : []).length,
    bytes: bundle.bytes,
    truncated: bundle.truncated,
    coverage: bundle.coverage,
    files: Object.keys(bundle.files),
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function exportDiagnosticsBundle(): Promise<{ ok: boolean; fileName?: string; error?: string }> {
  const bundle = collectDiagnosticsBundle();
  const build = desktopApi.diagnostics?.build;
  if (!build) return { ok: false, error: 'unsupported' };
  let base64: string;
  try {
    base64 = await build(bundle.files);
  } catch (error) {
    return { ok: false, error: (error as Error)?.message || 'build-failed' };
  }
  if (!base64) return { ok: false, error: 'empty' };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const fileName = `shotloom-diagnostics-${stamp}.zip`;
  const saved = await desktopApi.file.saveBinary?.(fileName, base64ToBytes(base64));
  return saved ? { ok: true, fileName: saved.fileName || fileName } : { ok: false, error: 'cancelled' };
}

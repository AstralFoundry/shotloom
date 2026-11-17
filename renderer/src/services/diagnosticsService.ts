/** 有界的本地诊断事件记录。 */
import { uid } from '@/utils/format';
import {
  appendDiagnosticEvent,
  type DiagnosticCategory,
  type DiagnosticEvent,
  type DiagnosticLevel,
} from '@/domain/diagnostics/DiagnosticsLog';
import { redactEventData } from '@/domain/diagnostics/Redaction';

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

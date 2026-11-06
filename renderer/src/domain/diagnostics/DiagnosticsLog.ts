/**
 * 诊断事件的环形缓冲规则。
 *
 * 诊断包必须在"够用"和"不失控"之间取平衡：只保留最近 24 小时、最多 500 条、
 * 不超过 512 KiB；超额时先淘汰 debug/info，错误记录尽可能留到最后。
 * 规则写成纯函数，便于测试与在任意运行环境复用。
 */

import { utf8ByteLength } from '@/utils/stableJson';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticCategory =
  | 'navigation'
  | 'action'
  | 'request'
  | 'runtime'
  | 'task'
  | 'plugin'
  | 'environment';

export interface DiagnosticEvent {
  id: string;
  /** epoch 毫秒，便于比较与按时间淘汰。 */
  at: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  name: string;
  data?: Record<string, unknown>;
}

export const DIAGNOSTIC_LIMITS = {
  ttlMs: 24 * 60 * 60 * 1000,
  maxEvents: 500,
  maxBytes: 512 * 1024,
} as const;

const LEVEL_PRIORITY: Record<DiagnosticLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function diagnosticEventBytes(event: DiagnosticEvent): number {
  return utf8ByteLength(JSON.stringify(event));
}

function totalBytes(events: DiagnosticEvent[]): number {
  return events.reduce((sum, event) => sum + diagnosticEventBytes(event), 0);
}

/**
 * 依次淘汰：先按过期时间，再按体积/条数。
 * 淘汰顺序 = 级别低者先（debug → info → warn → error），同级按时间最旧先。
 */
export function pruneDiagnosticEvents(events: DiagnosticEvent[], now: number): DiagnosticEvent[] {
  const fresh = events
    .filter((event) => Number.isFinite(event.at) && now - event.at <= DIAGNOSTIC_LIMITS.ttlMs)
    .sort((left, right) => left.at - right.at);

  const drop = (list: DiagnosticEvent[]): DiagnosticEvent[] => {
    let next = [...list];
    while (next.length > DIAGNOSTIC_LIMITS.maxEvents || totalBytes(next) > DIAGNOSTIC_LIMITS.maxBytes) {
      let victimIndex = -1;
      let victimPriority = Number.POSITIVE_INFINITY;
      for (let index = 0; index < next.length; index += 1) {
        const candidate = next[index];
        if (!candidate) continue;
        const priority = LEVEL_PRIORITY[candidate.level];
        if (priority < victimPriority) {
          victimPriority = priority;
          victimIndex = index;
          if (priority === 0) break;
        }
      }
      if (victimIndex < 0) break;
      next = next.filter((_, index) => index !== victimIndex);
    }
    return next;
  };

  return drop(fresh);
}

export function appendDiagnosticEvent(
  events: DiagnosticEvent[],
  event: DiagnosticEvent,
  now = event.at,
): DiagnosticEvent[] {
  return pruneDiagnosticEvents([...events, event], now);
}

/** 统计各分类数量，导出预览与覆盖度说明共用。 */
export function summarizeDiagnosticEvents(events: DiagnosticEvent[]) {
  const byLevel: Record<DiagnosticLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  const byCategory: Record<string, number> = {};
  for (const event of events) {
    byLevel[event.level] += 1;
    byCategory[event.category] = (byCategory[event.category] || 0) + 1;
  }
  return { total: events.length, byLevel, byCategory, bytes: totalBytes(events) };
}

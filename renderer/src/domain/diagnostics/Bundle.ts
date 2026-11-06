/**
 * 诊断包的结构与体积控制。
 *
 * 每个数据来源都声明覆盖度：完整、被截断、还是根本没采到。用户看到的
 * 「导出成功」不等于「信息齐全」，缺失必须如实写进 coverage.json，
 * 否则排障时会拿不完整的数据当完整数据用。
 */

import { utf8ByteLength } from '@/utils/stableJson';
import { redactEventData, redactText, redactValue } from './Redaction';
import type { DiagnosticEvent } from './DiagnosticsLog';

export const BUNDLE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxTasks: 200,
} as const;

export type CoverageStatus = 'complete' | 'truncated' | 'missing' | 'degraded';

export interface CoverageEntry {
  source: string;
  status: CoverageStatus;
  count: number;
  bytes: number;
  note?: string;
}

export interface DiagnosticsInput {
  events: DiagnosticEvent[];
  tasks: Record<string, unknown>[];
  runtime: Record<string, unknown>;
  modelConfig: Record<string, unknown>;
  project?: Record<string, unknown> | null;
}

export interface DiagnosticsBundle {
  files: Record<string, string>;
  coverage: CoverageEntry[];
  bytes: number;
  truncated: boolean;
}

const README = [
  'Shotloom 诊断包 / Shotloom diagnostics bundle',
  '',
  'README.txt            本说明',
  'manifest.json         包信息与各来源覆盖度摘要',
  'events.jsonl          应用内事件（已脱敏，按时间升序）',
  'tasks.jsonl           生成任务记录（已脱敏）',
  'runtime.json          运行环境',
  'models.json           模型配置摘要（不含密钥）',
  'coverage.json         每个数据来源的覆盖度',
  '',
  '已默认排除：提示词与请求体、API Key、Cookie、请求头、完整 URL 的查询串、本地绝对路径。',
  'Prompt and request bodies, API keys, cookies, headers, URL query strings and local paths are excluded.',
].join('\n');

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

function bytesOf(files: Record<string, string>): number {
  return Object.values(files).reduce((sum, text) => sum + utf8ByteLength(text), 0);
}

/** 构造导出内容；超过总量上限时优先裁剪事件与任务，并在覆盖度里标注。 */
export function buildDiagnosticsBundle(input: DiagnosticsInput, now = Date.now()): DiagnosticsBundle {
  const createdAt = new Date(now).toISOString();
  const events = input.events.map((event) => ({
    id: redactText(event.id, 64),
    at: new Date(event.at).toISOString(),
    level: event.level,
    category: event.category,
    name: redactText(event.name, 120),
    data: redactEventData(event.data),
  }));
  const taskSlice = input.tasks.slice(0, BUNDLE_LIMITS.maxTasks).map((task) => redactValue(task));
  const coverage: CoverageEntry[] = [
    { source: 'events', status: 'complete', count: events.length, bytes: 0 },
    {
      source: 'tasks',
      status: input.tasks.length > BUNDLE_LIMITS.maxTasks ? 'truncated' : 'complete',
      count: taskSlice.length,
      bytes: 0,
      ...(input.tasks.length > BUNDLE_LIMITS.maxTasks
        ? { note: `只保留最近 ${BUNDLE_LIMITS.maxTasks} 条任务` }
        : {}),
    },
    { source: 'runtime', status: 'complete', count: 1, bytes: 0 },
    { source: 'models', status: 'complete', count: 1, bytes: 0 },
    { source: 'project', status: input.project ? 'complete' : 'missing', count: input.project ? 1 : 0, bytes: 0 },
  ];

  const build = (): Record<string, string> => {
    const files: Record<string, string> = {
      'README.txt': README,
      'manifest.json': JSON.stringify({
        format: 'shotloom.diagnostics',
        formatVersion: 1,
        createdAt,
        coverage,
      }, null, 2),
      'events.jsonl': jsonl(events),
      'tasks.jsonl': jsonl(taskSlice),
      'runtime.json': JSON.stringify(redactValue(input.runtime), null, 2),
      'models.json': JSON.stringify(redactValue(input.modelConfig), null, 2),
      'coverage.json': JSON.stringify(coverage, null, 2),
    };
    for (const entry of coverage) {
      const name = entry.source === 'events' ? 'events.jsonl'
        : entry.source === 'tasks' ? 'tasks.jsonl'
          : entry.source === 'runtime' ? 'runtime.json'
            : entry.source === 'models' ? 'models.json' : 'manifest.json';
      entry.bytes = utf8ByteLength(files[name] || '');
    }
    return files;
  };

  let files = build();
  let truncated = coverage.some((entry) => entry.status === 'truncated');
  let total = bytesOf(files);

  // 极端情况下（任务记录含超长错误文本等）继续裁剪事件，再退到只保留元数据。
  while (total > BUNDLE_LIMITS.maxBytes) {
    if (events.length > 0) {
      events.splice(0, Math.max(1, Math.ceil(events.length / 2)));
      coverage.splice(0, 1, {
        source: 'events', status: 'truncated', count: events.length, bytes: coverage[0]?.bytes ?? 0, note: '体积超限，事件被裁剪',
      });
      truncated = true;
      files = build();
      total = bytesOf(files);
      continue;
    }
    if (taskSlice.length > 0) {
      taskSlice.splice(0, Math.max(1, Math.ceil(taskSlice.length / 2)));
      coverage.splice(1, 1, {
        source: 'tasks', status: 'truncated', count: taskSlice.length, bytes: coverage[1]?.bytes ?? 0, note: '体积超限，任务被裁剪',
      });
      truncated = true;
      files = build();
      total = bytesOf(files);
      continue;
    }
    // 仍超限：放弃体积最大的两个数据文件，只留说明与覆盖度。
    files['events.jsonl'] = '';
    files['tasks.jsonl'] = '';
    coverage.splice(0, 1, { source: 'events', status: 'missing', count: 0, bytes: 0, note: '体积超限，未包含事件' });
    coverage.splice(1, 1, { source: 'tasks', status: 'missing', count: 0, bytes: 0, note: '体积超限，未包含任务' });
    files = build();
    total = bytesOf(files);
    break;
  }

  return { files, coverage, bytes: total, truncated };
}

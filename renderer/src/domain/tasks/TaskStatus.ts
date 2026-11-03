import { t } from '../../i18n/index.ts';
/** Product task vocabulary; provider and plan statuses have separate contracts. */
export const TaskStatus = {
  Idle: 'idle', Queued: 'queued', Running: 'running', Completed: 'completed',
  Failed: 'failed', Timeout: 'timeout', Cancelled: 'cancelled', Error: 'error',
} as const;
export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

const active: ReadonlySet<unknown> = new Set([TaskStatus.Running, TaskStatus.Queued]);
const failed: ReadonlySet<string> = new Set([TaskStatus.Failed, TaskStatus.Timeout, TaskStatus.Error]);
const terminal: ReadonlySet<unknown> = new Set([...failed, TaskStatus.Cancelled, TaskStatus.Completed]);
// Existing retry policy also permits cancelled tasks. Keep that distinct from failure.
export const RETRYABLE_TASK_STATUSES: ReadonlySet<string> = new Set([...failed, TaskStatus.Cancelled]);
export function isActiveTaskStatus(value: unknown): boolean { return active.has(value); }
export function isFailedTaskStatus(value: unknown): boolean { return typeof value === 'string' && failed.has(value); }
export function isTerminalTaskStatus(value: unknown): boolean { return terminal.has(value); }

type DisplayStatus = TaskStatus | 'partial_failed' | 'stopped' | 'historical';
const presentation = {
  idle: { label: t("ui.StatusPill.idle.1a0db8dc"), tone: '' }, queued: { label: t("ui.StatusPill.queued.4dcbbcfa"), tone: 'info' },
  running: { label: t("ui.StatusPill.running.59424970"), tone: 'warn' }, completed: { label: t("ui.taskAdapter.label.e99b48a2"), tone: 'good' },
  failed: { label: t("ui.taskAdapter.label.3e3c8068"), tone: 'bad' }, timeout: { label: t("ui.StatusPill.timeout.ff06c243"), tone: 'bad' },
  cancelled: { label: t("ui.StatusPill.cancelled.a5ffdc95"), tone: 'muted' }, error: { label: t("ui.StatusPill.error.b859c7be"), tone: 'bad' },
  partial_failed: { label: t("ui.StatusPill.partialfailed.7912043e"), tone: 'warn' }, stopped: { label: t("ui.StatusPill.stopped.75dddf52"), tone: 'muted' },
  historical: { label: t("ui.StatusPill.historical.22a5c84f"), tone: 'muted' },
} satisfies Record<DisplayStatus, { label: string; tone: string }>;
function display(status: string) {
  return Object.hasOwn(presentation, status) ? presentation[status as DisplayStatus] : undefined;
}
export function statusLabel(status: string): string { return display(status)?.label ?? status; }
export function statusTone(status: string): string { return display(status)?.tone ?? ''; }

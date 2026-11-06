/**
 * 生成提交的幂等身份。
 *
 * 画布上一次「运行」会创建一条任务。网络抖动、双击、Agent 重放都可能让同一次
 * 提交变成两条任务，这里给每次提交一个稳定编号，并记录请求参数的指纹：
 *
 * - 同一编号 + 已有进行中的任务 → 复用原任务，不再提交；
 * - 同一编号 + 不同指纹 → 判定为误用，拒绝提交（避免用旧编号发出新内容）；
 * - 同一编号 + 已失败任务 + 相同指纹 → 允许重试，`attempt` 递增。
 *
 * 编号只承担本地身份与审计锚点；上游是否按编号去重取决于厂商是否支持。
 */

import { stableFingerprint } from '@/utils/stableJson';

export type SubmissionCandidate = {
  id?: string;
  status?: string;
  submissionId?: string;
  requestFingerprint?: string;
  attempt?: number;
};

export type SubmissionResolution =
  | { action: 'new' }
  | { action: 'reuse'; task: SubmissionCandidate }
  | { action: 'retry'; task: SubmissionCandidate; attempt: number }
  | { action: 'conflict'; task: SubmissionCandidate };

/** 提交编号对字符集与长度有硬约束，越界会让诊断与跨端对齐失去意义。 */
export const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const RETRYABLE_STATUSES = new Set(['failed', 'timeout', 'cancelled', 'error']);

/**
 * 把任意种子整理成合法提交编号。`uid()` 产生的 UUID 已经合法，直接沿用；
 * 其他来源去掉非法字符后兜底加前缀，保证长度落在 8–128。
 */
export function createSubmissionId(seed: string): string {
  const cleaned = String(seed ?? '').replace(/[^A-Za-z0-9:_-]/g, '');
  const base = cleaned || 'submission';
  const prefixed = base.length >= 8 ? base : `sub-${base}`;
  return prefixed.slice(0, 128).padEnd(8, '0');
}

/**
 * 参数指纹：只用于「同一编号是否对应同一份请求」的判断与诊断。
 */
export function submissionFingerprint(payload: unknown): string {
  return stableFingerprint(payload ?? {});
}

function latestAttempt(tasks: SubmissionCandidate[]): SubmissionCandidate {
  return [...tasks].sort((a, b) => Number(b.attempt || 0) - Number(a.attempt || 0))[0] as SubmissionCandidate;
}

/**
 * 判断一次提交应该新建、复用、重试还是拒绝。
 *
 * `fingerprint` 可省略：在参数尚未编译出来时（例如用户重复点击），只要存在进行中的
 * 同编号任务就足以复用；失败任务的重试判断必须带上指纹，否则无法发现「同编号换了内容」。
 */
export function resolveSubmission(
  tasks: readonly SubmissionCandidate[] | null | undefined,
  { submissionId, fingerprint }: { submissionId?: string; fingerprint?: string },
): SubmissionResolution {
  const id = String(submissionId || '').trim();
  if (!id) return { action: 'new' };
  const matches = (tasks || []).filter((task) => task && task.submissionId === id);
  if (!matches.length) return { action: 'new' };

  const active = matches.find((task) => ACTIVE_STATUSES.has(String(task.status || '')));
  if (active) return { action: 'reuse', task: active };

  if (!fingerprint) return { action: 'new' };

  const conflicting = matches.find((task) => task.requestFingerprint && task.requestFingerprint !== fingerprint);
  if (conflicting) return { action: 'conflict', task: conflicting };

  const latest = latestAttempt(matches);
  if (latest.status === 'completed') return { action: 'reuse', task: latest };
  if (RETRYABLE_STATUSES.has(String(latest.status || '')) || latest.status === undefined) {
    return { action: 'retry', task: latest, attempt: Number(latest.attempt || 0) + 1 };
  }
  return { action: 'retry', task: latest, attempt: Number(latest.attempt || 0) + 1 };
}

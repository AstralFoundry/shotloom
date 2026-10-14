/**
 * 运行进展的唯一客观定义：事件出口还在不在动。
 *
 * 语义上有没有进展由模型自己负责，代码不做判断；这里只在长时间没有任何事件时
 * 通知界面"可以继续等，也可以停止"，并且把恢复也报出去，避免提示永久挂着。
 */
const TICK_MS = 10_000;
const WARNING_MS = 180_000;
const HARD_CAP_MS = 1_800_000;
const NOTICE_COOLDOWN_MS = 120_000;
const HARD_CAP_NOTICE_COOLDOWN_MS = 300_000;

export interface StallWatchdog {
  activity(): void;
  start(): void;
  stop(): void;
}

export function createStallWatchdog(handlers: {
  stalled: (silent: { silentMs: number; watchdog: 'no_progress' | 'hard_cap' }) => void;
  recovered: () => void;
}): StallWatchdog {
  let progressAt = Date.now();
  let reportedAt = 0;
  let interval: ReturnType<typeof setInterval> | 0 = 0;

  return {
    activity() {
      progressAt = Date.now();
      if (!reportedAt) return;
      reportedAt = 0;
      handlers.recovered();
    },
    start() {
      progressAt = Date.now();
      interval = setInterval(() => {
        const now = Date.now();
        const silentMs = now - progressAt;
        if (silentMs < WARNING_MS) return;
        const watchdog = silentMs >= HARD_CAP_MS ? 'hard_cap' : 'no_progress';
        const cooldown = watchdog === 'hard_cap' ? HARD_CAP_NOTICE_COOLDOWN_MS : NOTICE_COOLDOWN_MS;
        if (reportedAt && now - reportedAt < cooldown) return;
        reportedAt = now;
        handlers.stalled({ silentMs, watchdog });
      }, TICK_MS);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = 0;
      reportedAt = 0;
    },
  };
}

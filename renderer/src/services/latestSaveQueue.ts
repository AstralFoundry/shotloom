// 保存队列只搬运调用方给它的快照对象，快照结构对队列不透明，按 AnyRecord 进出。
type AnyRecord = Record<string, any>;

interface SaveWaiter {
  resolve: (result: AnyRecord) => void;
  reject: (error: unknown) => void;
}

interface SaveItem {
  value: AnyRecord;
  key: string;
  scope: string;
  sequence: number;
  requestedAt: number;
  retryAttempt: number;
  waiters: SaveWaiter[];
}

export class LatestSaveQueue {
  save: (value: AnyRecord, meta: { sequence: number; scope: string }) => AnyRecord;
  maxRetryAttempts: number;
  onMetric: (detail: AnyRecord) => void;

  sequence = 0;
  inFlight: SaveItem | null = null;
  pendingLatest: SaveItem | null = null;
  parallelInFlight = 0;
  lastSavedKey = '';
  lastSuccessfulSequence = 0;
  idleWaiters: Array<() => void> = [];

  constructor(
    save: (value: AnyRecord, meta: { sequence: number; scope: string }) => AnyRecord,
    options: { maxRetryAttempts?: number; onMetric?: (detail: AnyRecord) => void } = {},
  ) {
    this.save = save;
    this.maxRetryAttempts = options.maxRetryAttempts ?? 1;
    this.onMetric = options.onMetric || (() => {});
  }

  enqueue(value: AnyRecord, options: { key?: string; scope?: string } = {}): Promise<AnyRecord> {
    const key = String(options.key || '');
    const scope = String(options.scope || '');
    const requestedAt = performance.now();
    const item: SaveItem = {
      value,
      key,
      scope,
      sequence: ++this.sequence,
      requestedAt,
      retryAttempt: 0,
      waiters: [],
    };
    if (key && key === this.lastSavedKey && !this.inFlight && !this.pendingLatest) {
      this.metric(item, 'duplicate');
      return Promise.resolve({ skipped: true, sequence: item.sequence });
    }
    const duplicate = [this.inFlight, this.pendingLatest]
      .find((candidate) => candidate?.key && candidate.key === key && candidate.scope === scope);
    if (duplicate) {
      this.metric(item, 'duplicate-queued');
      return new Promise((resolve, reject) => duplicate.waiters.push({ resolve, reject }));
    }
    const promise = new Promise<AnyRecord>((resolve, reject) => item.waiters.push({ resolve, reject }));
    if (this.inFlight) {
      if (this.pendingLatest) item.waiters.unshift(...this.pendingLatest.waiters.splice(0));
      this.pendingLatest = item;
      this.metric(item, 'queued-latest');
    } else {
      this.start(item);
    }
    return promise;
  }

  waitForIdle(): Promise<void> {
    if (!this.inFlight && !this.pendingLatest && !this.parallelInFlight) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  flushPendingNow(): AnyRecord | null {
    if (!this.pendingLatest) return null;
    if (this.inFlight) return this.pendingLatest.value;
    const item = this.pendingLatest;
    this.pendingLatest = null;
    this.start(item);
    return item.value;
  }

  discardPending(reason: unknown = new Error('Save queue was discarded')) {
    const pending = this.pendingLatest;
    this.pendingLatest = null;
    if (pending) this.reject(pending, reason);
    this.resolveIdleIfNeeded();
  }

  diagnostics(): AnyRecord {
    return {
      sequence: this.sequence,
      lastSuccessfulSequence: this.lastSuccessfulSequence,
      inFlight: this.inFlight ? 1 : 0,
      pending: this.pendingLatest ? 1 : 0,
      parallelInFlight: this.parallelInFlight,
    };
  }

  start(item: SaveItem, parallel = false) {
    if (parallel) this.parallelInFlight += 1;
    else this.inFlight = item;
    this.metric(item, parallel ? 'flush' : 'start');
    const saveStartedAt = performance.now();
    let retryScheduled = false;
    Promise.resolve(this.save(item.value, { sequence: item.sequence, scope: item.scope }))
      .then((result) => {
        if (item.sequence >= this.lastSuccessfulSequence) this.lastSavedKey = item.key;
        this.lastSuccessfulSequence = Math.max(this.lastSuccessfulSequence, item.sequence);
        this.metric(item, 'saved', { saveMs: performance.now() - saveStartedAt });
        this.resolve(item, { ...result, sequence: item.sequence });
      })
      .catch((error) => {
        this.metric(item, 'failed', {
          saveMs: performance.now() - saveStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!parallel && item.retryAttempt < this.maxRetryAttempts && !this.pendingLatest) {
          item.retryAttempt += 1;
          retryScheduled = true;
          return;
        }
        this.reject(item, error);
      })
      .finally(() => {
        if (parallel) {
          this.parallelInFlight = Math.max(0, this.parallelInFlight - 1);
          this.resolveIdleIfNeeded();
          return;
        }
        if (this.inFlight !== item) return;
        this.inFlight = null;
        if (retryScheduled) {
          queueMicrotask(() => {
            const newer = this.pendingLatest;
            this.pendingLatest = null;
            if (newer) {
              newer.waiters.unshift(...item.waiters.splice(0));
              this.start(newer);
            } else {
              this.start(item);
            }
          });
          return;
        }
        const next = this.pendingLatest;
        this.pendingLatest = null;
        if (next) this.start(next);
        else this.resolveIdleIfNeeded();
      });
  }

  resolve(item: SaveItem, result: AnyRecord) {
    for (const waiter of item.waiters.splice(0)) waiter.resolve(result);
  }

  reject(item: SaveItem, error: unknown) {
    for (const waiter of item.waiters.splice(0)) waiter.reject(error);
  }

  resolveIdleIfNeeded() {
    if (this.inFlight || this.pendingLatest || this.parallelInFlight) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  metric(item: SaveItem, event: string, detail: AnyRecord = {}) {
    this.onMetric({
      event,
      sequence: item.sequence,
      scope: item.scope,
      retryAttempt: item.retryAttempt,
      queueMs: performance.now() - item.requestedAt,
      depth: Number(Boolean(this.inFlight)) + Number(Boolean(this.pendingLatest)),
      ...detail,
    });
  }
}

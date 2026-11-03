import { t } from '../i18n/index.ts';

export type MediaCacheKind = 'image' | 'video' | 'audio';

/** 调用方提供的读取结果：只有 buffer 是必需的，mime 与 costBytes 用于命名与预算记账。 */
export interface LoadedMediaBuffer {
  buffer?: ArrayBuffer;
  mime?: string;
  costBytes?: number;
}

export interface MediaCacheEntry {
  key: string;
  kind: MediaCacheKind;
  url: string;
  bytes: number;
  sourceBytes: number;
  refs: number;
  lastUsed: number;
  createdAt: number;
}

export interface MediaCacheLease {
  key: string;
  kind: MediaCacheKind;
  url: string;
  bytes: number;
  sourceBytes: number;
  release: () => void;
}

export interface MediaCacheAcquireOptions {
  kind: MediaCacheKind;
  maxEntryBytes?: number;
  load: () => Promise<LoadedMediaBuffer>;
}

export interface BoundedMediaCacheOptions {
  kindBudgets?: Partial<Record<MediaCacheKind, number>>;
  totalBudget?: number;
  maxEntries?: number;
  maxEntryBytes?: number;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}

const MIB = 1024 * 1024;

const DEFAULT_KIND_BUDGETS: Record<MediaCacheKind, number> = {
  image: 128 * MIB,
  video: 192 * MIB,
  audio: 64 * MIB,
};

export class BoundedMediaCache {
  kindBudgets: Record<MediaCacheKind, number>;
  totalBudget: number;
  maxEntries: number;
  maxEntryBytes: number;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  entries: Map<string, MediaCacheEntry>;
  pending: Map<string, Promise<MediaCacheEntry>>;
  clock: number;
  loaded: number;
  hits: number;
  misses: number;
  evictions: number;
  rejectedOversize: number;

  constructor(options: BoundedMediaCacheOptions = {}) {
    this.kindBudgets = { ...DEFAULT_KIND_BUDGETS, ...(options.kindBudgets || {}) };
    this.totalBudget = options.totalBudget ?? 256 * MIB;
    this.maxEntries = options.maxEntries ?? 512;
    this.maxEntryBytes = options.maxEntryBytes ?? 128 * MIB;
    this.createUrl = options.createUrl || ((blob) => URL.createObjectURL(blob));
    this.revokeUrl = options.revokeUrl || ((url) => URL.revokeObjectURL(url));
    this.entries = new Map();
    this.pending = new Map();
    this.clock = 0;
    this.loaded = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.rejectedOversize = 0;
  }

  async acquire(key: unknown, options: MediaCacheAcquireOptions): Promise<MediaCacheLease> {
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new Error(t('media.cache.keyRequired'));
    const existing = this.entries.get(normalizedKey);
    if (existing) {
      this.hits += 1;
      return this.lease(existing);
    }
    let load = this.pending.get(normalizedKey);
    if (!load) {
      this.misses += 1;
      load = this.loadEntry(normalizedKey, options);
      this.pending.set(normalizedKey, load);
      load.finally(() => {
        if (this.pending.get(normalizedKey) === load) this.pending.delete(normalizedKey);
      }).catch(() => {});
    } else {
      this.hits += 1;
    }
    const entry = await load;
    return this.lease(entry);
  }

  async loadEntry(key: string, options: MediaCacheAcquireOptions): Promise<MediaCacheEntry> {
    const loaded = await options.load();
    const buffer = loaded?.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error(t('media.cache.empty'));
    }
    const limit = options.maxEntryBytes ?? this.maxEntryBytes;
    const costBytes = Math.max(buffer.byteLength, Number(loaded.costBytes) || 0);
    if (costBytes > limit) {
      this.rejectedOversize += 1;
      throw new Error(t('media.cache.overBudget', { bytes: costBytes, limit }));
    }
    const kind = options.kind;
    const blob = new Blob([buffer], { type: loaded.mime || `${kind}/*` });
    const entry: MediaCacheEntry = {
      key,
      kind,
      url: this.createUrl(blob),
      bytes: costBytes,
      sourceBytes: buffer.byteLength,
      refs: 0,
      lastUsed: ++this.clock,
      createdAt: Date.now(),
    };
    const stale = this.entries.get(key);
    if (stale && stale.refs === 0) this.remove(stale);
    this.entries.set(key, entry);
    this.loaded += 1;
    return entry;
  }

  lease(entry: MediaCacheEntry): MediaCacheLease {
    if (this.entries.get(entry.key) !== entry) {
      throw new Error(t('media.cache.expired'));
    }
    entry.refs += 1;
    entry.lastUsed = ++this.clock;
    this.evictToBudget(1);
    let released = false;
    return {
      key: entry.key,
      kind: entry.kind,
      url: entry.url,
      bytes: entry.bytes,
      sourceBytes: entry.sourceBytes,
      release: () => {
        if (released) return;
        released = true;
        if (this.entries.get(entry.key) !== entry) return;
        entry.refs = Math.max(0, entry.refs - 1);
        entry.lastUsed = ++this.clock;
        this.evictToBudget(1);
      },
    };
  }

  invalidate(key: unknown): boolean {
    const entry = this.entries.get(String(key || ""));
    if (!entry || entry.refs > 0) return false;
    this.remove(entry);
    return true;
  }

  relieve(level: 'low' | 'critical' = "low") {
    if (level === "critical") {
      for (const entry of [...this.entries.values()]) {
        if (entry.refs === 0) this.remove(entry);
      }
    } else {
      this.evictToBudget(0.5);
    }
    return this.diagnostics();
  }

  clear({ force = false }: { force?: boolean } = {}) {
    for (const entry of [...this.entries.values()]) {
      if (force || entry.refs === 0) this.remove(entry);
    }
  }

  evictToBudget(multiplier: number) {
    const targetTotal = this.totalBudget * multiplier;
    const targetEntries = Math.max(1, Math.floor(this.maxEntries * multiplier));
    while (true) {
      const totals = this.totals();
      const overKind = (Object.entries(this.kindBudgets) as Array<[MediaCacheKind, number]>).find(
        ([kind, budget]) => (totals.byKind[kind] || 0) > budget * multiplier,
      )?.[0];
      const over = totals.total > targetTotal || this.entries.size > targetEntries || overKind;
      if (!over) return;
      const candidates = [...this.entries.values()]
        .filter((entry) => entry.refs === 0 && (!overKind || entry.kind === overKind))
        .sort((left, right) => left.lastUsed - right.lastUsed);
      const candidate = candidates[0] || [...this.entries.values()]
        .filter((entry) => entry.refs === 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) return;
      this.remove(candidate);
    }
  }

  remove(entry: MediaCacheEntry) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.evictions += 1;
    try {
      this.revokeUrl(entry.url);
    } catch {}
  }

  totals() {
    const byKind: Record<MediaCacheKind, number> = { image: 0, video: 0, audio: 0 };
    let total = 0;
    let sourceBytes = 0;
    let pinned = 0;
    for (const entry of this.entries.values()) {
      total += entry.bytes;
      sourceBytes += entry.sourceBytes;
      byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
      if (entry.refs > 0) pinned += entry.bytes;
    }
    return { total, sourceBytes, pinned, byKind };
  }

  diagnostics() {
    const totals = this.totals();
    return {
      entries: this.entries.size,
      pending: this.pending.size,
      bytes: totals.total,
      sourceBytes: totals.sourceBytes,
      pinnedBytes: totals.pinned,
      bytesByKind: totals.byKind,
      budgets: { total: this.totalBudget, ...this.kindBudgets },
      loaded: this.loaded,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      rejectedOversize: this.rejectedOversize,
      overBudget: totals.total > this.totalBudget || (Object.entries(this.kindBudgets) as Array<[MediaCacheKind, number]>)
        .some(([kind, budget]) => (totals.byKind[kind] || 0) > budget),
    };
  }
}

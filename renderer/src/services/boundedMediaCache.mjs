const MIB = 1024 * 1024;

const DEFAULT_KIND_BUDGETS = {
  image: 128 * MIB,
  video: 192 * MIB,
  audio: 64 * MIB,
};

export class BoundedMediaCache {
  constructor(options = {}) {
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

  async acquire(key, options) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new Error("Media cache key is required");
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

  async loadEntry(key, options) {
    const loaded = await options.load();
    const buffer = loaded?.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      throw new Error("Media preview is empty");
    }
    const limit = options.maxEntryBytes ?? this.maxEntryBytes;
    const costBytes = Math.max(buffer.byteLength, Number(loaded.costBytes) || 0);
    if (costBytes > limit) {
      this.rejectedOversize += 1;
      throw new Error(`Media preview exceeds cache entry budget (${costBytes}/${limit})`);
    }
    const kind = options.kind;
    const blob = new Blob([buffer], { type: loaded.mime || `${kind}/*` });
    const entry = {
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

  lease(entry) {
    if (this.entries.get(entry.key) !== entry) {
      throw new Error("Media cache entry expired before acquisition");
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

  invalidate(key) {
    const entry = this.entries.get(String(key || ""));
    if (!entry || entry.refs > 0) return false;
    this.remove(entry);
    return true;
  }

  relieve(level = "low") {
    if (level === "critical") {
      for (const entry of [...this.entries.values()]) {
        if (entry.refs === 0) this.remove(entry);
      }
    } else {
      this.evictToBudget(0.5);
    }
    return this.diagnostics();
  }

  clear({ force = false } = {}) {
    for (const entry of [...this.entries.values()]) {
      if (force || entry.refs === 0) this.remove(entry);
    }
  }

  evictToBudget(multiplier) {
    const targetTotal = this.totalBudget * multiplier;
    const targetEntries = Math.max(1, Math.floor(this.maxEntries * multiplier));
    while (true) {
      const totals = this.totals();
      const overKind = Object.entries(this.kindBudgets).find(
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

  remove(entry) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    this.evictions += 1;
    try {
      this.revokeUrl(entry.url);
    } catch {}
  }

  totals() {
    const byKind = { image: 0, video: 0, audio: 0 };
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
      overBudget: totals.total > this.totalBudget || Object.entries(this.kindBudgets)
        .some(([kind, budget]) => (totals.byKind[kind] || 0) > budget),
    };
  }
}

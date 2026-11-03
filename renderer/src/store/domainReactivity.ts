/** Framework-neutral mutable domain state with coalesced external subscriptions. */
const proxyByTarget = new WeakMap<object, unknown>();
const targetByProxy = new WeakMap<object, object>();
const listeners = new Set<() => void>();
let revision = 0;
let notifyQueued = false;

function isProxyable(value: unknown): value is Record<string, unknown> | unknown[] {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

function changed() {
  revision += 1;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of [...listeners]) listener();
  });
}

export function reactive<T>(value: T): T {
  if (!isProxyable(value)) return value;
  if (targetByProxy.has(value as unknown as object)) return value;
  const cached = proxyByTarget.get(value as unknown as object);
  if (cached) return cached as T;
  // Proxy 的 get 陷阱会递归包装子对象；包装后的子值与原类型结构一致，
  // 因此对外保持 T 的签名，只在代理句柄这一处边界做断言。
  const proxy = new Proxy(value as unknown as object, {
    get(target, key, receiver) {
      return reactive(Reflect.get(target, key, receiver));
    },
    set(target, key, next, receiver) {
      const rawNext = toRaw(next);
      const previous = Reflect.get(target, key, receiver);
      const result = Reflect.set(target, key, rawNext, receiver);
      if (result && !Object.is(previous, rawNext)) changed();
      return result;
    },
    deleteProperty(target, key) {
      const existed = Object.prototype.hasOwnProperty.call(target, key);
      const result = Reflect.deleteProperty(target, key);
      if (result && existed) changed();
      return result;
    },
  }) as unknown as T;
  proxyByTarget.set(value as unknown as object, proxy);
  targetByProxy.set(proxy as unknown as object, value as unknown as object);
  return proxy;
}

export function computed<T>(getter: () => T): { readonly value: T } {
  return Object.freeze({ get value() { return getter(); } });
}

export function toRaw<T>(value: T): T {
  return (targetByProxy.get(value as unknown as object) as T | undefined) || value;
}

export function subscribeDomain(listener: () => void): () => boolean {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDomainRevision(): number {
  return revision;
}

/** Framework-neutral mutable domain state with coalesced external subscriptions. */
const proxyByTarget = new WeakMap();
const targetByProxy = new WeakMap();
const listeners = new Set();
let revision = 0;
let notifyQueued = false;

function isProxyable(value) {
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

export function reactive(value) {
  if (!isProxyable(value)) return value;
  if (targetByProxy.has(value)) return value;
  const cached = proxyByTarget.get(value);
  if (cached) return cached;
  const proxy = new Proxy(value, {
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
  });
  proxyByTarget.set(value, proxy);
  targetByProxy.set(proxy, value);
  return proxy;
}

export function computed(getter) {
  return Object.freeze({ get value() { return getter(); } });
}

export function toRaw(value) {
  return targetByProxy.get(value) || value;
}

export function subscribeDomain(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDomainRevision() {
  return revision;
}

/** Session-local browser facade. Never changes the host document or prototypes. */
export function createEmbeddedEnvironment(realWindow: Window & typeof globalThis, root: HTMLElement, persistenceKey = "openreel") {
  const owner = root.ownerDocument;
  const shadow = root.getRootNode() as ShadowRoot;
  const listeners = new Set<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }>();
  const resizeCallbacks = new Set<EventListenerOrEventListenerObject>();
  const values = new Map<string, string>();
  const properties = new Map<PropertyKey, unknown>();
  const addedFonts = new Set<FontFace>();
  const timeouts = new Set<number>(), intervals = new Set<number>(), frames = new Set<number>();
  const objectURLs = new Set<string>();
  const scopedURL = new Proxy(realWindow.URL, { get(target, key) {
    if (key === "createObjectURL") return (blob: Blob | MediaSource) => { const url = target.createObjectURL(blob); objectURLs.add(url); return url; };
    if (key === "revokeObjectURL") return (url: string) => { objectURLs.delete(url); target.revokeObjectURL(url); };
    return Reflect.get(target, key, target);
  } });
  const storage = {
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, String(value)); },
    removeItem(key: string) { values.delete(key); }, clear() { values.clear(); },
  } as Storage;
  const globalEvents = new Set(["mousemove", "mouseup", "pointermove", "pointerup", "pointercancel", "touchmove", "touchend", "touchcancel", "visibilitychange", "pagehide", "beforeunload", "online", "offline", "error", "unhandledrejection"]);
  const eventTarget = (type: string, isDocument: boolean): EventTarget => globalEvents.has(type) ? isDocument ? owner : realWindow : root;
  const stopKeyboard = (event: Event) => event.stopPropagation();
  for (const type of ["keydown", "keyup", "keypress"]) root.addEventListener(type, stopKeyboard);
  const fonts = owner.fonts && new Proxy(owner.fonts, {
    get(target, key) {
      if (key === "add") return (font: FontFace) => { if (!target.has(font)) addedFonts.add(font); target.add(font); return fonts; };
      if (key === "delete") return (font: FontFace) => addedFonts.delete(font) && target.delete(font);
      if (key === "clear") return () => { for (const font of addedFonts) target.delete(font); addedFonts.clear(); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const add = (isDocument: boolean) => (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    if (!listener) return;
    if (type === "resize") { resizeCallbacks.add(listener); return; }
    const target = eventTarget(type, isDocument); target.addEventListener(type, listener, options); listeners.add({ target, type, listener, options });
  };
  const remove = (isDocument: boolean) => (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
    if (!listener) return;
    if (type === "resize") { resizeCallbacks.delete(listener); return; }
    const target = eventTarget(type, isDocument); target.removeEventListener(type, listener, options);
    for (const entry of listeners) if (entry.target === target && entry.type === type && entry.listener === listener) listeners.delete(entry);
  };
  const query = <T extends Element = Element>(selector: string): T | null => {
    if (selector === "body" || selector === "html" || selector === ":root") return root as unknown as T;
    if (selector === "#root") return root.querySelector<T>("[data-editor-react-root]") ?? root as unknown as T;
    return root.matches(selector) ? root as unknown as T : root.querySelector<T>(selector);
  };
  const scope = (value: Element | null): Element | null => value && (value === root || root.contains(value)) ? value : null;
  const scopedDocument = new Proxy(owner, {
    get(target, key) {
      if (key === "body" || key === "documentElement" || key === "head" || key === "scrollingElement") return root;
      if (key === "fonts") return fonts;
      if (key === "defaultView") return scopedWindow;
      if (key === "activeElement") return scope(shadow.activeElement) ?? root;
      if (key === "fullscreenElement") return scope(shadow.fullscreenElement);
      if (key === "querySelector") return query;
      if (key === "querySelectorAll") return (selector: string) => root.querySelectorAll(selector);
      if (key === "getElementById") return (id: string) => query(`#${realWindow.CSS.escape(id)}`);
      if (key === "getElementsByClassName") return (name: string) => root.getElementsByClassName(name);
      if (key === "getElementsByTagName") return (name: string) => root.getElementsByTagName(name);
      if (key === "elementFromPoint") return (x: number, y: number) => scope(shadow.elementFromPoint?.(root.getBoundingClientRect().left + x * (root.getBoundingClientRect().width / (root.clientWidth || 1)), root.getBoundingClientRect().top + y * (root.getBoundingClientRect().height / (root.clientHeight || 1))) ?? null);
      if (key === "elementsFromPoint") return (x: number, y: number) => (shadow.elementsFromPoint?.(root.getBoundingClientRect().left + x * (root.getBoundingClientRect().width / (root.clientWidth || 1)), root.getBoundingClientRect().top + y * (root.getBoundingClientRect().height / (root.clientHeight || 1))) ?? []).filter(value => scope(value));
      if (key === "dispatchEvent") return (event: Event) => eventTarget(event.type, true).dispatchEvent(event);
      if (key === "addEventListener") return add(true);
      if (key === "removeEventListener") return remove(true);
      if (key === "title") return root.dataset.editorTitle ?? "OpenReel";
      if (properties.has(key)) return properties.get(key);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, key, value) { if (key === "title") root.dataset.editorTitle = String(value); else properties.set(key, value); return true; },
  });
  const localProperties = new Map<PropertyKey, unknown>();
  const location = { href: `${realWindow.location.origin}/openreel/?shotloom=1#/editor`, origin: realWindow.location.origin, search: "?shotloom=1", hash: "#/editor", pathname: "/openreel/" };
  const scopedWindow = new Proxy(realWindow, {
    get(target, key) {
      if (key === "document") return scopedDocument;
      if (key === "URL") return scopedURL;
      if (key === "window" || key === "self" || key === "globalThis" || key === "parent" || key === "top") return scopedWindow;
      if (key === "innerWidth") return root.clientWidth;
      if (key === "innerHeight") return root.clientHeight;
      if (key === "localStorage" || key === "sessionStorage") return storage;
      if (key === "dispatchEvent") return (event: Event) => eventTarget(event.type, false).dispatchEvent(event);
      if (key === "addEventListener") return add(false);
      if (key === "removeEventListener") return remove(false);
      if (key === "location") return location;
      if (key === "setTimeout") return (callback: TimerHandler, delay?: number, ...args: unknown[]) => { const id=realWindow.setTimeout(typeof callback === "function" ? () => { timeouts.delete(id); callback(...args); } : callback, delay); timeouts.add(id); return id; };
      if (key === "clearTimeout") return (id: number) => { timeouts.delete(id); realWindow.clearTimeout(id); };
      if (key === "setInterval") return (callback: TimerHandler, delay?: number, ...args: unknown[]) => { const id=realWindow.setInterval(callback, delay, ...args); intervals.add(id); return id; };
      if (key === "clearInterval") return (id: number) => { intervals.delete(id); realWindow.clearInterval(id); };
      if (key === "requestAnimationFrame") return (callback: FrameRequestCallback) => { const id=realWindow.requestAnimationFrame(time => { frames.delete(id); callback(time); }); frames.add(id); return id; };
      if (key === "cancelAnimationFrame") return (id: number) => { frames.delete(id); realWindow.cancelAnimationFrame(id); };
      if (localProperties.has(key)) return localProperties.get(key);
      const value=Reflect.get(target,key,target); return typeof value === "function" && !("prototype" in value) ? value.bind(target) : value;
    },
    set(_target,key,value) { localProperties.set(key,value);return true; },
  });
  const resizeObserver = new realWindow.ResizeObserver(() => {
    const event = new realWindow.Event("resize");
    for (const listener of resizeCallbacks) { if (typeof listener === "function") listener.call(root,event); else listener.handleEvent(event); }
  });
  resizeObserver.observe(root);
  return { window:scopedWindow, document:scopedDocument, localStorage:storage, sessionStorage:storage, persistenceKey,
    dispose() {
      resizeObserver.disconnect();
      for (const id of timeouts) realWindow.clearTimeout(id); for (const id of intervals) realWindow.clearInterval(id); for (const id of frames) realWindow.cancelAnimationFrame(id);
      timeouts.clear();intervals.clear();frames.clear();
      for (const url of objectURLs) realWindow.URL.revokeObjectURL(url); objectURLs.clear();
      for (const type of ["keydown","keyup","keypress"]) root.removeEventListener(type,stopKeyboard);
      for (const font of addedFonts) owner.fonts.delete(font);addedFonts.clear();properties.clear();resizeCallbacks.clear();
      for (const entry of listeners) entry.target.removeEventListener(entry.type,entry.listener,entry.options);
      listeners.clear();localProperties.clear();values.clear();
    },
  };
}

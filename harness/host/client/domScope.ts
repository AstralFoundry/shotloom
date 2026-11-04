// A document-shaped DOM adapter keeps upstream portals and styles inside the
// Harness surface. It owns no product or Harness domain state.
const surfaces = new Set<ShadowRoot>();
const mirrors = new Map<ShadowRoot, Map<HTMLStyleElement, HTMLStyleElement>>();
let overlays: HTMLElement | undefined;
function syncStyles() {
  if (!overlays) return;
  const sources = [...overlays.querySelectorAll<HTMLStyleElement>('style[data-plugin]')];
  for (const source of sources) {
    // Upstream document theme selectors become the ShadowRoot's host selectors.
    const css = source.textContent!.replaceAll(':root', ':host').replace(/\b(?:body|html)(?=[\s[.:{>])/g, ':host');
    if (source.textContent !== css) source.textContent = css;
  }
  for (const root of surfaces) {
    if (root.contains(overlays)) continue;
    let copies = mirrors.get(root);
    if (!copies) mirrors.set(root, copies = new Map());
    const anchor = [...root.children].find(node => ![...copies!.values()].includes(node as HTMLStyleElement)) ?? null;
    for (const source of sources) {
      let copy = copies.get(source);
      if (!copy) { copy = source.cloneNode(true) as HTMLStyleElement; copies.set(source, copy); root.insertBefore(copy, anchor); }
      if (copy.textContent !== source.textContent) copy.textContent = source.textContent;
    }
    for (const [source, copy] of copies) if (!sources.includes(source)) { copy.remove(); copies.delete(source); }
  }
}
function syncTheme(root: ShadowRoot) {
  if (!overlays) return;
  const host = root.host as HTMLElement;
  host.style.colorScheme = overlays.style.colorScheme;
  host.toggleAttribute('data-ds-dark-theme', overlays.hasAttribute('data-ds-dark-theme'));
  for (const name of overlays.style) if (name.startsWith('--')) host.style.setProperty(name, overlays.style.getPropertyValue(name));
}
export function registerSurface(root: ShadowRoot) {
  surfaces.add(root); syncTheme(root); syncStyles();
  return () => { surfaces.delete(root); for (const copy of mirrors.get(root)?.values() ?? []) copy.remove(); mirrors.delete(root); };
}
export function setOverlayRoot(root: HTMLElement) {
  overlays = root;
  const theme = new MutationObserver(() => { for (const surface of surfaces) syncTheme(surface); });
  theme.observe(root, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] });
  const styles = new MutationObserver(syncStyles);
  styles.observe(root, { childList: true, subtree: true, characterData: true });
  return () => { theme.disconnect(); styles.disconnect(); if (overlays === root) overlays = undefined; };
}
/** Document listeners see the original shadow target; keyboard commands stay
 * within Harness while outside pointer events can still dismiss its popovers. */
export function scopedEvents(target: EventTarget) {
  const listeners = new WeakMap<EventListenerOrEventListenerObject, Map<string, EventListener>>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (!listener) return;
      const key = `${type}:${typeof options === 'boolean' ? options : options?.capture ?? false}`;
      let entries = listeners.get(listener);
      if (!entries) listeners.set(listener, entries = new Map());
      let wrapped = entries.get(key);
      if (!wrapped) {
        wrapped = event => {
          const path = event.composedPath();
          if (/^(key|composition|beforeinput|input)/.test(type) && !path.some(node => [...surfaces].some(root => node === root || node === root.host))) return;
          const scoped = new Proxy(event, { get(object, prop) {
            if (prop === 'target') return path[0] ?? object.target;
            const value = Reflect.get(object, prop, object);
            return typeof value === 'function' ? value.bind(object) : value;
          } });
          if (typeof listener === 'function') listener.call(target, scoped); else listener.handleEvent(scoped);
        };
        entries.set(key, wrapped);
      }
      target.addEventListener(type, wrapped, options);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      if (!listener) return;
      const key = `${type}:${typeof options === 'boolean' ? options : options?.capture ?? false}`;
      const entries = listeners.get(listener);
      const wrapped = entries?.get(key);
      if (wrapped) { target.removeEventListener(type, wrapped, options); entries?.delete(key); }
    },
  };
}
const documentEvents = scopedEvents(globalThis.document);
export const scopedDocument = new Proxy(globalThis.document, {
  get(target, key) {
    if (key === 'addEventListener' || key === 'removeEventListener') return documentEvents[key];
    if (key === 'body' || key === 'documentElement' || key === 'head') return overlays ?? target.body;
    if (key === 'getElementById') return (id: string) => [...surfaces].map(root => root.getElementById(id)).find(Boolean) ?? null;
    if (key === 'querySelector') return (selector: string) => [...surfaces].map(root => root.querySelector(selector)).find(Boolean) ?? null;
    if (key === 'querySelectorAll') return (selector: string) => [...surfaces].flatMap(root => [...root.querySelectorAll(selector)]);
    if (key === 'activeElement') return [...surfaces].map(root => root.activeElement).find(Boolean) ?? target.activeElement;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

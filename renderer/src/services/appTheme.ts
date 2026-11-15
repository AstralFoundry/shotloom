import { settingsStore, saveAppSettings } from '../store/settingsStore';
import { subscribeDomain } from '../store/domainReactivity';
import { resolveAppTheme, type ThemePreference, type ThemeOrigin } from '../utils/appTheme';

let activeTransition: ViewTransition | undefined;

/** Capture the old UI before saving; reveal the updated UI from the clicked control. */
export async function changeAppTheme(preference: ThemePreference, origin?: ThemeOrigin) {
  activeTransition?.skipTransition();
  const next = resolveAppTheme(preference, systemTheme()?.matches || false);
  if (typeof document === 'undefined' || !document.startViewTransition || !origin
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || next === getResolvedAppTheme()) {
    await saveAppSettings({ themePreference: preference });
    return;
  }
  const x = Math.max(0, Math.min(origin.x, window.innerWidth));
  const y = Math.max(0, Math.min(origin.y, window.innerHeight));
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = document.startViewTransition(async () => { await saveAppSettings({ themePreference: preference }); });
  activeTransition = transition;
  void transition.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, {
      duration: 800, easing: 'cubic-bezier(.22, .61, .36, 1)', pseudoElement: '::view-transition-new(root)',
    });
  }).catch(() => transition.skipTransition());
  const clear = () => { if (activeTransition === transition) activeTransition = undefined; };
  void transition.finished.then(clear, clear);
  await transition.updateCallbackDone;
}

let mediaQuery: MediaQueryList | undefined;
function systemTheme() {
  if (!mediaQuery && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }
  return mediaQuery;
}

export function getResolvedAppTheme() {
  return resolveAppTheme(settingsStore.themePreference, systemTheme()?.matches || false);
}

export function getAppThemeSnapshot() {
  return `${settingsStore.themePreference}:${getResolvedAppTheme()}`;
}

export function subscribeAppTheme(listener: () => void) {
  let previous = getAppThemeSnapshot();
  const changed = () => {
    const next = getAppThemeSnapshot();
    if (next !== previous) { previous = next; listener(); }
  };
  const unsubscribe = subscribeDomain(changed);
  const media = systemTheme();
  media?.addEventListener('change', changed);
  return () => { unsubscribe(); media?.removeEventListener('change', changed); };
}

export function mountAppTheme() {
  const apply = () => {
    const theme = getResolvedAppTheme();
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  const unsubscribe = subscribeAppTheme(apply);
  apply();
  return unsubscribe;
}

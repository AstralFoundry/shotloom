import { settingsStore, saveAppSettings } from '../store/settingsStore';
import { subscribeDomain } from '../store/domainReactivity';
import { resolveAppTheme, type ThemePreference, type ThemeOrigin } from '../utils/appTheme';

let activeTransition: ViewTransition | undefined;

/** Capture the old UI before saving; reveal the updated UI from the bottom-left corner. */
export async function changeAppTheme(preference: ThemePreference, origin?: ThemeOrigin) {
  activeTransition?.skipTransition();
  activeTransition = undefined;
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme-transition');
  const next = resolveAppTheme(preference, systemTheme()?.matches || false);
  if (typeof document === 'undefined' || !document.startViewTransition || !origin
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || next === getResolvedAppTheme()) {
    await saveAppSettings({ themePreference: preference });
    return;
  }
  const root = document.documentElement;
  // The reveal already supplies the motion. Hundreds of component color transitions
  // would otherwise keep repainting the new snapshot while it is being revealed.
  root.setAttribute('data-theme-transition', '');
  const transition = document.startViewTransition(async () => {
    await saveAppSettings({ themePreference: preference });
    // Let domain subscribers, React and the Ant Design theme observer commit before
    // the browser captures the new view, rather than updating it during the reveal.
    // View transitions suppress rendering here, so requestAnimationFrame would
    // wait for the capture that is itself waiting on this callback.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  activeTransition = transition;
  void transition.ready.then(() => {
    // Percentages resolve against the transition snapshot itself, so the origin
    // stays at its bottom-left corner regardless of window scale or dimensions.
    document.documentElement.animate({ clipPath: ['circle(0% at 0% 100%)', 'circle(150% at 0% 100%)'] }, {
      duration: 200, easing: 'cubic-bezier(.25, 0, 1, 1)', pseudoElement: '::view-transition-new(root)',
    });
  }).catch(() => transition.skipTransition());
  const clear = () => {
    if (activeTransition === transition) {
      activeTransition = undefined;
      root.removeAttribute('data-theme-transition');
    }
  };
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

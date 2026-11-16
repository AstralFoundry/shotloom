import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('theme preference persists and system changes apply only in system mode', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  const previousDocument = globalThis.document;
  const events = new Set();
  const media = { matches: false, addEventListener: (_type, fn) => events.add(fn), removeEventListener: (_type, fn) => events.delete(fn) };
  window.matchMedia = () => media;
  const classes = new Set();
  const root = { classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) }, dataset: {}, style: {} };
  globalThis.document = { documentElement: root };
  let stop;
  try {
    const { settingsStore, loadAppSettings, saveAppSettings, refreshBalance } = await env.load('store/settingsStore');
    const theme = await env.load('services/appTheme');
    await loadAppSettings();
    assert.equal(settingsStore.themePreference, 'light');
    stop = theme.mountAppTheme();
    await saveAppSettings({ themePreference: 'dark' });
    await Promise.resolve();
    assert.equal(classes.has('dark'), true);
    assert.equal(root.style.colorScheme, 'dark');
    settingsStore.themePreference = 'light';
    await loadAppSettings();
    assert.equal(settingsStore.themePreference, 'dark');
    await saveAppSettings({ themePreference: 'system' });
    await Promise.resolve();
    assert.equal(classes.has('dark'), false);
    media.matches = true; for (const listener of events) listener();
    assert.equal(classes.has('dark'), true);
    assert.equal(settingsStore.themePreference, 'system');
    await saveAppSettings({ themePreference: 'light' });
    await Promise.resolve();
    for (const listener of events) listener();
    assert.equal(classes.has('dark'), false);
    await saveAppSettings({ themePreference: 'dark' });
    await refreshBalance();
    assert.equal(settingsStore.themePreference, 'dark');
    await saveAppSettings({ themePreference: 'invalid' });
    assert.equal(settingsStore.themePreference, 'light');
    stop(); stop = undefined;
    assert.equal(events.size, 0);
  } finally {
    stop?.();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    await env.dispose();
  }
});

test('director theme updates use a view message without reloading the scene', async () => {
  const env = await createRendererEnv();
  try {
    const bridge = await env.load('app/adapters/directorDeskBridge');
    const sent = [];
    globalThis.window = { location: { origin: 'http://localhost' } };
    bridge.sendDirectorDeskTheme({ contentWindow: { postMessage: message => sent.push(message) } }, 'dark');
    assert.deepEqual(sent, [{ type: 'storyai:director-desk-theme', payload: { theme: 'dark' } }]);
    assert.match(bridge.directorDeskWorkspaceSrc('workspace', 'dark'), /theme=dark/);
  } finally { delete globalThis.window; await env.dispose(); }
});

test('theme reveal suppresses component transitions until finish and cleans up failed updates', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  const previousDocument = globalThis.document;
  const attrs = new Map();
  const animations = [];
  let finish;
  const root = {
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key),
    animate: (frames, options) => { animations.push({ frames, options, suppressed: attrs.has('data-theme-transition') }); return {}; },
  };
  window.innerWidth = 1200; window.innerHeight = 800;
  window.matchMedia = () => ({ matches: false });
  globalThis.document = {
    documentElement: root,
    startViewTransition: callback => {
      assert.equal(attrs.has('data-theme-transition'), true);
      const updateCallbackDone = Promise.resolve().then(callback);
      const finished = new Promise(resolve => { finish = resolve; });
      return { updateCallbackDone, ready: updateCallbackDone, finished, skipTransition: () => finish() };
    },
  };
  try {
    const { changeAppTheme } = await env.load('services/appTheme');
    const { desktopApi } = await env.load('services/desktopApi');
    const { settingsStore } = await env.load('store/settingsStore');
    await changeAppTheme('dark', { x: 20, y: 30 });
    assert.equal(settingsStore.themePreference, 'dark');
    assert.equal(animations.length, 1);
    assert.equal(animations[0].suppressed, true);
    assert.equal(animations[0].options.duration, 200);
    assert.equal(animations[0].options.easing, 'cubic-bezier(.25, 0, 1, 1)');
    assert.equal(animations[0].frames.clipPath[0], 'circle(0% at 0% 100%)');
    assert.equal(animations[0].frames.clipPath[1], 'circle(150% at 0% 100%)');
    assert.equal(attrs.has('data-theme-transition'), true);
    // A superseded transition must not remove the newer transition's marker.
    await changeAppTheme('light', { x: 20, y: 30 });
    assert.equal(animations.length, 2);
    assert.equal(attrs.has('data-theme-transition'), true);
    finish(); await Promise.resolve();
    assert.equal(attrs.has('data-theme-transition'), false);
    const save = desktopApi.settings.set;
    desktopApi.settings.set = async () => { throw new Error('storage unavailable'); };
    try {
      await assert.rejects(changeAppTheme('dark', { x: 20, y: 30 }), /storage unavailable/);
      await Promise.resolve(); await Promise.resolve();
      assert.equal(attrs.has('data-theme-transition'), false);
    } finally { desktopApi.settings.set = save; }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    await env.dispose();
  }
});

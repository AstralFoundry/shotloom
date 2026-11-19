import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

test('web reloads and embedded canvases render behind silent verification; only confirmed expiry blocks them', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['renderer/src/app/CloudSession.tsx'], absWorkingDir: fileURLToPath(new URL('../../..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env.VITE_STORAGE_MODE': '"cloud"', 'import.meta.env.VITE_SERVER_URL': '""' }, plugins: [{ name: 'web-session-platform', setup(builder) {
    builder.onResolve({ filter: /components\/SocialAuth$|store\/projectStore$|^\.\.\/i18n$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `exports.t=key=>key;exports.SocialAuth=()=>null;` }));
  } }] });
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), { sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }, ReactNativeWebView: undefined as any });
  (globalThis as any).window = browser;
  try {
    for (const mode of ['first-login', 'web-reload', 'embedded'] as const) {
      if (mode === 'embedded') browser.ReactNativeWebView = { injectedObjectJson: () => '{"userId":"user"}', postMessage: () => {} };
      (globalThis as any).location = { pathname: '/app', search: mode === 'embedded' ? '?native=embedded' : '' };
      const module = { exports: {} as { CloudSession: React.ComponentType<React.PropsWithChildren> } };
      new Function('require', 'module', 'exports', result.outputFiles[0]!.text)(createRequire(import.meta.url), module, module.exports);
      let resolve!: (response: Response) => void;
      globalThis.fetch = async () => new Promise<Response>(done => { resolve = done; });
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(React.createElement(module.exports.CloudSession, null, React.createElement('workspace'))); });
      try {
        assert.equal(tree.root.findAllByType('workspace' as any).length, mode === 'first-login' ? 0 : 1);
        await act(async () => resolve(Response.json({ success: true, data: { id: 'user' } })));
        assert.equal(tree.root.findAllByType('workspace' as any).length, 1);
        assert.deepEqual([...storage.values()], ['user'], 'the tab stores only a user ID, never tokens or account data');
        for (const status of [503, 401]) {
          globalThis.fetch = async () => Response.json({ success: false }, { status });
          // Bypass the short memory cache so the real gate sees the network result.
          const now = Date.now;
          Date.now = () => now() + 31000;
          try { await act(async () => { browser.dispatchEvent(new Event('focus')); }); }
          finally { Date.now = now; }
          assert.equal(tree.root.findAllByType('workspace' as any).length, 1, 'unsaved workspace stays mounted');
          assert.equal(tree.root.findAllByProps({ className: 'cloud-login cloud-login-overlay' }).length, status === 401 ? 1 : 0);
        }
        assert.equal(storage.size, 0, 'revocation clears the stale display hint');
      } finally { await act(async () => tree.unmount()); }
      storage.set('shotloom:session-user:', 'user');
    }
  } finally { globalThis.fetch = originalFetch; delete (globalThis as any).window; delete (globalThis as any).location; }
});

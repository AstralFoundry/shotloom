import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('packaging installs Electron before building and never implicitly publishes a tag', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'shotloom-package-'));
  const source = resolve('scripts/electron-package.mjs');
  const output = join(temp, 'package.mjs');
  const calls = [];
  globalThis.__shotloomPackageTest = {
    spawnSync: (...args) => { calls.push(['process', ...args]); return { status: 0 }; },
    buildElectron: async () => { calls.push(['main']); },
    build: async options => { calls.push(['package', options]); return ['installer']; },
  };
  try {
    await build({
      entryPoints: [source], outfile: output, bundle: true, platform: 'node', format: 'esm',
      define: { 'import.meta.url': JSON.stringify(pathToFileURL(source).href) },
      plugins: [{ name: 'packaging-boundaries', setup(builder) {
        builder.onResolve({ filter: /^(?:electron-builder|node:child_process|\.\/build-electron\.mjs)$/ }, args => ({ path: args.path, namespace: 'packaging-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'packaging-test' }, args => ({ contents:
          args.path === 'electron-builder' ? 'export const build=(...args)=>globalThis.__shotloomPackageTest.build(...args);'
            : args.path === 'node:child_process' ? 'export const spawnSync=(...args)=>globalThis.__shotloomPackageTest.spawnSync(...args);'
              : 'export const buildElectron=(...args)=>globalThis.__shotloomPackageTest.buildElectron(...args);',
        }));
      } }],
    });
    const { packageElectron } = await import(pathToFileURL(output).href);
    assert.deepEqual(await packageElectron({ dirOnly: true }), ['installer']);
    assert.equal(calls[0][1], process.execPath);
    assert.match(calls[0][2][0], /electron[/\\]install\.js$/);
    assert.deepEqual(calls.slice(1, 3).map(call => call[2].at(-1)), ['build', 'prepare:media']);
    assert.equal(calls[3][0], 'main');
    assert.deepEqual(calls[4], ['package', { projectDir: resolve('.'), publish: 'never', dir: true }]);
    calls.length = 0;
    await packageElectron({ dirOnly: false });
    assert.equal(calls.at(-1)[1].publish, 'never');
    assert.equal(calls.at(-1)[1].dir, undefined);
    calls.length = 0;
    globalThis.__shotloomPackageTest.spawnSync = () => ({ status: 1 });
    await assert.rejects(packageElectron(), /Electron binary preparation failed/);
    assert.equal(calls.length, 0);
    const error = new Error('cannot launch binary installer');
    globalThis.__shotloomPackageTest.spawnSync = () => ({ error, status: null });
    await assert.rejects(packageElectron(), value => value === error);
  } finally {
    delete globalThis.__shotloomPackageTest;
    await rm(temp, { recursive: true, force: true });
  }
});

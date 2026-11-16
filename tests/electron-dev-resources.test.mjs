import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureElectronResources } from '../scripts/electron-dev.mjs';

test('fresh desktop startup prepares screenshot CSS and invokes npm through Node, including paths with spaces', () => {
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const calls = [];
  try {
    ensureElectronResources({ exists: () => false, run: (...args) => { calls.push(args); return { status: 0 }; } });
    assert.deepEqual(calls.map(([, args]) => args.at(-1)), ['prepare:director-desk', 'prepare:plugins', 'prepare:harness', 'config:generate', 'prepare:screenshots']);
    for (const [command, args, options] of calls) {
      assert.equal(command, process.execPath);
      assert.deepEqual(args.slice(0, 2), [process.env.npm_execpath, 'run']);
      assert.equal(options.shell, false);
    }
  } finally {
    if (previous === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previous;
  }
});

test('existing desktop resources need no preparation, while missing screenshot CSS is repaired independently', () => {
  const calls = [];
  const run = (...args) => { calls.push(args); return { status: 0 }; };
  ensureElectronResources({ exists: () => true, run });
  assert.equal(calls.length, 0);
  ensureElectronResources({ exists: file => !file.endsWith('screenshots.css'), run });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].at(-1), 'prepare:screenshots');
});

test('failed desktop preparation reports the actual process error and stops startup', () => {
  const error = new Error('spawn npm ENOENT');
  assert.throws(() => ensureElectronResources({ exists: () => false, run: () => ({ error, status: null }) }), value => value === error);
  assert.throws(() => ensureElectronResources({ exists: () => false, run: () => ({ status: 1 }) }), /prepare:director-desk failed/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stageHarnessResources } from '../scripts/prepare-harness.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shotloom-resource-stage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { root: join(directory, 'host'), target: join(directory, 'resources/agent-host'),
    content: join(directory, 'content'), rules: join(directory, 'AGENTS.md'),
    stagingRoot: join(directory, 'staging'), executable: join(directory, 'node') };
  for (const folder of ['dist', 'client-dist', 'node_modules/typebox/build/compile']) {
    await mkdir(join(options.root, folder), { recursive: true });
    await writeFile(join(options.root, folder, 'index.mjs'), 'export default 1;');
  }
  await mkdir(options.content);
  await writeFile(join(options.content, 'policy.md'), 'policy');
  for (const path of [options.rules, options.executable, join(options.root, 'package.json'), join(options.root, 'package-lock.json')]) await writeFile(path, '{}');
  await writeFile(join(options.root, 'package-lock.json'), JSON.stringify({ packages: {} }));
  await mkdir(options.target, { recursive: true });
  await writeFile(join(options.target, 'obsolete.mjs'), 'previous runtime');
  return options;
}

test('publishes the complete Host closure and removes obsolete runtime files', async t => {
  const options = await fixture(t);
  await stageHarnessResources(options);
  assert.equal(await readFile(join(options.target, 'node_modules/typebox/build/compile/index.mjs'), 'utf8'), 'export default 1;');
  assert.equal(await readFile(join(options.target, 'content/policy.md'), 'utf8'), 'policy');
  assert.equal(JSON.parse(await readFile(join(options.target, 'runtime.json'), 'utf8')).arch, process.arch);
  await assert.rejects(access(join(options.target, 'obsolete.mjs')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(options.stagingRoot), []);
});

test('an interrupted or failed resource copy leaves the previous Host intact', async t => {
  const options = await fixture(t);
  await rm(join(options.root, 'package-lock.json'));
  await assert.rejects(stageHarnessResources(options), { code: 'ENOENT' });
  assert.deepEqual(await readdir(options.target), ['obsolete.mjs']);
  assert.equal(await readFile(join(options.target, 'obsolete.mjs'), 'utf8'), 'previous runtime');
  assert.deepEqual(await readdir(options.stagingRoot), []);
});

test('stages production dependencies without build tools, declarations, maps or foreign PTY binaries', async t => {
  const options = await fixture(t);
  const platform = `${process.platform}-${process.arch}`;
  const foreign = process.platform === 'win32' ? 'darwin-arm64' : 'win32-x64';
  const retained = ['shared/index.js', 'shared/package.json', 'shared/LICENSE', 'shared/schema.json',
    'shared/data.map', '.bin/runtime-tool', `node-pty/prebuilds/${platform}/pty.node`, `node-pty/prebuilds/${platform}/helper.exe`,
    'node-pty/build/Release/pty.node'];
  const excluded = ['typescript/lib/typescript.js', '@esbuild/test/bin/esbuild', '.bin/tsc', '.bin/tsc.cmd', '.bin/tsc.ps1',
    'shared/index.d.ts', 'shared/index.d.mts', 'shared/index.d.cts', 'shared/index.js.map',
    'shared/index.d.ts.map', `node-pty/prebuilds/${foreign}/pty.node`];
  for (const file of [...retained, ...excluded]) {
    const path = join(options.root, 'node_modules', file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'fixture');
  }
  await writeFile(join(options.root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/typescript': { dev: true, bin: { tsc: 'bin/tsc' } }, 'node_modules/@esbuild/test': { dev: true },
    'node_modules/shared': { dev: false, bin: { 'runtime-tool': 'index.js' } }, 'node_modules/node-pty': {},
  } }));
  await stageHarnessResources(options);
  for (const file of retained) assert.equal(await readFile(join(options.target, 'node_modules', file), 'utf8'), 'fixture');
  for (const file of excluded) {
    await assert.rejects(access(join(options.target, 'node_modules', file)), { code: 'ENOENT' });
    assert.equal(await readFile(join(options.root, 'node_modules', file), 'utf8'), 'fixture');
  }
});

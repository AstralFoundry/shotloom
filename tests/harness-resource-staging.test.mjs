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

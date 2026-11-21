import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureOpenReelDependencies } from '../scripts/prepare-openreel-agent.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shotloom-openreel-deps-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = async (relative, value) => {
    const dir = join(directory, relative);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify(value));
  };
  await manifest('.', { name: 'openreel', private: true });
  await manifest('packages/core', { name: '@openreel/core', dependencies: { '@paper-design/shaders': '0.0.76', 'polygon-clipping': '0.15.7' } });
  await manifest('packages/agent', { name: '@openreel/agent', dependencies: { '@openreel/creation-schema': 'workspace:*' } });
  await manifest('packages/creation-schema', { name: '@openreel/creation-schema' });
  await writeFile(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages: [packages/*]');
  let installs = 0;
  const install = async () => {
    installs++;
    await mkdir(join(directory, 'node_modules'), { recursive: true });
    await manifest('packages/core/node_modules/@paper-design/shaders', { name: '@paper-design/shaders' });
    await manifest('packages/core/node_modules/polygon-clipping', { name: 'polygon-clipping' });
    const link = join(directory, 'packages/agent/node_modules/@openreel/creation-schema');
    await mkdir(join(link, '..'), { recursive: true });
    await lstat(link).catch(() => symlink(join(directory, 'packages/creation-schema'), link, 'dir'));
  };
  return { directory, install, manifest, count: () => installs, stamp: join(directory, 'node_modules/.shotloom-dependencies') };
}

test('a matching stamp skips installation only while package dependency links exist', async t => {
  const f = await fixture(t);
  await ensureOpenReelDependencies(f);
  assert.equal(f.count(), 1);
  await ensureOpenReelDependencies(f);
  assert.equal(f.count(), 1);
  await rm(join(f.directory, 'packages/agent/node_modules/@openreel/creation-schema'));
  await ensureOpenReelDependencies(f);
  assert.equal(f.count(), 2, 'recreate missing workspace links even with a matching stamp');
  await rm(join(f.directory, 'packages/core/node_modules/@paper-design/shaders'), { recursive: true });
  await ensureOpenReelDependencies(f);
  assert.equal(f.count(), 3, 'repair missing third-party packages');
});

test('repair detaches a shared root dependency symlink without modifying its target', async t => {
  const f = await fixture(t);
  await ensureOpenReelDependencies(f);
  const shared = join(f.directory, 'shared-modules');
  await rename(join(f.directory, 'node_modules'), shared);
  await writeFile(join(shared, 'keep.txt'), 'other checkout');
  await symlink(shared, join(f.directory, 'node_modules'), 'dir');
  await rm(join(f.directory, 'packages/agent/node_modules/@openreel/creation-schema'));
  const previousStamp = await readFile(join(shared, '.shotloom-dependencies'), 'utf8');
  await ensureOpenReelDependencies(f);
  assert.equal((await lstat(join(f.directory, 'node_modules'))).isSymbolicLink(), false);
  assert.equal(await readFile(join(shared, 'keep.txt'), 'utf8'), 'other checkout');
  assert.equal(await readFile(join(shared, '.shotloom-dependencies'), 'utf8'), previousStamp);
});

test('workspace manifest changes invalidate the stamp and incomplete installs never publish it', async t => {
  const f = await fixture(t);
  await ensureOpenReelDependencies(f);
  await f.manifest('packages/core', { name: '@openreel/core', dependencies: { '@paper-design/shaders': '0.0.77', 'polygon-clipping': '0.15.7' } });
  await ensureOpenReelDependencies(f);
  assert.equal(f.count(), 2);
  await rm(f.stamp);
  await rm(join(f.directory, 'packages/agent/node_modules/@openreel/creation-schema'));
  await assert.rejects(ensureOpenReelDependencies({ directory: f.directory, install: async () => {} }), /still missing after install.*creation-schema/);
  await assert.rejects(readFile(f.stamp), { code: 'ENOENT' });
});

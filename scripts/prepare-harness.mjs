import { cp, copyFile, mkdir, writeFile, chmod, rm, mkdtemp, rename, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareOpenReelAgent } from './prepare-openreel-agent.mjs';

/** Build a complete closure outside Tauri's watched resources before publishing it. */
export async function stageHarnessResources({
  root = resolve('harness/host'),
  target = resolve('src-tauri/resources/agent-host'),
  content = resolve('renderer/src/agent/content'),
  rules = resolve('AGENTS.md'),
  stagingRoot = resolve('node_modules'),
  executable = process.execPath,
} = {}) {
  await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(join(stagingRoot, '.shotloom-agent-host-'));
  const ready = join(staging, 'ready');
  const previous = join(staging, 'previous');
  let backedUp = false;
  try {
    await mkdir(ready);
    for (const folder of ['dist', 'client-dist', 'node_modules']) {
      await cp(join(root, folder), join(ready, folder), { recursive: true, dereference: true });
    }
    await cp(content, join(ready, 'content'), { recursive: true });
    await copyFile(rules, join(ready, 'AGENTS.md'));
    await copyFile(join(root, 'package.json'), join(ready, 'package.json'));
    await copyFile(join(root, 'package-lock.json'), join(ready, 'package-lock.json'));
    const node = join(ready, process.platform === 'win32' ? 'node.exe' : 'node');
    await copyFile(executable, node);
    if (process.platform !== 'win32') await chmod(node, 0o755);
    await writeFile(join(ready, 'runtime.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }, null, 2));
    await mkdir(resolve(target, '..'), { recursive: true });
    try {
      await rename(target, previous);
      backedUp = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(ready, target);
    } catch (error) {
      if (backedUp) {
        await rename(previous, target);
        backedUp = false;
      }
      throw error;
    }
  } finally {
    // If rollback itself failed, retain the previous closure for recovery.
    if (!backedUp || await access(target).then(() => true, () => false)) {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

async function prepareHarness() {
  await prepareOpenReelAgent();
  const root = resolve('harness/host');
  const built = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
  const client = spawnSync(process.execPath, [join(root, 'scripts/build-client.mjs')], { stdio: 'inherit' });
  if (client.status !== 0) process.exit(client.status ?? 1);
  await stageHarnessResources();
  console.log(`Prepared Shotloom Agent Host (${process.platform}/${process.arch})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareHarness();

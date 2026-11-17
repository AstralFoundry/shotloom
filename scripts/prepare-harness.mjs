import { cp, copyFile, mkdir, writeFile, chmod, rm, mkdtemp, rename, access, readFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareOpenReelAgent } from './prepare-openreel-agent.mjs';

async function runtimeDependencyFilter(root) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  if (!lock.packages) throw new Error('Harness lockfile must include package records to stage production dependencies');
  const development = new Set(Object.entries(lock.packages).filter(([, pkg]) => pkg.dev === true).map(([path]) => path));
  const developmentBins = new Set();
  const productionBins = new Set();
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path || !pkg.bin) continue;
    const directory = path.slice(0, path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const names = typeof pkg.bin === 'string' ? [path.split('/').at(-1)] : Object.keys(pkg.bin);
    for (const name of names) {
      for (const suffix of ['', '.cmd', '.ps1']) {
        (pkg.dev === true ? developmentBins : productionBins).add(`${directory}.bin/${name}${suffix}`);
      }
    }
  }
  return source => {
    const path = relative(root, source).split(sep).join('/');
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count++) {
      if (development.has(parts.slice(0, count).join('/'))) return false;
    }
    if (developmentBins.has(path) && !productionBins.has(path)) return false;
    if (/\.d\.[cm]?ts(?:\.map)?$|\.[cm]?js\.map$/.test(path)) return false;
    const prebuild = 'node_modules/node-pty/prebuilds/';
    if (path.startsWith(prebuild) && parts[3] !== `${process.platform}-${process.arch}`) return false;
    return true;
  };
}

/** Build a production closure outside watched resources before publishing it. */
export async function stageHarnessResources({
  root = resolve('harness/host'),
  target = resolve('electron/resources/agent-host'),
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
    const filter = await runtimeDependencyFilter(root);
    for (const folder of ['dist', 'client-dist', 'node_modules']) {
      await cp(join(root, folder), join(ready, folder), { recursive: true, dereference: true,
        ...(folder === 'node_modules' ? { filter } : {}) });
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

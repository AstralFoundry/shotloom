import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, access, lstat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const vendor = join(root, 'vendor/openreel');

export function runOpenReelPnpm(args, env = {}) {
  const version = JSON.parse(readFileSync(join(vendor, 'package.json'), 'utf8')).packageManager.split('@')[1];
  // npx respects the vendored pin without relying on the runner's Corepack trust store.
  const command = process.env.SHOTLOOM_PNPM || 'npx';
  const prefix = process.env.SHOTLOOM_PNPM ? [] : ['--yes', `pnpm@${version}`];
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: vendor, shell: process.platform === 'win32', stdio: 'inherit',
    env: { ...process.env, OPENREEL_DESKTOP: '1', ...env },
  });
  if (result.status !== 0) throw new Error(`OpenReel pnpm ${args.join(' ')} failed (${result.status})`);
}

async function workspaceManifests(directory) {
  const manifests = [join(directory, 'package.json')];
  for (const group of ['apps', 'packages']) {
    for (const entry of await readdir(join(directory, group), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const file = join(directory, group, entry.name, 'package.json');
      if (await access(file).then(() => true, () => false)) manifests.push(file);
    }
  }
  return manifests.sort();
}

async function installedDependency(directory, name) {
  // pnpm links dependencies beside each workspace package. A root node_modules
  // link alone does not provide those links in a separate Git worktree.
  for (let parent = directory; ; parent = dirname(parent)) {
    if (await access(join(parent, 'node_modules', name, 'package.json')).then(() => true, () => false)) return true;
    if (parent === dirname(parent)) return false;
  }
}

export async function ensureOpenReelDependencies({ directory = vendor, install = () => runOpenReelPnpm(['install', '--frozen-lockfile']) } = {}) {
  const manifests = await workspaceManifests(directory);
  const hash = createHash('sha256').update(`${process.platform}:${process.arch}:${process.version}`);
  for (const file of [...manifests, join(directory, 'pnpm-lock.yaml'), join(directory, 'pnpm-workspace.yaml')]) {
    hash.update(file.slice(directory.length));
    hash.update(await readFile(file));
  }
  const key = hash.digest('hex');
  const modules = join(directory, 'node_modules');
  const stamp = join(modules, '.shotloom-dependencies');
  const missingDependencies = async () => {
    const missing = [];
    for (const file of manifests) {
      const pkg = JSON.parse(await readFile(file, 'utf8'));
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!await installedDependency(dirname(file), name)) missing.push(`${pkg.name || file}: ${name}`);
      }
    }
    return missing;
  };
  const missing = await missingDependencies();
  if (await readFile(stamp, 'utf8').catch(() => '') === key && !missing.length) return;
  if (missing.length) console.log(`[openreel] Repairing missing workspace dependencies: ${missing.join(', ')}`);
  // Detach only this checkout's symlink; never purge another checkout's modules.
  if (await lstat(modules).then(stat => stat.isSymbolicLink(), () => false)) await unlink(modules);
  await install();
  const unresolved = await missingDependencies();
  if (unresolved.length) throw new Error(`OpenReel dependencies are still missing after install: ${unresolved.join(', ')}`);
  await mkdir(modules, { recursive: true });
  await writeFile(stamp, key);
}

// Generate from the executable native registry, including its real schemas.
// This bundle never imports OpenReel's Agent loop or LLM transport.
export async function prepareOpenReelAgent() {
  await ensureOpenReelDependencies();
  const temp = await mkdtemp(join(tmpdir(), 'shotloom-openreel-tools-'));
  try {
    const outfile = join(temp, 'registry.mjs');
    await build({ stdin: { contents: `export { toolDefs } from './vendor/openreel/packages/agent/src/registry.ts'; export { buildSystemPrompt } from './vendor/openreel/packages/agent/src/system-prompt.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });
    const { toolDefs, buildSystemPrompt } = await import(pathToFileURL(outfile).href);
    const tools = toolDefs();
    if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error('Duplicate OpenReel tool');
    const writeChanged = async (file, text) => {
      if (await readFile(file, 'utf8').catch(() => '') !== text) await writeFile(file, text);
    };
    await writeChanged(join(root, 'renderer/src/config/openreel-agent-tools.json'), JSON.stringify(tools, null, 2) + '\n');
    const policy = JSON.parse(await readFile(join(root, 'renderer/src/config/openreel-agent-policy.json'), 'utf8'));
    await writeChanged(join(root, 'renderer/src/agent/content/openreel-agent-policy.json'), JSON.stringify(policy, null, 2) + '\n');
    const excluded = Object.keys(policy.excludedTools);
    for (const name of [...excluded, ...policy.desktopProjectTools]) {
      if (!tools.some(tool => tool.name === name)) throw new Error(`Unknown OpenReel policy tool: ${name}`);
    }
    let guidance = buildSystemPrompt({ getProject() { throw new Error('Read real state through tools'); } }, []);
    guidance = guidance.split('\nCurrent editor state:')[0];
    // Drop upstream workflow instructions for tools the product cannot execute.
    guidance = guidance.split('\n').filter(line => !excluded.some(name => line.includes(name))).join('\n');
    // Prefix only names in the native registry; preserve the upstream guidance.
    guidance = guidance.replace(/\b[a-z][a-z0-9_]*\b/g, name => tools.some(tool => tool.name === name) ? `openreel_${name}` : name);
    await writeChanged(join(root, 'renderer/src/agent/content/prompts/openreel-editor-reference.md'), '# OpenReel native editing reference\n\nGenerated by scripts/prepare-openreel-agent.mjs from the vendored official system prompt and product support policy. Shotloom binding, permissions and Harness contracts take precedence. All native tools use the openreel_ prefix. Only tools in the current request are available; do not infer optional backend support from upstream documentation or previous sessions.\n\n' + guidance.trimEnd() + '\n');
    return tools;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.log(`Prepared ${(await prepareOpenReelAgent()).length} OpenReel tools`);
}

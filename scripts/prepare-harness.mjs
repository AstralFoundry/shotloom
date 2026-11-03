import { cp, copyFile, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareOpenReelAgent } from './prepare-openreel-agent.mjs';

await prepareOpenReelAgent();

const root = resolve('harness/host');
const built = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const client = spawnSync(process.execPath, [join(root, 'scripts/build-client.mjs')], { stdio: 'inherit' });
if (client.status !== 0) process.exit(client.status ?? 1);
const target = resolve('src-tauri/resources/agent-host');
// Rebuild the generated closure so removed runtime modules cannot survive packaging.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const folder of ['dist', 'client-dist', 'node_modules']) {
  await cp(join(root, folder), join(target, folder), { recursive: true, dereference: true });
}
await cp(resolve('renderer/src/agent/content'), join(target, 'content'), { recursive: true });
await copyFile(resolve('AGENTS.md'), join(target, 'AGENTS.md'));
await copyFile(join(root, 'package.json'), join(target, 'package.json'));
await copyFile(join(root, 'package-lock.json'), join(target, 'package-lock.json'));
const node = join(target, process.platform === 'win32' ? 'node.exe' : 'node');
await copyFile(process.execPath, node);
if (process.platform !== 'win32') await chmod(node, 0o755);
await writeFile(join(target, 'runtime.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }, null, 2));
console.log(`Prepared Shotloom Agent Host (${process.platform}/${process.arch})`);

import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/shotloom-director-desk');
const output = path.join(root, 'renderer/public/director-desk-app');
if (!existsSync(path.join(source, 'node_modules'))) {
  const install = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: source, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status || 1);
}
const build = spawnSync('npm', ['run', 'build'], { cwd: source, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(source, 'dist'), output, { recursive: true });

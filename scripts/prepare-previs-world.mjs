import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/canvas-previs');
const output = path.join(root, 'renderer/public/previs-world-app');

function runNpm(args) {
  // npm_execpath points to npm's JS entrypoint when launched by npm run.
  // Running it with Node avoids Windows .cmd resolution and shell quoting.
  const npmCli = process.env.npm_execpath;
  const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd: source,
    stdio: 'inherit',
    shell: !npmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`World engine npm ${args.join(' ')} failed (${result.signal || result.status})`);
    process.exit(result.status || 1);
  }
}

const dependencyStamp = path.join(source, 'node_modules/.shotloom-dependencies');
const lockHash = createHash('sha256').update(await readFile(path.join(source, 'package-lock.json'))).digest('hex');
const installedHash = existsSync(dependencyStamp) ? await readFile(dependencyStamp, 'utf8') : '';
if (installedHash !== lockHash) {
  runNpm(['ci', '--ignore-scripts']);
  await writeFile(dependencyStamp, lockHash);
}
runNpm(['run', 'build']);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(source, 'dist'), output, { recursive: true });
await cp(path.join(source, 'LICENSE'), path.join(output, 'LICENSE-open-ai-canvas.txt'));

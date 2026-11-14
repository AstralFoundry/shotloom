import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/shotloom-director-desk');
const output = path.join(root, 'renderer/public/director-desk-app');

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
    console.error(`Director desk npm ${args.join(' ')} failed (${result.signal || result.status})`);
    process.exit(result.status || 1);
  }
}

if (!existsSync(path.join(source, 'node_modules'))) {
  runNpm(['ci', '--ignore-scripts']);
}
runNpm(['run', 'build']);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(source, 'dist'), output, { recursive: true });

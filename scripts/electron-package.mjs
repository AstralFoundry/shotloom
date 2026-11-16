import { build as electronBuild } from 'electron-builder';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildElectron } from './build-electron.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {
  for (const script of ['build', 'prepare:media']) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
      cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (result.status !== 0) throw new Error(`npm run ${script} failed`);
  }
  await buildElectron();
  // electron-builder 默认读取 projectDir 下的 electron-builder.yml。
  const artifacts = await electronBuild({ projectDir: rootDir, ...(dirOnly ? { dir: true } : {}) });
  console.log(`[electron] packaged: ${artifacts.join(', ')}`);
  return artifacts;
}

function CLI_ONLY_DIR() {
  return process.argv.includes('--dir');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packageElectron();
}

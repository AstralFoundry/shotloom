import { build as electronBuild } from 'electron-builder';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildElectron } from './build-electron.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {
  // Electron 44 downloads its binary lazily; npm ci alone does not create the
  // electronDist configured in electron-builder.yml on a clean packaging runner.
  const installed = spawnSync(process.execPath, [require.resolve('electron/install.js')], { cwd: rootDir, stdio: 'inherit' });
  if (installed.error) throw installed.error;
  if (installed.status !== 0) throw new Error(`Electron binary preparation failed (${installed.signal || installed.status})`);
  for (const script of ['build', 'prepare:media']) {
    const npmCli = process.env.npm_execpath;
    const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, 'run', script] : ['run', script], {
      cwd: rootDir, stdio: 'inherit', shell: !npmCli && process.platform === 'win32',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm run ${script} failed`);
  }
  await buildElectron();
  // electron-builder 默认读取 projectDir 下的 electron-builder.yml。
  // The release workflow stages/verifies artifacts and publishes them together.
  // Disabling certificate discovery does not perform ad-hoc signing. Select it
  // explicitly so downloaded builds have a valid, sealed application bundle.
  const signing = process.platform === 'darwin'
    ? { config: { mac: { identity: process.env.CSC_NAME || '-' } } } : {};
  const artifacts = await electronBuild({ projectDir: rootDir, publish: 'never', ...signing, ...(dirOnly ? { dir: true } : {}) });
  console.log(`[electron] packaged: ${artifacts.join(', ')}`);
  return artifacts;
}

function CLI_ONLY_DIR() {
  return process.argv.includes('--dir');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packageElectron();
}

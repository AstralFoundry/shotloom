import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { arch, platform } from 'node:process';

const require = createRequire(import.meta.url);
const platformName = platform === 'win32' ? 'windows' : platform;
const archName = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;
if (!['darwin', 'linux', 'windows'].includes(platformName) || !archName) {
  throw new Error(`OpenCode sidecar is not available for ${platform}/${arch}`);
}

const packageName = `opencode-${platformName}-${archName}`;
const packageJson = require.resolve(`${packageName}/package.json`);
const executable = platform === 'win32' ? 'opencode.exe' : 'opencode';
const source = resolve(dirname(packageJson), 'bin', executable);
const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'windows-arm64': 'aarch64-pc-windows-msvc',
  'windows-x64': 'x86_64-pc-windows-msvc',
};
const triple = triples[`${platformName}-${archName}`];
const suffix = platform === 'win32' ? '.exe' : '';
const target = resolve('src-tauri', 'binaries', `opencode-${triple}${suffix}`);

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
if (platform !== 'win32') await chmod(target, 0o755);
console.log(`Prepared OpenCode ${packageName} sidecar at ${target}`);

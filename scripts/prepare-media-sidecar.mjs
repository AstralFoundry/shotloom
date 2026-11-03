import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { arch, platform } from 'node:process';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};
const triple = triples[`${platform}-${arch}`];
if (!triple) throw new Error(`FFmpeg sidecar is not available for ${platform}/${arch}`);

const packageSource = require('ffmpeg-static');
// npm installs made with --ignore-scripts (and some pnpm/npm cache restores)
// leave ffmpeg-static's downloaded file absent. Prefer it when present, then
// reuse the already validated native sidecar produced by the desktop toolchain.
const sourceCandidates = [
  packageSource,
  resolve('src-tauri', 'binaries', `ffmpeg-${triple}${platform === 'win32' ? '.exe' : ''}`),
  resolve('src-tauri', 'target', 'release', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
];
let source = sourceCandidates[0];
for (const candidate of sourceCandidates) {
  try {
    const info = await stat(candidate);
    if (info.isFile() && info.size >= 1_000_000) {
      source = candidate;
      break;
    }
  } catch {
    // Try the next locally available copy.
  }
}
try {
  const info = await stat(source);
  if (!info.isFile() || info.size < 1_000_000) throw new Error('binary is incomplete');
} catch (cause) {
  throw new Error(`FFmpeg binary is unavailable. Run "npm rebuild ffmpeg-static --foreground-scripts" first. ${cause}`);
}
if (platform !== 'win32') await chmod(source, 0o755);
const version = spawnSync(source, ['-version'], { encoding: 'utf8' });
if (version.status !== 0 || !String(version.stdout).startsWith('ffmpeg version')) {
  throw new Error('FFmpeg binary failed its startup check');
}

const suffix = platform === 'win32' ? '.exe' : '';
const target = resolve('src-tauri', 'binaries', `ffmpeg-${triple}${suffix}`);
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
if (platform !== 'win32') await chmod(target, 0o755);
console.log(`Prepared FFmpeg sidecar at ${target}`);

const packageJson = require.resolve('ffmpeg-static/package.json');
await mkdir(resolve('src-tauri', 'resources'), { recursive: true });
await copyFile(
  resolve(dirname(packageJson), 'LICENSE'),
  resolve('src-tauri', 'resources', 'FFmpeg-GPL-3.0.txt'),
);

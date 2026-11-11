import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
// leave ffmpeg-static's downloaded file absent. An existing sidecar may also
// have stopped working, so validate each local candidate before selecting it.
const sourceCandidates = [
  packageSource,
  resolve('src-tauri', 'binaries', `ffmpeg-${triple}${platform === 'win32' ? '.exe' : ''}`),
  resolve('src-tauri', 'target', 'release', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
];
async function validateBinary(candidate) {
  const info = await stat(candidate);
  if (!info.isFile() || info.size < 1_000_000) throw new Error('binary is incomplete');
  if (platform !== 'win32') await chmod(candidate, 0o755);
  const version = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
  if (version.status !== 0 || !String(version.stdout).startsWith('ffmpeg version')) {
    throw new Error(version.error?.message || version.signal || version.stderr?.trim() || `exit status ${version.status}`);
  }
}

let source;
const failures = [];
for (const candidate of sourceCandidates) {
  try {
    await validateBinary(candidate);
    source = candidate;
    break;
  } catch (cause) {
    failures.push(`${candidate}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
if (!source) {
  throw new Error(`No working FFmpeg binary found. Run "npm rebuild ffmpeg-static --foreground-scripts" first.\n${failures.join('\n')}`);
}

const suffix = platform === 'win32' ? '.exe' : '';
const target = resolve('src-tauri', 'binaries', `ffmpeg-${triple}${suffix}`);
await mkdir(dirname(target), { recursive: true });
if (source !== target) {
  // Replacing a macOS executable in place can leave a stale code-signing cache for its inode.
  // Stage a fresh file, validate it, then atomically replace the sidecar path.
  const staged = `${target}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, staged);
    await validateBinary(staged);
    await rename(staged, target);
  } finally {
    await rm(staged, { force: true });
  }
  await validateBinary(target);
}
console.log(`Prepared FFmpeg sidecar at ${target}`);

const packageJson = require.resolve('ffmpeg-static/package.json');
await mkdir(resolve('src-tauri', 'resources'), { recursive: true });
await copyFile(
  resolve(dirname(packageJson), 'LICENSE'),
  resolve('src-tauri', 'resources', 'FFmpeg-GPL-3.0.txt'),
);

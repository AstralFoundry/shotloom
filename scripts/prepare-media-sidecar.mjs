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

const source = require('ffmpeg-static');
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

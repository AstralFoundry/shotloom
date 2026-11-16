import { build as viteBuild } from 'vite';
import { build as electronBuild } from 'electron-builder';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildElectron } from './build-electron.mjs';
import { ensureElectronResources } from './electron-dev.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const resourcesDir = join(rootDir, 'electron', 'resources');

/** 打包用的 ffmpeg/ffprobe：优先 ffmpeg-static/ffprobe-static，退回 Tauri 遗留 sidecar。 */
function stageMediaTool(name, candidatePaths) {
  const target = join(resourcesDir, name);
  const source = candidatePaths.find(path => path && existsSync(path));
  if (!source) {
    console.warn(`[electron] ${name} not found; packaged app will rely on PATH/Homebrew`);
    rmSync(target, { force: true });
    return;
  }
  mkdirSync(resourcesDir, { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(`[electron] staged ${name} from ${source}`);
}

function stageMediaTools() {
  let ffmpegStatic;
  try { ffmpegStatic = require('ffmpeg-static'); } catch { ffmpegStatic = undefined; }
  let ffprobeStatic;
  try { ffprobeStatic = require('ffprobe-static').path; } catch { ffprobeStatic = undefined; }
  const triple = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
    : process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  void triple;
  stageMediaTool('ffmpeg', [
    join(rootDir, 'electron', 'resources', 'ffmpeg'),
    ffmpegStatic,
  ]);
  // 与 Tauri 发行版一致：只随包提供 ffmpeg；ffprobe 缺失时媒体探测退回解析 ffmpeg 输出。
  void ffprobeStatic;
}

export async function packageElectron({ dirOnly = CLI_ONLY_DIR() } = {}) {
  ensureElectronResources();
  stageMediaTools();
  await buildElectron();
  await viteBuild({ configFile: join(rootDir, 'vite.config.mjs') });
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

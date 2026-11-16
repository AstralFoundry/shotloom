import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildElectron } from './build-electron.mjs';
import { readShotloomConfig } from './shotloom-config.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const electronBinary = require('electron');

/**
 * Electron 开发启动：先构建主进程/preload，再起 Vite（渲染进程保持热更新），
 * 最后把开发服务器地址交给 Electron。窗口关掉后开发服务器一起退出。
 */
/**
 * 桌面开发/打包都依赖仓库里生成好的发行物：厂商插件目录、Agent Host、默认配置。
 * 缺了就直接运行对应的 prepare 脚本，而不是等应用启动时报「目录不可用」。
 */
export function ensureElectronResources() {
  const required = [
    { file: ['electron', 'resources', 'provider-plugins', 'index.json'], script: 'prepare:plugins' },
    { file: ['electron', 'resources', 'agent-host', 'dist', 'main.js'], script: 'prepare:harness' },
    { file: ['renderer', 'src', 'config', 'shotloom-defaults.generated.json'], script: 'config:generate' },
  ];
  for (const item of required) {
    if (existsSync(join(rootDir, ...item.file))) continue;
    console.log(`[electron] missing ${item.file.join('/')}; running npm run ${item.script}`);
    const result = spawnSync('npm', ['run', item.script], { cwd: rootDir, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`npm run ${item.script} failed`);
  }
}

export async function startElectronDev({ env = {}, prod = false } = {}) {
  ensureElectronResources();
  await buildElectron();
  let server = null;
  let url;
  if (!prod) {
    server = await createServer({
      configFile: join(rootDir, 'vite.config.mjs'),
      server: { open: false },
    });
    await server.listen();
    url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('Vite dev server did not report a local URL');
  } else if (!existsSync(join(rootDir, 'dist', 'renderer', 'index.html'))) {
    throw new Error('dist/renderer/index.html is missing; run a renderer build first');
  }
  // 有些开发终端（含 Agent 运行时）会带 ELECTRON_RUN_AS_NODE=1，那会让 Electron
  // 退化成 plain Node 并直接崩在 protocol 注册上；启动 GUI 前必须去掉。
  const childEnv = { ...process.env, ...env, SHOTLOOM_ROOT: rootDir };
  if (url) childEnv.SHOTLOOM_DEV_URL = url;
  if (childEnv.SHOTLOOM_SMOKE) {
    // 冒烟运行把用户数据放进工作区，避免沙箱/CI 环境没有主目录写权限时直接失败。
    // 每次从空目录开始：冒烟脚本会真的建项目、导包、导包后再删掉，状态必须可复现。
    const smokeRoot = join(rootDir, 'tmp', 'electron-smoke');
    rmSync(smokeRoot, { recursive: true, force: true });
    childEnv.SHOTLOOM_APPDATA_DIR = join(smokeRoot, 'appdata');
    childEnv.SHOTLOOM_USER_DATA = join(smokeRoot, 'userdata');
    // 冒烟会真的拉起 Agent Host（如果构建产物存在），验证 stdio/桥接通道。
    childEnv.SHOTLOOM_AGENT_HOST = join(rootDir, 'electron', 'resources', 'agent-host');
  }
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [rootDir], { cwd: rootDir, stdio: 'inherit', env: childEnv });
  const shutdown = async (code) => {
    await server?.close().catch(() => {});
    process.exit(code ?? 0);
  };
  child.on('exit', (code) => { void shutdown(code ?? 0); });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  return child;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // 默认窗口尺寸来自 shotloom.yml，主进程用它创建窗口。
  const config = readShotloomConfig();
  const smoke = process.argv.includes('--smoke') || Boolean(process.env.SHOTLOOM_SMOKE);
  const prod = process.argv.includes('--prod');
  await startElectronDev({
    prod,
    env: {
      SHOTLOOM_WINDOW: JSON.stringify(config.desktop.mainWindow),
      ...(smoke ? { SHOTLOOM_SMOKE: '1' } : {}),
    },
  });
}

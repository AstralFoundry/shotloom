import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * electron-builder 的 extraResources 会沿用默认的忽略规则，把 agent-host 的
 * node_modules 丢掉，导致打包后的 Agent Host 起不来。这里在打完后按目录原样
 * 拷一次，保证资源闭包完整（node 运行时 + 依赖 + content）。
 */
export default async function afterPack(context) {
  const rootDir = context.packager.projectDir;
  const source = join(rootDir, 'src-tauri', 'resources', 'agent-host');
  if (!existsSync(source)) {
    console.warn('[electron] agent-host resources are missing; packaged app cannot start the Agent Host');
    return;
  }
  const resourcesDir = process.platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const target = join(resourcesDir, 'resources', 'agent-host');
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, dereference: true });
  console.log(`[electron] copied agent-host resources to ${target}`);
}

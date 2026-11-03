import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const rendererRoot = fileURLToPath(new URL('../../renderer', import.meta.url));

/**
 * 领域 store 与 Agent 运行时只在浏览器里存在的全局上运行。测试替身只补这两类：
 * 存储用调用方传入的 Map 承接（可直接预置数据，测试结束后还能读回写入内容），
 * 定时器默认不真正触发，避免测试关闭后仍有回调访问已经清理的存储。
 */
export function createLocalStorageShim(backing = new Map()) {
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
    clear: () => backing.clear(),
  };
}

function createWindowShim(realTimers, localStorage) {
  return {
    // 界面 store 会读 `window.localStorage`，替身要和 globalThis 上那份是同一个后端。
    localStorage,
    setTimeout: realTimers ? ((fn, ms) => setTimeout(fn, ms)) : (() => 0),
    clearTimeout: realTimers ? ((id) => clearTimeout(id)) : () => {},
    setInterval: realTimers ? ((fn, ms) => setInterval(fn, ms)) : (() => 0),
    clearInterval: realTimers ? ((id) => clearInterval(id)) : () => {},
    // 只有需要真实事件订阅的测试会走到这里，其余测试没有 window 监听需求。
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/**
 * 在渲染进程源码上跑真实模块图：一个 Vite SSR dev server + 按路径加载模块。
 *
 * 不用仓库根 `vite.config.mjs`：那份配置带 React 插件，而这里只需要模块求值与 JSX 编译，
 * esbuild 按 `tsconfig.json` 的 `react-jsx` 就能编译 `.tsx`，插件只会让每个测试文件
 * 多起一次依赖预扫描。
 *
 * @param {object} [options]
 * @param {Map} [options.storage] 传入则安装 localStorage 替身，内容落在该 Map 上。
 * @param {boolean} [options.withWindow] 安装只含定时器的 window 替身。
 * @param {boolean} [options.realTimers] window 定时器是否委派给 Node 的真实定时器。
 * @returns {Promise<{load: (relative: string) => Promise<any>, dispose: () => Promise<void>}>}
 */
export async function createRendererEnv({ storage, withWindow = false, realTimers = false, plugins = [] } = {}) {
  const globals = [];
  const storageShim = storage ? createLocalStorageShim(storage) : undefined;
  if (storageShim) {
    globalThis.localStorage = storageShim;
    globals.push('localStorage');
  }
  if (withWindow || realTimers) {
    globalThis.window = createWindowShim(realTimers, storageShim);
    globals.push('window');
  }

  const server = await createServer({
    configFile: false,
    plugins,
    optimizeDeps: { noDiscovery: true, include: [] },
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  return {
    /**
     * 按 `renderer/src` 下的相对路径加载模块，例如 `store/projectStore`。
     * 界面模块是 `.tsx`，需要显式带后缀（例如 `app/ReactWorkbench.tsx`）时才按给定后缀解析。
     */
    load(relative) {
      const clean = relative.replace(/^\/+/, '');
      return server.ssrLoadModule(`/src/${/\.(ts|tsx|json)$/.test(clean) ? clean : `${clean}.ts`}`);
    },
    loadVendor(relative) {
      return server.ssrLoadModule(path.join(rendererRoot, '../vendor', relative));
    },
    async dispose() {
      await server.close();
      for (const name of globals) delete globalThis[name];
    },
  };
}

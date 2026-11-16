import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const electronOutDir = join(rootDir, 'dist', 'electron');

/**
 * Electron 主进程与 preload 各自打包：主进程跑 Node，preload 在渲染进程的隔离上下文里
 * 只允许 CommonJS。产物落在 dist/electron，和 renderer 构建产物互不覆盖。
 */
/**
 * 原生菜单只需要 native.menu.* 词条；主进程不打包整份语言包（每份约 600KB）。
 */
function writeNativeMenuCatalog() {
  const pick = (locale) => {
    const source = JSON.parse(readFileSync(join(rootDir, 'renderer', 'src', 'i18n', 'locales', `${locale}.json`), 'utf8'));
    return Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith('native.menu.')));
  };
  mkdirSync(electronOutDir, { recursive: true });
  writeFileSync(join(electronOutDir, 'native-menu.json'), JSON.stringify({ zh: pick('zh-CN'), en: pick('en-US') }));
}

export async function buildElectron({ watch = false } = {}) {
  writeNativeMenuCatalog();
  const options = {
    entryPoints: {
      main: join(rootDir, 'electron', 'main.ts'),
      preload: join(rootDir, 'electron', 'preload.ts'),
    },
    outdir: electronOutDir,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    sourcemap: true,
    external: ['electron'],
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') },
    ...(watch ? { plugins: [watchLogger()] } : {}),
  };
  if (!watch) {
    await build(options);
    return null;
  }
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  return ctx;
}

function watchLogger() {
  return {
    name: 'shotloom-watch-log',
    setup(builder) {
      builder.onEnd((result) => {
        if (!result.errors.length) console.log('[electron] main/preload rebuilt');
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron();
  console.log(`[electron] built ${electronOutDir}`);
}

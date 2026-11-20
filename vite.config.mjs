import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { collectWorkspacePreloads } from './shared/workspacePreloads.ts';
import { readShotloomConfig } from './scripts/shotloom-config.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const { development } = readShotloomConfig();

export default defineConfig({
  root: path.join(rootDir, 'renderer'),
  plugins: [react(), {
    name: 'workspace-preload-metadata',
    apply: 'build',
    async writeBundle() {
      const directory = path.join(rootDir, 'dist', 'renderer');
      const manifest = JSON.parse(await readFile(path.join(directory, '.vite/manifest.json'), 'utf8'));
      const entry = path.join(directory, 'index.html');
      const html = await readFile(entry, 'utf8');
      const files = collectWorkspacePreloads(manifest);
      const pages = Object.fromEntries(['CreationView', 'ProjectsView', 'SkillsFeature', 'AccountView', 'SettingsFeature', 'AssetsView', 'MaterialsView', 'TasksView'].map(name => [name, collectWorkspacePreloads(manifest, ['ReactWorkbench', 'AntdProvider', name])]));
      if (!files.includes(manifest['index.html']?.file) || !html.includes('</head>')) throw new Error('Workspace preload metadata is incomplete');
      // Ship metadata with its page so partial deployments cannot warm a previous release.
      await writeFile(entry, html.replace('</head>', `<script id="shotloom-workspace-preloads" type="application/json">${JSON.stringify(files)}</script>\n<script id="shotloom-page-preloads" type="application/json">${JSON.stringify(pages)}</script>\n  </head>`));
    },
  }],
  base: './',
  server: {
    host: development.webHost,
    port: development.webPort,
    strictPort: true,
    open: development.openBrowser,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    fs: { allow: [rootDir] },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    manifest: true,
    outDir: path.join(rootDir, 'dist', 'renderer'),
    emptyOutDir: true,
    // 桌面端从本地磁盘加载 dist/renderer，百万字节级的 vendor chunk 不是网络问题；
    // 真正的首屏瓶颈是解析时间，所以这里只按运行时分包，不再用默认 500 kB 阈值报警。
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.join(rootDir, 'renderer', 'index.html'),
        home: path.join(rootDir, 'renderer', 'home.html'),
        download: path.join(rootDir, 'renderer', 'download.html'),
      },
      output: {
        // React 与 antd 各自独立：组件库升级不会让 React 缓存失效，反之亦然。
        manualChunks(id) {
          if (id.includes('/src/i18n/locales/')) return id.includes('/en-US.') ? 'locale-en-US' : 'locale-zh-CN';
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react/')
            || id.includes('/react-dom/')
            || id.includes('/scheduler/')
          ) return 'react';
          if (
            id.includes('/antd/')
            || id.includes('/@ant-design/')
            || id.includes('/@rc-component/')
          ) return 'antd';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.join(rootDir, 'renderer', 'src'),
    },
  },
});

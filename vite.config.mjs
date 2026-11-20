import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { readShotloomConfig } from './scripts/shotloom-config.mjs';
import { handlePolyforkRequest, polyforkPrefix } from './electron/core/polyfork.ts';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const { development } = readShotloomConfig();

export default defineConfig({
  root: path.join(rootDir, 'renderer'),
  plugins: [react(), {
    name: 'shotloom-polyfork',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(polyforkPrefix)) return next();
        const abort = new AbortController();
        res.once('close', () => abort.abort());
        try {
          const response = await handlePolyforkRequest(new Request(`http://localhost${req.url}`, {
            method: req.method, headers: req.headers, signal: abort.signal,
          }));
          if (res.destroyed) return;
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body) Readable.fromWeb(response.body).on('error', error => res.destroy(error)).pipe(res);
          else res.end();
        } catch (error) { next(error); }
      });
    },
  }],
  base: './',
  server: {
    host: development.webHost,
    port: development.webPort,
    strictPort: true,
    open: development.openBrowser,
    fs: { allow: [rootDir] },
  },
  build: {
    outDir: path.join(rootDir, 'dist', 'renderer'),
    emptyOutDir: true,
    // 桌面端从本地磁盘加载 dist/renderer，百万字节级的 vendor chunk 不是网络问题；
    // 真正的首屏瓶颈是解析时间，所以这里只按运行时分包，不再用默认 500 kB 阈值报警。
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.join(rootDir, 'renderer', 'index.html'),
      },
      output: {
        // React 与 antd 各自独立：组件库升级不会让 React 缓存失效，反之亦然。
        manualChunks(id) {
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

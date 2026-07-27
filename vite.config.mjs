import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'renderer'),
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: path.join(rootDir, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(rootDir, 'renderer', 'index.html'),
        directorDesk: path.join(rootDir, 'renderer', 'director-desk.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.join(rootDir, 'renderer', 'src'),
    },
  },
});

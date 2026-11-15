import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* Environment injection also works without a local file. */ }

const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2] || 'build';
if (!['build', 'dev'].includes(action)) throw new Error('Use build or dev');
const url = new URL(process.env.SHOTLOOM_CLOUD_URL || 'https://shotloom.0xfiang.com');
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('SHOTLOOM_CLOUD_URL must be an HTTPS origin');
}
const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url)));
const config = {
  bundle: { useLocalToolsDir: true },
  ...(action === 'dev' ? { build: { devUrl: url.origin, beforeDevCommand: null } } : {}),
  app: {
    windows: base.app.windows.map(window => ({ ...window, url: url.origin })),
    security: { capabilities: [{ ...capability, identifier: 'cloud-desktop', remote: { urls: [`${url.origin}/*`] },
      permissions: [...capability.permissions.filter(permission => permission !== 'local-commands'), 'cloud-client'] }] },
  },
};
const prepare = spawnSync(process.execPath, ['scripts/prepare-media-sidecar.mjs'], { cwd: root, stdio: 'inherit' });
if (prepare.status !== 0) process.exit(prepare.status || 1);
const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', action, '--config', JSON.stringify(config), ...process.argv.slice(3)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);

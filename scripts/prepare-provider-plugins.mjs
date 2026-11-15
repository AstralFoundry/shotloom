import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { readDefaultPluginPackages, defaultPluginConnections } from './provider-distribution.mjs';
const packages = readDefaultPluginPackages();
defaultPluginConnections(packages); // Reject ambiguous model IDs before packaging.
const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const validator = await createServer({ configFile: false, root: renderer, resolve: { alias: { '@': join(renderer, 'src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { validateProviderPackage } = await validator.ssrLoadModule('/src/store/providerPluginStore.ts');
  for (const { manifest } of packages) validateProviderPackage(manifest);
} finally { await validator.close(); }
const archives = packages.map(({ manifest, files }) => {
  if (Object.keys(files).length > 256 || Object.values(files).reduce((size, bytes) => size + bytes.length, 0) > 40 * 1024 * 1024) throw new Error(`Expanded package limit: ${manifest.id}`);
  const bytes = zipSync(files, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`Package limit: ${manifest.id}`);
  return { bytes, entry: { id: manifest.id, version: manifest.version, file: `${manifest.id}-${manifest.version}.shotloom-plugin`, sha256: createHash('sha256').update(bytes).digest('hex') } };
});
for (const location of ['../src-tauri/resources/provider-plugins/', '../renderer/public/provider-plugins/']) {
  const directory = fileURLToPath(new URL(location, import.meta.url));
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const { bytes, entry } of archives) await writeFile(join(directory, entry.file), bytes);
  await writeFile(join(directory, 'index.json'), JSON.stringify({ apiVersion: 1, plugins: archives.map(item => item.entry) }, null, 2) + '\n');
}
console.log(`Packaged ${archives.length} default plugins for desktop and browser preview.`);

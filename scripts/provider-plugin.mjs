#!/usr/bin/env node
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { createServer } from 'vite';

const [operation, directory, output] = process.argv.slice(2);
if (!['validate', 'pack'].includes(operation) || !directory) {
  console.error('Usage: npm run plugin -- validate <directory> | pack <directory> [output.shotloom-plugin]');
  process.exit(1);
}
const root = path.resolve(directory);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const renderer = fileURLToPath(new URL('../renderer', import.meta.url));
const server = await createServer({ configFile: false, root: renderer, resolve: { alias: { '@': path.join(renderer, 'src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { validateProviderPackage } = await server.ssrLoadModule('/src/store/providerPluginStore.ts');
  validateProviderPackage(manifest);
  const files = {};
  async function walk(relative = '') {
    for (const name of await readdir(path.join(root, relative))) {
      if (name.startsWith('.') || name === 'node_modules') throw new Error('Hidden files and node_modules are not supported; bundle dependencies');
      const local = path.posix.join(relative, name);
      const stat = await lstat(path.join(root, local));
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${local}`);
      if (stat.isDirectory()) await walk(local);
      else if (stat.isFile()) files[local] = new Uint8Array(await readFile(path.join(root, local)));
      else throw new Error(`Unsupported file: ${local}`);
    }
  }
  await walk();
  if (files['package.json']) {
    const metadata = JSON.parse(new TextDecoder().decode(files['package.json']));
    if (!/^shotloom-plugin-[a-z0-9][a-z0-9._-]*$/.test(String(metadata.name || '').split('/').at(-1))) throw new Error('Plugin package names must start with shotloom-plugin-, e.g. @scope/shotloom-plugin-example');
  }
  if (manifest.runtime && !files[manifest.runtime.entry]) throw new Error('Missing runtime entry');
  if (!manifest.runtime && Object.keys(files).some(file => file.startsWith('runtime/'))) throw new Error('Runtime files require a runtime declaration');
  if (Object.keys(files).length > 256 || Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > 40 * 1024 * 1024) throw new Error('Plugin exceeds package limits');
  if (operation === 'pack') {
    const bytes = zipSync(files, { level: 6 });
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Plugin exceeds 20 MiB');
    const target = output || `${manifest.id}-${manifest.version}.shotloom-plugin`;
    await writeFile(target, bytes);
    console.log(`${target}\nSHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
  } else console.log(`Valid: ${manifest.id}@${manifest.version}`);
} finally { await server.close(); }

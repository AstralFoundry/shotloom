import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../plugin-packages/defaults/', import.meta.url));

/** Build-time package inputs only. The application catalog never imports this source tree. */
export function readDefaultPluginPackages(directory = root) {
  const index = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
  if (index.apiVersion !== 1 || !Array.isArray(index.packages) || new Set(index.packages).size !== index.packages.length) throw new Error('Invalid default plugin index');
  return index.packages.map(folder => {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(folder)) throw new Error('Unsafe default plugin directory');
    const files = {};
    function walk(relative = '') {
      for (const name of readdirSync(join(directory, folder, relative)).sort()) {
        if (name.startsWith('.') || name === 'node_modules') throw new Error('Bundle plugin dependencies');
        const local = relative ? `${relative}/${name}` : name;
        const stat = lstatSync(join(directory, folder, local));
        if (stat.isSymbolicLink()) throw new Error('Plugin packages cannot contain symlinks');
        if (stat.isDirectory()) walk(local);
        else files[local] = readFileSync(join(directory, folder, local));
      }
    }
    walk();
    const manifest = JSON.parse(files['manifest.json'].toString());
    const metadata = JSON.parse(files['package.json'].toString());
    if (manifest.id !== folder || !/^shotloom-plugin-[a-z0-9][a-z0-9._-]*$/.test(metadata.name.split('/').at(-1)) || metadata.version !== manifest.version || metadata.shotloomPlugin !== 'manifest.json') throw new Error(`Invalid package identity: ${folder}`);
    const documentation = Object.keys(files).find(name => name.toLowerCase() === 'readme.md');
    return { manifest: documentation ? { ...manifest, readme: files[documentation].toString() } : manifest, files };
  });
}

export function defaultPluginConnections(packages = readDefaultPluginPackages()) {
  const connections = new Map();
  for (const { manifest } of packages) for (const seed of manifest.defaultConnections || []) {
    const existing = connections.get(seed.id);
    if (!existing) connections.set(seed.id, structuredClone(seed));
    else for (const model of seed.models || []) {
      if (existing.models.some(item => item.id === model.id)) throw new Error(`Duplicate default model: ${model.id}`);
      existing.models.push(structuredClone(model));
    }
  }
  return [...connections.values()].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

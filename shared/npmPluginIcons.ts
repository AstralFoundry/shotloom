import { valid } from 'semver';
import { pluginIconPath, packagedPluginIcon } from './pluginIcon';

type SearchItem = { package?: { name?: string; version?: string; [key: string]: unknown }; [key: string]: unknown };
/** Enrich search results in the host, so renderer CSP never needs external image or metadata access. */
export async function withNpmPluginIcons(value: unknown, registry: string, read: (url: string, limit: number) => Promise<Uint8Array>) {
  const data = value as { objects?: SearchItem[]; [key: string]: unknown };
  if (!Array.isArray(data?.objects)) return value;
  const objects = await Promise.all(data.objects.map(async (item, index) => {
    const name = item.package?.name;
    if (index >= 40 || typeof name !== 'string' || !/^(@[a-z0-9._-]+\/)?shotloom-plugin-[a-z0-9][a-z0-9._-]*$/.test(name)) return item;
    try {
      const bytes = await read(`${registry.replace(/\/$/, '')}/${encodeURIComponent(name)}/latest`, 2 * 1024 * 1024);
      const metadata = JSON.parse(new TextDecoder().decode(bytes));
      if (metadata.name !== name || metadata.shotloomPlugin !== 'manifest.json' || typeof metadata.version !== 'string' || !valid(metadata.version)) return item;
      const pkg = { ...item.package, version: metadata.version };
      if (pluginIconPath(metadata.shotloomIcon)) {
        try {
          const asset = await read(`https://cdn.jsdelivr.net/npm/${name}@${metadata.version}/${metadata.shotloomIcon}`, 64 * 1024);
          return { ...item, package: { ...pkg, shotloomIcon: packagedPluginIcon(metadata.shotloomIcon, asset) } };
        } catch { /* Missing or unavailable images retain the generic icon. */ }
      }
      return { ...item, package: pkg };
    } catch { return item; }
  }));
  return { ...data, objects };
}

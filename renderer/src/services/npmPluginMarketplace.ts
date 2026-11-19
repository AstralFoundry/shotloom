import { pluginIconSource } from '../../../shared/pluginIcon';
export type NpmPluginListing = { name: string; version: string; description: string; author: string; icon?: string | undefined };

export function npmPluginListings(response: unknown): { packages: NpmPluginListing[]; nextOffset: number; hasMore: boolean } {
  const data = response as { objects?: { package?: { name?: string; version?: string; description?: string; publisher?: { username?: string }; shotloomIcon?: string } }[]; total?: number; offset?: number };
  if (!Array.isArray(data?.objects)) throw new Error('Invalid npm search response');
  const packages: NpmPluginListing[] = [];
  for (const { package: item } of data.objects) {
    if (!item || typeof item.name !== 'string' || typeof item.version !== 'string') continue;
    if (!/^(@[a-z0-9._-]+\/)?shotloom-plugin-[a-z0-9][a-z0-9._-]*$/.test(item.name)) continue;
    if (packages.some(existing => existing.name === item.name)) continue;
    packages.push({ name: item.name, version: item.version, description: typeof item.description === 'string' ? item.description : '', author: typeof item.publisher?.username === 'string' ? item.publisher.username : '', icon: pluginIconSource(item.shotloomIcon) });
  }
  const nextOffset = (data.offset || 0) + data.objects.length;
  return { packages, nextOffset, hasMore: data.objects.length > 0 && nextOffset < Math.min(data.total || 0, 10000) };
}

export function npmSearchUrl(query: string, registry: string, offset: number) {
  if (!['npm', 'npmmirror'].includes(registry)) throw new Error('Unsupported npm registry');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid npm search offset');
  const base = registry === 'npmmirror' ? 'https://registry.npmmirror.com/' : 'https://registry.npmjs.org/';
  const url = new URL('-/v1/search', base);
  url.search = new URLSearchParams({ text: `shotloom ${query}`, size: '40', from: String(offset) }).toString();
  return url.toString();
}

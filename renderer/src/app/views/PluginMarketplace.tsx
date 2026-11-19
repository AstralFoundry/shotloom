import { useEffect, useState } from 'react';
import { Button, Empty, Select, Spin } from 'antd';
import { t } from '@/i18n';
import { desktopApi } from '../../services/desktopApi';
import { npmPluginListings, type NpmPluginListing } from '../../services/npmPluginMarketplace';
import { SearchInput } from '../components/SearchInput';
import { IconSymbol } from '../components/IconSymbol';

export function PluginMarketplace({ registry, onRegistryChange, onInstall }: {
  registry: string; onRegistryChange: (value: string) => void; onInstall: (source: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ query: '', revision: 0 });
  const [packages, setPackages] = useState<NpmPluginListing[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPackages([]); setOffset(0); setHasMore(false);
    void desktopApi.providerPlugins.manage('search', { query: search.query, registry, offset: 0 }).then((response: unknown) => {
      if (!active) return;
      const result = npmPluginListings(response);
      setPackages(result.packages); setOffset(result.nextOffset); setHasMore(result.hasMore);
    }).catch((cause: unknown) => { if (active) setError(String(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false;  };
  }, [search, registry]);
  async function loadMore() {
    setLoading(true); setError('');
    try {
      const response = await desktopApi.providerPlugins.manage('search', { query: search.query, registry, offset });
      const result = npmPluginListings({ ...response, offset });
      setPackages(previous => [...previous, ...result.packages.filter(item => !previous.some(old => old.name === item.name))]);
      setOffset(result.nextOffset); setHasMore(result.hasMore);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }
  return <div className="provider-plugin-marketplace">
    <form className="provider-plugin-toolbar provider-plugin-marketplace-toolbar" onSubmit={event => { event.preventDefault(); setSearch(previous => ({ query: query.trim(), revision: previous.revision + 1 })); }}>
      <div className="provider-plugin-search"><SearchInput value={query} onChange={setQuery} placeholder={t('plugins.marketSearch')} /></div>
      <Button htmlType="submit" disabled={loading}><IconSymbol name="search" />{t('plugins.searchNpm')}</Button>
      <label className="provider-plugin-marketplace-source">{t('plugins.downloadSource')}<Select disabled={loading} value={registry} onChange={onRegistryChange} aria-label={t('plugins.downloadSource')} options={[
        { value: 'npmmirror', label: t('plugins.npmMirror') }, { value: 'npm', label: t('plugins.npmOfficial') },
      ]} /></label>
    </form>
    <p className="provider-plugin-marketplace-hint">{t('plugins.marketHint')}</p>
    {error && <p className="provider-plugin-error" role="alert">{error}</p>}
    {packages.length > 0 && <div className="provider-plugin-grid">{packages.map(item => <article className="provider-plugin-card" key={item.name}>
      <div className="provider-plugin-card-heading"><div className="provider-plugin-card-icon">{item.icon && !failedIcons.has(item.icon) ? <img src={item.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailedIcons(previous => new Set(previous).add(item.icon!))} /> : <IconSymbol name="blocks" />}</div><div><h2 title={item.name}>{item.name}</h2><span className="provider-plugin-version">v{item.version}{item.author && ` · ${item.author}`}</span></div></div>
      <p className="provider-plugin-card-description">{item.description}</p>
      <footer className="provider-plugin-card-footer"><Button onClick={() => onInstall(`npm:${item.name}@latest`)}>{t('plugins.installTitle')}</Button></footer>
    </article>)}</div>}
    {loading && <div className="provider-plugin-marketplace-loading"><Spin /></div>}
    {!loading && !error && !packages.length && <Empty description={t('plugins.noMarketResults')} />}
    {hasMore && <Button disabled={loading} onClick={() => void loadMore()}>{t('plugins.loadMore')}</Button>}
  </div>;
}

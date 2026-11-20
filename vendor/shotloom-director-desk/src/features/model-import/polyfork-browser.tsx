import { Alert, Button, Empty, Input, Pagination, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { downloadPolyforkModel, getPolyforkModel, polyforkModelBundle, searchPolyforkModels, type PolyforkDetail, type PolyforkResults } from '@/core/resources/polyfork.ts';
import type { ModelResource } from '@/core/resources/project-resources.ts';
import { download } from '@/core/storage.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';

export function PolyforkBrowser({ disabled, onImport }: { disabled: boolean; onImport(resource: ModelResource): Promise<void> }) {
    const t = useTranslation();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PolyforkResults | null>(null);
    const [detail, setDetail] = useState<PolyforkDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const searchControl = useRef<AbortController | null>(null);
    const detailControl = useRef<AbortController | null>(null);
    const downloadControl = useRef<AbortController | null>(null);
    const searchedQuery = useRef('');

    async function search(value: string, page = 1) {
        searchControl.current?.abort(); detailControl.current?.abort();
        const controller = new AbortController(); searchControl.current = controller;
        searchedQuery.current = value;
        setLoading(true); setError(''); setDetail(null); setResults(null);
        try { setResults(await searchPolyforkModels(value, page, controller.signal)); }
        catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); }
        finally { if (!controller.signal.aborted) setLoading(false); }
    }
    useEffect(() => {
        void search('');
        return () => { searchControl.current?.abort(); detailControl.current?.abort(); downloadControl.current?.abort(); };
    }, []);

    async function inspect(id: string) {
        detailControl.current?.abort();
        const controller = new AbortController(); detailControl.current = controller;
        setError(''); setDetail(null);
        try { setDetail(await getPolyforkModel(id, controller.signal)); }
        catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); }
    }
    async function useModel(mode: 'download' | 'import') {
        if (!detail || working || disabled) return;
        const controller = new AbortController(); downloadControl.current = controller;
        const project = session.project, revision = useEditorStore.getState().revision;
        setWorking(true); setError('');
        try {
            const { resource } = await downloadPolyforkModel(detail.id, controller.signal);
            controller.signal.throwIfAborted();
            if (mode === 'download') download(polyforkModelBundle(resource), `${detail.id}.zip`);
            else {
                if (project !== session.project || revision !== useEditorStore.getState().revision) throw Error('读取期间工程已变化，请重新导入');
                await onImport(resource);
            }
        } catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); }
        finally { if (!controller.signal.aborted) setWorking(false); }
    }
    const busy = working || disabled;
    return <div className="stack">
        <p className="muted small">{t('模型来自 Polyfork。免费低模；下载包包含模型、署名和 CC BY 4.0 许可。')}</p>
        <Input.Search aria-label={t('搜索在线模型')} placeholder={t('输入英文关键词，如 chair、tree、car')} value={query}
            onChange={event => setQuery(event.target.value)} onSearch={value => void search(value)} loading={loading} disabled={busy} enterButton={t('搜索')} />
        {error && <Alert type="error" showIcon title={t(error)} />}
        {detail && <section className="stack" aria-label={t('模型详情')}>
            <strong>{detail.title}</strong>
            {detail.size_m && <span>{detail.size_m.x} × {detail.size_m.y} × {detail.size_m.z} m</span>}
            <span className="muted small">{detail.credit}</span>
            <a href={detail.source} target="_blank" rel="noreferrer">{t('查看来源与许可')}</a>
            <div>
                <Button disabled={busy} loading={working} onClick={() => void useModel('download')}>{t('下载模型包')}</Button>
                <Button type="primary" disabled={busy} loading={working} onClick={() => void useModel('import')}>{t('下载并导入')}</Button>
            </div>
        </section>}
        <Spin spinning={loading}>
            {results?.assets.length ? <div className="asset-grid" aria-label={t('在线模型搜索结果')}>
                {results.assets.map(asset => <button type="button" className="asset-card" key={asset.id} disabled={busy}
                    aria-pressed={detail?.id === asset.id} onClick={() => void inspect(asset.id)}>
                    <span className="asset-card__preview">{asset.thumbnail ? <img src={asset.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>GLB</span>}</span>
                    <span className="asset-card__name">{asset.title}</span>
                    {asset.triangles != null && <span className="muted small">{asset.triangles} {t('三角面')}</span>}
                </button>)}
            </div> : results && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的资产')} />}
        </Spin>
        {results && <Pagination current={results.page} total={results.total} pageSize={results.per_page} showSizeChanger={false} disabled={busy || loading}
            onChange={page => void search(searchedQuery.current, page)} size="small" />}
    </div>;
}

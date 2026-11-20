import { Alert, Button, Empty, Modal, Pagination, Select, Spin } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reportHostModelImport } from '@/app/host-bridge.ts';
import { POLYFORK_CATEGORIES, obtainPolyforkModel, getPolyforkModel, polyforkModelBundle, searchPolyforkModels, type PolyforkAsset, type PolyforkDetail, type PolyforkResults } from '@/core/resources/polyfork.ts';
import { readLocalModelInfo, updateLocalModelCategory } from '@/core/resources/local-model-library.ts';
import { download } from '@/core/storage.ts';
import { addDownloadedModelToScene } from '@/features/model-import/import-model.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { notifySuccess } from '@/shared/ui/feedback.ts';

export function PolyforkBrowser({ query }: { query: string }) {
    const t = useTranslation();
    const editorBusy = useEditorStore((state) => state.busy);
    const [results, setResults] = useState<PolyforkResults | null>(null);
    const [detail, setDetail] = useState<PolyforkDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState<PolyforkAsset | null>(null);
    const [detailError, setDetailError] = useState('');
    const [saved, setSaved] = useState(false);
    const [category, setCategory] = useState('');
    const [searchQuery, setSearchQuery] = useState(query);
    const searchControl = useRef<AbortController | null>(null);
    const detailControl = useRef<AbortController | null>(null);
    const downloadControl = useRef<AbortController | null>(null);

    const search = useCallback(async (value: string, page = 1) => {
        searchControl.current?.abort(); detailControl.current?.abort();
        const controller = new AbortController(); searchControl.current = controller;
        setLoading(true); setError(''); setDetail(null); setResults(null);
        setSearchQuery(value);
        try {
            const next = await searchPolyforkModels(value, page, controller.signal, category);
            if (!controller.signal.aborted) setResults(next);
        }
        catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); }
        finally { if (!controller.signal.aborted) setLoading(false); }
    }, [category]);
    useEffect(() => {
        setLoading(true); setError(''); setDetail(null); setResults(null);
        const timer = window.setTimeout(() => void search(query), query ? 300 : 0);
        return () => {
            window.clearTimeout(timer);
            searchControl.current?.abort();
            detailControl.current?.abort();
        };
    }, [query, search]);
    useEffect(() => () => downloadControl.current?.abort(), []);
    const modalOpen = Boolean(selected);
    useLayoutEffect(() => {
        if (!modalOpen) return;
        reportHostModelImport(true);
        return () => reportHostModelImport(false);
    }, [modalOpen]);

    function close() {
        detailControl.current?.abort();
        setSelected(null);
    }

    async function inspect(asset: PolyforkAsset) {
        detailControl.current?.abort();
        const controller = new AbortController(); detailControl.current = controller;
        setSelected(asset); setDetail(null); setDetailError(''); setSaved(false);
        try {
            const [next, local] = await Promise.all([getPolyforkModel(asset.id, controller.signal), readLocalModelInfo(asset.id)]);
            if (controller.signal.aborted) return;
            setDetail(next);
            setSaved(Boolean(local));
            if (local && next.class && local.category !== next.class)
                void updateLocalModelCategory(asset.id, next.class).catch(() => undefined);
        }
        catch (cause) { if (!controller.signal.aborted) setDetailError((cause as Error).message); }
    }
    async function useModel(mode: 'download' | 'import') {
        if (!detail || working || (mode === 'import' && useEditorStore.getState().busy)) return;
        const controller = new AbortController(); downloadControl.current = controller;
        const project = session.project, revision = useEditorStore.getState().revision;
        setWorking(true); setDetailError('');
        try {
            const resource = await obtainPolyforkModel(detail.id, controller.signal);
            controller.signal.throwIfAborted();
            if (mode === 'download') {
                download(polyforkModelBundle(resource), `${detail.id}.zip`);
                notifySuccess(t('模型已保存到本地资产'));
            } else {
                if (project !== session.project || revision !== useEditorStore.getState().revision) throw Error('读取期间工程已变化，请重新导入');
                await addDownloadedModelToScene(resource, controller.signal);
                notifySuccess('模型已添加');
            }
            close();
        } catch (cause) { if (!controller.signal.aborted) setDetailError((cause as Error).message); }
        finally { if (!controller.signal.aborted) setWorking(false); }
    }
    return <div className="stack">
        <Select value={category} aria-label={t('资产分组')} onChange={setCategory}
            options={[{ value: '', label: t('全部') }, ...Object.entries(POLYFORK_CATEGORIES).map(([value, label]) => ({ value, label: t(label) }))]} />
        <p className="muted small">{t('模型来自 Polyfork。免费低模；下载包包含模型、署名和 CC BY 4.0 许可。')}</p>
        {(results?.coverage === 'poor' || results?.coverage === 'none') && <Alert type="warning" showIcon title={t('匹配不完整，请尝试英文关键词或分类筛选。')} />}
        {results?.suggestedQuery && <Button onClick={() => void search(results.suggestedQuery!)}>{results.suggestedQuery}</Button>}
        {error && <Alert type="error" showIcon title={t(error)} />}
        {selected && <Modal open centered width={440} title={selected.title} onCancel={close}
            closable={!working} keyboard={!working} mask={{ closable: false }}
            footer={[
                <Button key="cancel" disabled={working} onClick={close}>{t('取消')}</Button>,
                <Button key="download" disabled={!detail || working} onClick={() => void useModel('download')}>{t(saved ? '导出模型包' : '下载模型包')}</Button>,
                <Button key="import" type="primary" disabled={!detail || working || editorBusy} onClick={() => void useModel('import')}>{t(saved ? '添加到场景' : '下载并导入')}</Button>,
            ]}>
            <div className="stack">
                {selected.thumbnail && <img className="polyfork-confirm__preview" src={selected.thumbnail} alt="" referrerPolicy="no-referrer" />}
                <p>{t(saved ? '这个模型已保存在本地，可直接添加到场景。' : '下载后会保存到「本地 → 已下载」。')}</p>
                {detail?.size_m && <span>{detail.size_m.x} × {detail.size_m.y} × {detail.size_m.z} m</span>}
                {detail && <><span className="muted small polyfork-confirm__credit">{detail.credit}</span>
                    <a href={detail.source} target="_blank" rel="noreferrer">{t('查看来源与许可')}</a></>}
                {detailError ? <Alert type="error" showIcon title={t(detailError)} /> : (!detail || working) && <Spin />}
            </div>
        </Modal>}
        <Spin spinning={loading}>
            {results?.assets.length ? <div className="asset-grid" aria-label={t('在线模型搜索结果')}>
                {results.assets.map(asset => <button type="button" className="asset-card" key={asset.id} disabled={working}
                    aria-haspopup="dialog" onClick={() => void inspect(asset)}>
                    <span className="asset-card__preview" aria-hidden="true">{asset.thumbnail ? <img src={asset.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>GLB</span>}</span>
                    <span className="asset-card__name">{asset.title}</span>
                    {asset.triangles != null && <span className="muted small">{asset.triangles} {t('三角面')}</span>}
                </button>)}
            </div> : results && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的资产')} />}
        </Spin>
        {results && <Pagination simple current={results.page} total={results.total} pageSize={results.per_page} disabled={working || loading}
            onChange={page => void search(searchQuery, page)} size="small" />}
    </div>;
}

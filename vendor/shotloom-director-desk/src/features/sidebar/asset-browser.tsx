import { Modal, Slider } from 'antd';
import { Empty, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ASSET_GROUPS, assetSearchScore, searchAssets } from '@/core/asset-catalog.ts';
import { assetDimensions, localModelThumbnail, thumbnail } from '@/core/assets/thumbnails.ts';
import type { AssetDefinition } from '@/core/assets/catalog/types.ts';
import { listLocalModels, readLocalModel, subscribeLocalModels, type LocalModel } from '@/core/resources/local-model-library.ts';
import { addDownloadedModelToScene } from '@/features/model-import/import-model.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { PolyforkBrowser } from './polyfork-browser.tsx';
import { POLYFORK_CATEGORIES } from '@/core/resources/polyfork.ts';

export type AssetSource = 'builtin' | 'polyfork';

const categoryLabel = (category?: string) => category ? POLYFORK_CATEGORIES[category] ?? category : '未分类';
const downloadCategoryPrefix = 'download:';

function LocalModelPreview({ id }: { id: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [src, setSrc] = useState<string>();
    useEffect(() => {
        const target = ref.current;
        if (!target) return;
        let active = true;
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting) return;
            observer.disconnect();
            void localModelThumbnail(id, () => active).then(image => {
                if (image && active) setSrc(image);
            }).catch(() => undefined);
        }, { rootMargin: '120px' });
        observer.observe(target);
        return () => { active = false; observer.disconnect(); };
    }, [id]);
    return <span ref={ref} className="asset-card__preview" aria-hidden="true">{src ? <img src={src} alt="" /> : 'GLB'}</span>;
}

function LocalModelCards({ models }: { models: LocalModel[] }) {
    const t = useTranslation();
    const busy = useEditorStore(state => state.busy);
    const [adding, setAdding] = useState(false);
    const pending = useRef<AbortController | null>(null);
    useEffect(() => () => pending.current?.abort(), []);

    async function add(id: string) {
        if (pending.current || useEditorStore.getState().busy) return;
        const controller = new AbortController();
        pending.current = controller;
        const project = session.project, revision = useEditorStore.getState().revision;
        setAdding(true);
        try {
            const resource = await readLocalModel(id);
            controller.signal.throwIfAborted();
            if (!resource) throw Error(t('本地模型文件不存在，请重新下载'));
            if (project !== session.project || revision !== useEditorStore.getState().revision) throw Error(t('读取期间工程已变化，请重新导入'));
            await addDownloadedModelToScene(resource, controller.signal);
            notifySuccess('模型已添加');
        } catch (error) {
            if (!controller.signal.aborted) notifyError((error as Error).message);
        } finally {
            pending.current = null;
            if (!controller.signal.aborted) setAdding(false);
        }
    }

    return <section className="asset-section" aria-label={t('已下载')}>
        <h3 className="asset-section__title">{t('已下载')}</h3>
        <div className="asset-grid">
            {models.map(model => <button type="button" key={model.id} className="asset-card" title={model.credit || model.name}
                disabled={busy || adding} onClick={() => void add(model.id)}>
                <LocalModelPreview id={model.id} />
                <span className="asset-card__name">{model.name}</span>
                <span className="muted small">{t(categoryLabel(model.category))}</span>
            </button>)}
        </div>
    </section>;
}

const assetSize = (asset: AssetDefinition) => assetDimensions(asset.id)?.map(v => Number(v.toFixed(3))).join(' × ') ?? ['width', 'height', 'depth'].map(key => asset.parameters?.[key]?.default ?? (key === 'height' ? asset.defaults?.height : undefined) ?? '—').join(' × ');

const SECTION_ORDER = ['角色', '群众', '几何', '家具', '建筑 / 场景', '自然 / 动物', '道具 / 设备'] as const;

function sectionFor(asset: AssetDefinition): (typeof SECTION_ORDER)[number] {
    if (asset.kind === 'crowd') return '群众';
    if (['人物', '特殊人形', '服装轮廓'].includes(asset.group)) return '角色';
    if (asset.group === '搭建') return '几何';
    if (asset.id === 'bench') return '家具';
    if (['家具', '座具', '桌台柜架', '卧室家具', '厨卫家电'].includes(asset.group)) return '家具';
    if (['室外', '建筑构件', '通行构件', '建筑外壳', '道路市政', '地形自然'].includes(asset.group))
        return '建筑 / 场景';
    if (['自然', '植物', '宠物', '家畜坐骑', '野生动物', '飞禽水生幻想'].includes(asset.group)) return '自然 / 动物';
    return '道具 / 设备';
}

function AssetPreview({ asset, angle = 0 }: { asset: AssetDefinition; angle?: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [src, setSrc] = useState<string>();

    useEffect(() => {
        let active = true;
        const element = ref.current;
        if (!element) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                observer.disconnect();
                void thumbnail(asset.id, () => active, angle)
                    .then((image) => {
                        if (active && image) setSrc(image);
                    })
                    .catch(() => undefined);
            },
            { rootMargin: '120px' },
        );
        observer.observe(element);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [asset.id, angle]);

    return (
        <span ref={ref} className={`asset-card__preview ${src ? 'is-loaded' : ''}`} aria-hidden="true">
            {src ? <img src={src} alt="" /> : <span className="asset-card__fallback">{asset.icon}</span>}
        </span>
    );
}

/** Catalogue browser for the "添加" tab: group filter + click-to-place asset cards. */
export function AssetBrowser({ source, onSourceChange, onlineQuery }: { source: AssetSource; onSourceChange(source: AssetSource): void; onlineQuery: string }) {
    const t = useTranslation();
    const [previewAsset, setPreviewAsset] = useState<AssetDefinition | null>(null);
    const [angle, setAngle] = useState(0);
    const query = useEditorStore((state) => state.query);
    const filter = useEditorStore((state) => state.assetFilter);
    const [downloads, setDownloads] = useState<LocalModel[]>([]);
    useEffect(() => {
        if (source !== 'builtin') return;
        let request = 0;
        const refresh = async () => {
            const current = ++request;
            try {
                const models = await listLocalModels();
                if (current === request) setDownloads(models);
            } catch {
                if (current === request) notifyError(t('无法读取本地模型库'));
            }
        };
        const unsubscribe = subscribeLocalModels(() => void refresh());
        void refresh();
        return () => { request++; unsubscribe(); };
    }, [source, t]);
    const categoryFilter = filter.startsWith(downloadCategoryPrefix) ? filter.slice(downloadCategoryPrefix.length) : null;
    const localModels = source === 'builtin' ? downloads.filter(model => {
        const category = categoryLabel(model.category);
        const matchesFilter = categoryFilter === null
            ? filter === '全部' || filter === '已下载' || filter === category
            : (model.category ?? '') === categoryFilter;
        return matchesFilter && Number.isFinite(assetSearchScore(query, [model.id, model.name, category, model.category ?? '']));
    }) : [];
    const categories = [...new Set(downloads.map(model => model.category ?? ''))]
        .filter(category => !ASSET_GROUPS.includes(categoryLabel(category))).sort();
    const assets = source === 'builtin' && filter !== '已下载' && categoryFilter === null ? searchAssets(query, filter) : [];
    const sections = SECTION_ORDER.map((name) => ({
        name,
        assets: assets.filter((asset) => sectionFor(asset) === name),
    })).filter((section) => section.assets.length > 0);

    return (
        <div className="asset-browser">
            <Modal open={Boolean(previewAsset)} title={previewAsset ? t(previewAsset.name) : ''} onCancel={() => setPreviewAsset(null)} footer={null} destroyOnHidden>
                {previewAsset && <><AssetPreview asset={previewAsset} angle={angle} /><p>{t('默认尺寸 / 米')} · {assetSize(previewAsset)}</p><Slider aria-label={t('旋转预览')} min={-Math.PI} max={Math.PI} step={0.05} value={angle} onChange={setAngle} /><button onClick={() => session.addAsset(previewAsset.id)}>{t('添加到场景')}</button></>}
            </Modal>
            <div className="asset-browser__filters">
                <Select<AssetSource>
                    variant="filled"
                    value={source}
                    aria-label={t('资产来源')}
                    onChange={onSourceChange}
                    options={[{ value: 'builtin', label: t('本地') }, { value: 'polyfork', label: 'Polyfork' }]}
                />
                {source === 'builtin' && <Select
                    variant="filled"
                    value={filter}
                    aria-label={t('资产分组')}
                    onChange={(value) => useEditorStore.getState().patch({ assetFilter: value })}
                    options={[
                        { value: '全部', label: t('全部') },
                        { value: '已下载', label: t('已下载') },
                        ...categories.map(category => ({ value: `${downloadCategoryPrefix}${category}`, label: `${t('已下载')} · ${t(categoryLabel(category))}` })),
                        ...ASSET_GROUPS.map((group) => ({ value: group, label: t(group) })),
                    ]}
                />}
            </div>
            {localModels.length > 0 && <LocalModelCards models={localModels} />}
            {source === 'polyfork' ? <PolyforkBrowser query={onlineQuery} /> : assets.length ? (
                sections.map((section) => (
                    <section className="asset-section" key={section.name} aria-label={t(section.name)}>
                        <h3 className="asset-section__title">{t(section.name)}</h3>
                        <div className="asset-grid">
                            {section.assets.map((asset) => (
                                <div key={asset.id}><button
                                    type="button"
                                    className="asset-card"
                                    title={t(asset.name)}
                                    onClick={() => session.addAsset(asset.id)}
                                >
                                    <AssetPreview asset={asset} />
                                    <span className="asset-card__name">{t(asset.name)}</span>
                                </button><button className="asset-card__inspect" aria-label={`${t('预览')} ${t(asset.name)}`} onClick={() => { setAngle(0); setPreviewAsset(asset); }}>{t('预览')}</button></div>
                            ))}
                        </div>
                    </section>
                ))
            ) : localModels.length ? null : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的资产')} />
            )}
        </div>
    );
}

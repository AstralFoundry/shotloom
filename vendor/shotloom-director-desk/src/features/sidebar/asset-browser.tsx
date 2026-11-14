import { Modal, Slider } from 'antd';
import { Empty, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ASSET_GROUPS, searchAssets } from '@/core/asset-catalog.ts';
import { assetDimensions, thumbnail } from '@/core/assets/thumbnails.ts';
import type { AssetDefinition } from '@/core/assets/catalog/types.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';

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
export function AssetBrowser() {
    const t = useTranslation();
    const [previewAsset, setPreviewAsset] = useState<AssetDefinition | null>(null);
    const [angle, setAngle] = useState(0);
    const query = useEditorStore((state) => state.query);
    const filter = useEditorStore((state) => state.assetFilter);
    const assets = searchAssets(query, filter);
    const sections = SECTION_ORDER.map((name) => ({
        name,
        assets: assets.filter((asset) => sectionFor(asset) === name),
    })).filter((section) => section.assets.length > 0);

    return (
        <div className="asset-browser">
            <Modal open={Boolean(previewAsset)} title={previewAsset ? t(previewAsset.name) : ''} onCancel={() => setPreviewAsset(null)} footer={null} destroyOnHidden>
                {previewAsset && <><AssetPreview asset={previewAsset} angle={angle} /><p>{t('默认尺寸 / 米')} · {assetSize(previewAsset)}</p><Slider aria-label={t('旋转预览')} min={-Math.PI} max={Math.PI} step={0.05} value={angle} onChange={setAngle} /><button onClick={() => session.addAsset(previewAsset.id)}>{t('添加到场景')}</button></>}
            </Modal>
            <Select
                size="small"
                value={filter}
                aria-label={t('资产分组')}
                onChange={(value) => useEditorStore.getState().patch({ assetFilter: value })}
                options={[
                    { value: '全部', label: t('全部') },
                    ...ASSET_GROUPS.map((group) => ({ value: group, label: t(group) })),
                ]}
            />
            {assets.length ? (
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
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的资产')} />
            )}
        </div>
    );
}

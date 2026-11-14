import { ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon } from '@/shared/ui/icons.tsx';
import { Button, Select, Tooltip } from 'antd';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { ViewMode } from '@/state/editor-store.ts';
import { session } from '@/state/editor-session.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';

/** Floating camera monitor; collapsing its chrome never unmounts the engine's canvas. */
export function CameraPreviewPanel({ view, preview, cameras, lens, aspect, canvasRef, children, onInteract }: {
    view: ViewMode;
    preview: string;
    cameras: { id: string; name: string }[];
    lens: number;
    aspect: string;
    canvasRef: RefObject<HTMLDivElement | null>;
    children: ReactNode;
    onInteract: () => void;
}) {
    const t = useTranslation();
    const [collapsed, setCollapsed] = useState(true);
    const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
    const floating = view === 'stage' || view === 'pip';
    const compact = floating && collapsed;

    useEffect(() => {
        if (view === 'pip') setCollapsed(false);
        else if (view === 'stage') setCollapsed(true);
    }, [view]);

    const toggleCollapsed = () => setCollapsed((current) => !current);

    return (
        <section
            className={`viewport__panel viewport__panel--shot ${compact ? 'camera-preview--collapsed' : ''}`}
            aria-label={t('机位视角')}
        >
            <div className={`shot-header ${floating ? 'camera-preview__chrome' : 'shot-header--overlay'} ${cameraMenuOpen ? 'is-menu-open' : ''}`}>
                {compact ? (
                    <Button
                        type="text"
                        className="camera-preview__expand"
                        aria-label={t('展开机位预览')}
                        aria-expanded={false}
                        icon={<ChevronDownIcon />}
                        onClick={toggleCollapsed}
                    >
                        {t('机位 · 实时预览')}
                    </Button>
                ) : (
                    <>
                        <Select
                            size="small"
                            variant="borderless"
                            value={preview}
                            aria-label={t('拍摄机位')}
                            onOpenChange={setCameraMenuOpen}
                            onChange={(value) => session.setPreview(value)}
                            options={[
                                { value: 'program', label: floating ? t('机位') : t('成片 · 按切镜') },
                                ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
                            ]}
                        />
                        {floating ? (
                            <Tooltip title={t('收起机位预览')}>
                                <Button
                                    type="text"
                                    className="camera-preview__collapse"
                                    aria-label={t('收起机位预览')}
                                    aria-expanded={true}
                                    icon={<ChevronUpIcon />}
                                    onClick={toggleCollapsed}
                                />
                            </Tooltip>
                        ) : (
                            <span className="shot-header__lens">{Number(lens.toFixed(1))} mm · {aspect}</span>
                        )}
                    </>
                )}
            </div>
            <div
                className="viewport__canvas viewport__canvas--shot"
                ref={canvasRef}
                onPointerDown={onInteract}
            >
                {children}
            </div>
            {!compact && view !== 'shot' && (
                <Button
                    className="camera-preview__split"
                    type="text"
                    aria-label={t(view === 'split' ? '退出分屏' : '分屏预览')}
                    onClick={() => session.setView(view === 'split' ? 'pip' : 'split')}
                >
                    {t(view === 'split' ? '退出分屏' : '分屏预览')}
                    <ArrowUpRightIcon />
                </Button>
            )}
        </section>
    );
}

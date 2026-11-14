import { ArrowUpRightIcon, ChevronDownIcon, GripVerticalIcon, ChevronUpIcon } from '@/shared/ui/icons.tsx';
import { Button, Select, Tooltip } from 'antd';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ViewMode } from '@/state/editor-store.ts';
import { session } from '@/state/editor-session.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';

type Position = { x: number; y: number };

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
    const panelRef = useRef<HTMLElement>(null);
    const [collapsed, setCollapsed] = useState(true);
    const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
    const [position, setPosition] = useState<Position | null>(null);
    const drag = useRef<{ pointer: number; start: Position; origin: Position } | null>(null);
    const floating = view === 'stage' || view === 'pip';
    const compact = floating && collapsed;

    useEffect(() => {
        if (view === 'pip') setCollapsed(false);
        else if (view === 'stage') setCollapsed(true);
    }, [view]);

    const panelPosition = (): Position => {
        const panel = panelRef.current!;
        const bounds = panel.getBoundingClientRect();
        const host = panel.parentElement!.getBoundingClientRect();
        return { x: bounds.left - host.left, y: bounds.top - host.top };
    };
    const constrain = (next: Position): Position => {
        const panel = panelRef.current!;
        const host = panel.parentElement!;
        return {
            x: Math.max(8, Math.min(next.x, host.clientWidth - panel.offsetWidth - 8)),
            y: Math.max(8, Math.min(next.y, host.clientHeight - panel.offsetHeight - 8)),
        };
    };
    // Clamp again when the viewport, side panels or the collapsed monitor change size.
    useEffect(() => {
        if (!floating || !panelRef.current) return;
        const panel = panelRef.current;
        const observer = new ResizeObserver(() => {
            setPosition((current) => {
                if (!current) return current;
                const next = constrain(current);
                return next.x === current.x && next.y === current.y ? current : next;
            });
        });
        observer.observe(panel);
        observer.observe(panel.parentElement!);
        return () => observer.disconnect();
    }, [floating]);

    const toggleCollapsed = () => {
        if (position) setPosition(constrain(position));
        setCollapsed((current) => !current);
    };

    return (
        <section
            ref={panelRef}
            className={`viewport__panel viewport__panel--shot ${compact ? 'camera-preview--collapsed' : ''}`}
            aria-label={t('机位视角')}
            style={floating && position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
        >
            <div className={`shot-header ${floating ? 'camera-preview__chrome' : 'shot-header--overlay'} ${cameraMenuOpen ? 'is-menu-open' : ''}`}>
                {floating && (
                    <button
                        type="button"
                        className="camera-preview__grip"
                        aria-label={t('拖动机位预览')}
                        title={t('拖动机位预览')}
                        onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            drag.current = {
                                pointer: event.pointerId,
                                start: { x: event.clientX, y: event.clientY }, origin: panelPosition(),
                            };
                        }}
                        onPointerMove={(event) => {
                            const current = drag.current;
                            if (!current || current.pointer !== event.pointerId) return;
                            setPosition(constrain({
                                x: current.origin.x + event.clientX - current.start.x,
                                y: current.origin.y + event.clientY - current.start.y,
                            }));
                        }}
                        onPointerUp={(event) => {
                            if (drag.current?.pointer === event.pointerId) drag.current = null;
                        }}
                        onLostPointerCapture={() => { drag.current = null; }}
                        onKeyDown={(event) => {
                            const step = event.shiftKey ? 30 : 10;
                            const delta: Record<string, Position> = {
                                ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
                                ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
                            };
                            if (!delta[event.key]) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const origin = panelPosition();
                            setPosition(constrain({ x: origin.x + delta[event.key].x, y: origin.y + delta[event.key].y }));
                        }}
                    >
                        <GripVerticalIcon />
                    </button>
                )}
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

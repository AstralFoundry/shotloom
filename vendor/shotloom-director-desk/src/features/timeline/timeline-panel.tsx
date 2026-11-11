import {
    CaretRightOutlined,
    PauseOutlined,
    ScissorOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    VerticalRightOutlined,
    MinusOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import { Button, Popover, Slider, Switch, Tooltip } from 'antd';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pathSections } from '@/core/clip-editing.ts';
import { clipLabel, type Clip, type Entity } from '@/core/model.ts';
import { timecode } from '@/shared/lib/format.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { NumberField } from '@/shared/ui/number-field.tsx';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject, useSelectedEntity } from '@/state/use-editor.ts';
import { beginClipDrag } from './clip-drag.ts';
import { CameraPresetPicker } from './preset-picker.tsx';

/** Leave a little head-room after the last clip so the ruler never feels clipped. */
const MIN_EXTENT = 8;
const MIN_ZOOM = 30;
const MAX_ZOOM = 800;
const TRACK_LABEL_WIDTH = 196;
const ZOOM_STEPS = [30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 800];
const TRACK_COLORS = ['#aa8be8', '#69bea9', '#d7ae70', '#7baee0', '#d58fa2', '#9fbd7c'];
const clipAccent = (action: Clip['action']): string => {
    if (action === 'idle') return '#a99ad4';
    if (action === 'walk' || action === 'run' || action === 'crawl') return '#66cbb1';
    if (action === 'sit' || action === 'standup' || action === 'crouch' || action === 'lie') return '#dfb970';
    if (action === 'wave' || action === 'point' || action === 'turn' || action === 'guard') return '#83b8eb';
    if (action === 'native' || action === 'retarget') return '#b3c9e9';
    return '#e79591';
};
const trackWidth = (viewport: number, zoom: number) =>
    TRACK_LABEL_WIDTH + Math.max(0, viewport - TRACK_LABEL_WIDTH) * (zoom / 100);

export function TimelinePanel({
    onHeightChange,
    onHeightReset,
}: {
    onHeightChange: (height: number) => void;
    onHeightReset: () => void;
}) {
    const t = useTranslation();
    const [zoom, setZoom] = useState(100);
    const bodyRef = useRef<HTMLDivElement>(null);
    const pendingZoomAnchor = useRef<{ fraction: number; x: number } | null>(null);
    const resizing = useRef<{ y: number; height: number } | null>(null);
    const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const playing = useEditorStore((state) => state.playing);
    const loop = useEditorStore((state) => state.loop);
    const selected = useEditorStore((state) => state.selected);
    const selectedEntity = useSelectedEntity();
    const tracks = project.entities.filter(
        (entity) => entity.kind !== 'prop' || entity.path !== null || entity.clips.length > 0,
    );
    const extent = Math.max(
        project.duration,
        time,
        MIN_EXTENT,
        ...tracks.flatMap((entity) => [
            ...entity.clips.map((clip) => clip.end),
            ...(entity.path ? pathSections(entity.path).map((section) => section.end) : []),
        ]),
    );
    const percent = (seconds: number) => `${(seconds / extent) * 100}%`;
    const ticks = rulerTicks(extent, zoom);
    const cameraName = (id: string) => project.entities.find((entity) => entity.id === id)?.name ?? '';
    const cutSpans = project.cuts.map((cut, index) => ({
        ...cut,
        index,
        end: project.cuts[index + 1]?.time ?? project.duration,
    }));

    const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        session.seek(((event.clientX - rect.left) / rect.width) * extent);
    };

    const scrubPlayhead = (clientX: number) => {
        const ruler = bodyRef.current?.querySelector('.lane--ruler');
        if (!ruler) return;
        const rect = ruler.getBoundingClientRect();
        session.seek(Math.max(0, Math.min(extent, ((clientX - rect.left) / rect.width) * extent)));
    };

    const zoomAt = (requested: number, pointerX?: number) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(requested / 5) * 5));
        const body = bodyRef.current;
        if (next === zoom || !body) return;
        const viewport = body.clientWidth;
        const width = trackWidth(viewport, zoom);
        const playheadX = TRACK_LABEL_WIDTH + (time / extent) * (width - TRACK_LABEL_WIDTH) - body.scrollLeft;
        const x =
            pointerX === undefined
                ? playheadX >= TRACK_LABEL_WIDTH && playheadX <= viewport
                    ? playheadX
                    : viewport / 2
                : Math.max(0, Math.min(viewport, pointerX - body.getBoundingClientRect().left));
        const fraction = Math.max(
            0,
            Math.min(1, (body.scrollLeft + x - TRACK_LABEL_WIDTH) / Math.max(1, width - TRACK_LABEL_WIDTH)),
        );
        pendingZoomAnchor.current = { fraction, x };
        setZoom(next);
    };

    const stepZoom = (direction: -1 | 1) => {
        const next =
            direction < 0
                ? [...ZOOM_STEPS].reverse().find((value) => value < zoom)
                : ZOOM_STEPS.find((value) => value > zoom);
        zoomAt(next ?? (direction < 0 ? MIN_ZOOM : MAX_ZOOM));
    };

    useLayoutEffect(() => {
        const anchor = pendingZoomAnchor.current;
        const body = bodyRef.current;
        if (!anchor || !body) return;
        const width = trackWidth(body.clientWidth, zoom);
        body.scrollLeft = TRACK_LABEL_WIDTH + anchor.fraction * (width - TRACK_LABEL_WIDTH) - anchor.x;
        pendingZoomAnchor.current = null;
    }, [zoom]);

    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            zoomAt(zoom * (event.deltaY < 0 ? 1.25 : 0.8), event.clientX);
        };
        body.addEventListener('wheel', onWheel, { passive: false });
        return () => body.removeEventListener('wheel', onWheel);
    }, [zoom, time, extent]);

    const resizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const height = event.currentTarget.parentElement?.clientHeight ?? 260;
        resizing.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const resizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!resizing.current) return;
        const max = Math.max(180, window.innerHeight - 48 - 160);
        onHeightChange(Math.max(180, Math.min(max, resizing.current.height + resizing.current.y - event.clientY)));
    };
    const resizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        resizing.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
    };

    return (
        <section className="timeline" aria-label={t('时间线')}>
            <div
                className="timeline__resize-handle"
                role="separator"
                aria-label={t('调整时间线高度')}
                aria-orientation="horizontal"
                tabIndex={0}
                title={t('拖动调整时间线高度，双击恢复')}
                onPointerDown={resizeStart}
                onPointerMove={resizeMove}
                onPointerUp={resizeEnd}
                onPointerCancel={resizeEnd}
                onDoubleClick={onHeightReset}
                onKeyDown={(event) => {
                    if (event.key === 'Home') onHeightReset();
                    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        const height = event.currentTarget.parentElement?.clientHeight ?? 260;
                        const max = Math.max(180, window.innerHeight - 48 - 160);
                        onHeightChange(Math.max(180, Math.min(max, height + (event.key === 'ArrowUp' ? 24 : -24))));
                    }
                }}
            />
            <div className="timeline__transport">
                <div className="timeline__controls">
                    <Button
                        aria-label={t('缩小时间轴')}
                        icon={<MinusOutlined />}
                        onClick={() => stepZoom(-1)}
                        disabled={zoom === MIN_ZOOM}
                    />
                    <Popover
                        trigger="click"
                        placement="topLeft"
                        content={
                            <div className="timeline__zoom-popup">
                                <Slider
                                    min={MIN_ZOOM}
                                    max={MAX_ZOOM}
                                    step={5}
                                    value={zoom}
                                    onChange={(value) => zoomAt(value)}
                                />
                                <div className="timeline__zoom-popup-footer">
                                    <span>
                                        {zoom}% · {t('Ctrl/⌘ 滚轮缩放')}
                                    </span>
                                    <Button size="small" type="text" onClick={() => zoomAt(100)}>
                                        {t('适合窗口')}
                                    </Button>
                                </div>
                            </div>
                        }
                    >
                        <Button className="timeline__zoom-value" aria-label={t('设置时间轴缩放')}>
                            {zoom}%
                        </Button>
                    </Popover>
                    <Button
                        aria-label={t('放大时间轴')}
                        icon={<PlusOutlined />}
                        onClick={() => stepZoom(1)}
                        disabled={zoom === MAX_ZOOM}
                    />
                    <Tooltip title={t('回到开头')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<VerticalRightOutlined />}
                            aria-label={t('回到开头')}
                            onClick={() => session.seek(0)}
                        />
                    </Tooltip>
                    <Tooltip title={t('上一帧')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<StepBackwardOutlined />}
                            aria-label={t('上一帧')}
                            onClick={() => session.stepFrame(-1)}
                        />
                    </Tooltip>
                    <Button
                        type="text"
                        size="small"
                        className="timeline__play"
                        icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                        aria-label={playing ? t('暂停') : t('播放')}
                        onClick={() => session.togglePlay()}
                    />
                    <Tooltip title={t('下一帧')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<StepForwardOutlined />}
                            aria-label={t('下一帧')}
                            onClick={() => session.stepFrame(1)}
                        />
                    </Tooltip>
                    <Tooltip title={t('在播放头切镜')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<ScissorOutlined />}
                            aria-label={t('在播放头切镜')}
                            onClick={() => session.addCutAtPlayhead()}
                        />
                    </Tooltip>
                    {/* Frame-exact readout: at 24 fps "4.0s" cannot express where a cut lands,
                        so the primary readout is timecode and the seconds stay on hover. */}
                    <span
                        className="timecode"
                        title={`${time.toFixed(2)}s / ${project.duration.toFixed(2)}s · ${project.fps} fps`}
                    >
                        {timecode(time, project.fps)} <span>/ {timecode(project.duration, project.fps)}</span>
                    </span>
                </div>

                <div className="timeline__meta">
                    <Button
                        className="timeline__add"
                        icon={<PlusOutlined />}
                        disabled={!selectedEntity || selectedEntity.locked}
                        onClick={() => session.startPath()}
                    >
                        {t('添加路径')}
                    </Button>
                    {selectedEntity?.kind === 'camera' ? (
                        <Popover
                            trigger="click"
                            placement="top"
                            open={cameraPickerOpen}
                            onOpenChange={setCameraPickerOpen}
                            content={
                                <CameraPresetPicker
                                    onChoose={(id) => {
                                        if (session.applyCameraPreset(id)) setCameraPickerOpen(false);
                                    }}
                                />
                            }
                        >
                            <Button
                                className="timeline__add"
                                icon={<PlusOutlined />}
                                type="primary"
                                disabled={selectedEntity.locked}
                            >
                                {t('预设运镜')}
                            </Button>
                        </Popover>
                    ) : selectedEntity?.kind === 'actor' || selectedEntity?.kind === 'crowd' ? (
                        <Button
                            className="timeline__add"
                            icon={<PlusOutlined />}
                            type="primary"
                            disabled={selectedEntity.locked}
                            onClick={() => session.setInspectorTab('actions')}
                        >
                            {t('角色动画')}
                        </Button>
                    ) : null}
                    <label className="duration-input">
                        {t('时长')}
                        <NumberField
                            value={project.duration}
                            min={0.1}
                            step={1}
                            precision={1}
                            aria-label={t('时长')}
                            onCommit={(value) => session.setDuration(value)}
                        />
                        {t('秒')}
                    </label>
                    <label className="inline">
                        <Switch size="small" checked={loop} onChange={(checked) => session.setLoop(checked)} />
                        {t('循环')}
                    </label>
                    <span className="muted">
                        {t('时间轴')} · {project.fps} fps
                    </span>
                </div>
            </div>

            <div className="timeline__body" ref={bodyRef}>
                <div
                    className="timeline__tracks"
                    style={{ width: `calc(${zoom}% + ${TRACK_LABEL_WIDTH * (1 - zoom / 100)}px)` }}
                >
                    <div className="timeline__ruler-row">
                        <span className="track-label">
                            {t('轨道')} <small>{project.fps} fps</small>
                        </span>
                        <div className="lane lane--ruler" onPointerDown={seekFromPointer}>
                            {ticks.map((tick) => (
                                <span className="lane__tick" key={tick} style={{ left: percent(tick) }}>
                                    {tick.toFixed(Number.isInteger(tick) ? 0 : 1)}s
                                </span>
                            ))}
                            <i className="lane__end" style={{ left: percent(project.duration) }} />
                        </div>
                    </div>

                    {project.cuts.length > 1 ? (
                        <div className="timeline__row timeline__row--cuts">
                            <span className="track-label">
                                {t('切镜')}{' '}
                                <small>
                                    {project.cuts.length} {t('段')}
                                </small>
                            </span>
                            <div className="lane lane--cuts" onPointerDown={seekFromPointer}>
                                {cutSpans.map((cut) => (
                                    <div
                                        key={`${cut.time}-${cut.index}`}
                                        className="clip clip--cut"
                                        style={{
                                            left: percent(cut.time),
                                            width: `${Math.max(((cut.end - cut.time) / extent) * 100, 0.6)}%`,
                                        }}
                                        onPointerDown={(event) => {
                                            event.stopPropagation();
                                            session.selectEntity(cut.cameraId);
                                            beginClipDrag(
                                                event,
                                                { kind: 'cut', index: cut.index },
                                                {
                                                    extent,
                                                    fps: project.fps,
                                                    onTap: () => session.seek(cut.time),
                                                },
                                            );
                                        }}
                                        title={`${cameraName(cut.cameraId)} · ${cut.time.toFixed(2)}s`}
                                    >
                                        <span>{cameraName(cut.cameraId)}</span>
                                        {cut.index > 0 ? (
                                            <i
                                                role="button"
                                                aria-label={t('删除切镜')}
                                                className="clip__remove"
                                                title={t('删除切镜')}
                                                onPointerDown={(event) => {
                                                    event.stopPropagation();
                                                    session.removeCut(cut.index);
                                                }}
                                            >
                                                ×
                                            </i>
                                        ) : null}
                                        <i className="clip__handle" data-resize="true" aria-hidden="true" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {tracks.map((entity, index) => (
                        <Fragment key={entity.id}>
                            <div
                                className="timeline__row"
                                style={
                                    {
                                        '--track-accent': TRACK_COLORS[index % TRACK_COLORS.length],
                                    } as React.CSSProperties
                                }
                            >
                                <button
                                    type="button"
                                    className={`track-label track-label--button ${entity.id === selected ? 'is-selected' : ''}`}
                                    onClick={() => session.selectEntity(entity.id)}
                                >
                                    <i
                                        className="track-label__dot"
                                        style={{
                                            background:
                                                entity.kind === 'camera'
                                                    ? '#a1aab8'
                                                    : TRACK_COLORS[index % TRACK_COLORS.length],
                                        }}
                                    />
                                    <span title={entity.name}>{entity.name}</span>
                                    <small>{entity.kind === 'camera' ? t('运镜') : t('动作')}</small>
                                </button>
                                <div className="lane" onPointerDown={seekFromPointer}>
                                    <EntityLane entity={entity} extent={extent} fps={project.fps} />
                                </div>
                            </div>
                            {entity.path ? (
                                <div
                                    className="timeline__row"
                                    style={
                                        {
                                            '--track-accent': TRACK_COLORS[index % TRACK_COLORS.length],
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="track-label track-label--sub">{t('运动路径')}</span>
                                    <div className="lane" onPointerDown={seekFromPointer}>
                                        <PathLane entity={entity} extent={extent} fps={project.fps} />
                                    </div>
                                </div>
                            ) : null}
                        </Fragment>
                    ))}
                    <div
                        className="timeline__playhead"
                        style={{
                            left: `calc(${(time / extent) * 100}% + ${TRACK_LABEL_WIDTH * (1 - time / extent)}px)`,
                        }}
                    >
                        <button
                            type="button"
                            role="slider"
                            className="timeline__playhead-handle"
                            aria-label={t('拖动播放头')}
                            aria-valuemin={0}
                            aria-valuemax={extent}
                            aria-valuenow={Number(time.toFixed(2))}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                    event.preventDefault();
                                    session.stepFrame(event.key === 'ArrowLeft' ? -1 : 1);
                                } else if (event.key === 'Home' || event.key === 'End') {
                                    event.preventDefault();
                                    session.seek(event.key === 'Home' ? 0 : project.duration);
                                }
                            }}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                event.currentTarget.setPointerCapture(event.pointerId);
                                scrubPlayhead(event.clientX);
                            }}
                            onPointerMove={(event) => {
                                if (event.currentTarget.hasPointerCapture(event.pointerId))
                                    scrubPlayhead(event.clientX);
                            }}
                            onPointerUp={(event) => {
                                if (event.currentTarget.hasPointerCapture(event.pointerId))
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                            }}
                            onPointerCancel={(event) => {
                                if (event.currentTarget.hasPointerCapture(event.pointerId))
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                            }}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

/** Round ruler steps (1/2/5 × 10ⁿ) so labels stay readable at any duration. */
function rulerTicks(extent: number, zoom: number): number[] {
    const target = (10 * zoom) / 100;
    const raw = extent / target;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
    const step =
        [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => extent / candidate <= target * 1.2) ??
        magnitude * 10;
    const ticks: number[] = [];
    for (let tick = 0; tick <= extent + 1e-9; tick += step) ticks.push(Number(tick.toFixed(6)));
    return ticks;
}

function PathLane({ entity, extent, fps }: { entity: Entity; extent: number; fps: number }) {
    const t = useTranslation();
    const selectedPathSection = useEditorStore((state) => state.selectedPathSection);
    if (!entity.path) return null;
    const sections = pathSections(entity.path);
    if (!sections.length)
        return (
            <span className="clip clip--path" style={{ left: 0, width: '100%' }}>
                {t('路径')}
            </span>
        );
    return (
        <>
            {sections.map((section, index) => (
                <button
                    type="button"
                    key={index}
                    className={`clip clip--path ${selectedPathSection?.entityId === entity.id && selectedPathSection.index === index ? 'is-selected' : ''}`}
                    aria-pressed={selectedPathSection?.entityId === entity.id && selectedPathSection.index === index}
                    style={{
                        left: `${(section.start / extent) * 100}%`,
                        width: `${Math.max(((section.end - section.start) / extent) * 100, 0.6)}%`,
                    }}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        session.selectEntity(entity.id);
                        session.selectPathSection(entity.id, index);
                        useEditorStore.getState().patch({ inspectorTab: 'path' });
                        beginClipDrag(
                            event,
                            { kind: 'path', entityId: entity.id, index },
                            {
                                extent,
                                fps,
                                onTap: () => session.seek(section.start),
                            },
                        );
                    }}
                    onClick={(event) => {
                        if (event.detail !== 0) return;
                        session.selectEntity(entity.id);
                        session.selectPathSection(entity.id, index);
                        useEditorStore.getState().patch({ inspectorTab: 'path' });
                    }}
                >
                    {entity.kind === 'camera' ? t('运镜') : t('路径')} {index + 1}
                    <i className="clip__handle" data-resize="true" aria-hidden="true" />
                </button>
            ))}
        </>
    );
}

function EntityLane({ entity, extent, fps }: { entity: Entity; extent: number; fps: number }) {
    const t = useTranslation();
    const selectedClipId = useEditorStore((state) => state.selectedClipId);
    if (entity.kind === 'camera')
        return (
            <span className="clip clip--camera" style={{ left: 0, width: '100%' }}>
                {t('固定机位')}
            </span>
        );
    return (
        <>
            {entity.clips.map((clip) => (
                <button
                    type="button"
                    key={clip.id}
                    className={`clip ${clip.id === selectedClipId ? 'is-selected' : ''}`}
                    style={
                        { ...spanFor(clip, extent), '--clip-accent': clipAccent(clip.action) } as React.CSSProperties
                    }
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        session.selectEntity(entity.id);
                        session.selectClip(clip.id);
                        useEditorStore.getState().patch({ inspectorTab: 'actions' });
                        beginClipDrag(
                            event,
                            { kind: 'action', entityId: entity.id, id: clip.id },
                            {
                                extent,
                                fps,
                                onTap: () => session.seek(clip.start),
                            },
                        );
                    }}
                    title={clipLabel(clip)}
                >
                    <span>
                        {clipLabel(clip)} <small>{(clip.end - clip.start).toFixed(1)}s</small>
                    </span>
                    <i className="clip__handle" data-resize="true" aria-hidden="true" />
                </button>
            ))}
        </>
    );
}

function spanFor(item: Clip | Entity, extent: number): React.CSSProperties {
    const start = typeof (item as Clip).start === 'number' ? (item as Clip).start : 0;
    const end = typeof (item as Clip).end === 'number' ? (item as Clip).end : extent;
    return {
        left: `${(start / extent) * 100}%`,
        width: `${Math.max(((end - start) / extent) * 100, 0.6)}%`,
    };
}

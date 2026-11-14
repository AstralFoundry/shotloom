import {
    CaretRightOutlined,
    LockOutlined,
    UnlockOutlined,
    PauseOutlined,
    ScissorOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    VerticalRightOutlined,
    MinusOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import { Button, Popover, Select, Slider, Switch, Tooltip } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pathSections } from '@/core/clip-editing.ts';
import { clipLabel, FRAME_RATES, type Clip, type Entity } from '@/core/model.ts';
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
    onNaturalHeight,
}: {
    onHeightChange: (height: number) => void;
    onHeightReset: () => void;
    onNaturalHeight?: (height: number) => void;
}) {
    const t = useTranslation();
    const [zoom, setZoom] = useState(100);
    const bodyRef = useRef<HTMLDivElement>(null);
    const transportRef = useRef<HTMLDivElement>(null);
    const tracksRef = useRef<HTMLDivElement>(null);
    const [bodyWidth, setBodyWidth] = useState(0);
    const pendingZoomAnchor = useRef<{ fraction: number; x: number } | null>(null);
    const playheadGrabOffset = useRef(0);
    const resizing = useRef<{ y: number; height: number } | null>(null);
    const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const playing = useEditorStore((state) => state.playing);
    const loop = useEditorStore((state) => state.loop);
    const selected = useEditorStore((state) => state.selected);
    const selectedEntity = useSelectedEntity();
    const [trackFilter, setTrackFilter] = useState('all');
    const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
    const tracks = project.entities.filter(e => trackFilter === 'all' || (trackFilter === 'selected' ? e.id === selected || e.camera?.targetId === selected : Boolean(e.path || e.rotationAnimation || e.clips.length)));
    const trackGroups = [{ id: 'actor', name: '角色' }, { id: 'camera', name: '机位' }, { id: 'light', name: '灯光' }, { id: 'prop', name: '道具' }];
    const groupOf = (e: Entity) => e.kind === 'actor' || e.kind === 'crowd' ? 'actor' : e.kind === 'camera' ? 'camera' : e.light ? 'light' : 'prop';
    const extent = Math.max(
        project.duration,
        time,
        MIN_EXTENT,
        ...tracks.flatMap((entity) => [
            ...entity.clips.map((clip) => clip.end),
            ...(entity.path ? pathSections(entity.path).map((section) => section.end) : []),
            ...(entity.rotationAnimation ? entity.rotationAnimation.keys.map((key) => key.time) : []),
            ...(entity.camera?.focalKeys?.map((key) => key.time) ?? []),
            ...(entity.light && typeof entity.light.intensity !== 'number' ? entity.light.intensity.keys.map((key) => key.time) : []),
            ...(entity.light?.colorKeys?.map((key) => key.time) ?? []),
        ]),
    );
    const percent = (seconds: number) => `${(seconds / extent) * 100}%`;
    const laneWidth = Math.max(0, trackWidth(bodyWidth, zoom) - TRACK_LABEL_WIDTH);
    const ticks = rulerTicks(extent, zoom, laneWidth);
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
        session.seek(Math.max(0, Math.min(extent, ((clientX - playheadGrabOffset.current - rect.left) / rect.width) * extent)));
    };

    const seekAndReveal = (seconds: number) => {
        session.seek(seconds);
        const body = bodyRef.current;
        if (!body) return;
        const x = TRACK_LABEL_WIDTH + (seconds / extent) * (trackWidth(body.clientWidth, zoom) - TRACK_LABEL_WIDTH);
        if (x < body.scrollLeft + TRACK_LABEL_WIDTH || x > body.scrollLeft + body.clientWidth - 14)
            body.scrollLeft = x - TRACK_LABEL_WIDTH;
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

    // Ruler density follows the visible lane width, and the shell auto-fits the default
    // panel height to the transport + tracks so two tracks no longer sit in 380px of air.
    useEffect(() => {
        const body = bodyRef.current;
        const transport = transportRef.current;
        const tracks = tracksRef.current;
        if (!body || !transport || !tracks) return;
        const measure = () => {
            setBodyWidth(body.clientWidth);
            onNaturalHeight?.(transport.offsetHeight + tracks.offsetHeight);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        observer.observe(transport);
        observer.observe(tracks);
        return () => observer.disconnect();
    }, [onNaturalHeight]);

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
            <div className="timeline__transport" ref={transportRef}>
                <div className="timeline__controls">
                    <Select size="small" aria-label={t('轨道筛选')} value={trackFilter} onChange={setTrackFilter} options={[{ value: 'all', label: t('全部轨道') }, { value: 'selected', label: t('选中及关联机位') }, { value: 'animated', label: t('有动画') }]} />
                    <Button
                        className="timeline__zoom-step"
                        type="text"
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
                        className="timeline__zoom-step"
                        type="text"
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
                            onClick={() => seekAndReveal(0)}
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
                                    hasSubject={project.entities.some(entity => entity.kind === 'actor' || entity.id === selectedEntity.camera?.targetId)}
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
                    <Select
                        className="timeline__fps"
                        size="small"
                        value={project.fps}
                        aria-label={t('项目帧率')}
                        onChange={(fps) => session.updateProjectSettings({ fps })}
                        options={FRAME_RATES.map((value) => ({ value, label: `${value} fps` }))}
                        popupMatchSelectWidth={96}
                    />
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
                    <label className="timeline__loop">
                        <Switch size="small" aria-label={t('循环')} checked={loop} onChange={(checked) => session.setLoop(checked)} />
                        {t('循环')}
                    </label>
                </div>
            </div>

            <div className="timeline__body" ref={bodyRef}>
                <div
                    className="timeline__tracks"
                    ref={tracksRef}
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

                    {trackGroups.map(group => {
                        const items = tracks.filter(e => groupOf(e) === group.id);
                        if (!items.length) return null;
                        const collapsed = collapsedGroups.includes(group.id);
                        return <div key={group.id}>
                            <button className="timeline__type-heading" aria-expanded={!collapsed} onClick={() => setCollapsedGroups(collapsed ? collapsedGroups.filter(id => id !== group.id) : [...collapsedGroups, group.id])}>{collapsed ? '▸' : '▾'} {t(group.name)} · {items.length}</button>
                            {!collapsed && items.map((entity, index) => <EntityTracks key={entity.id} entity={entity} index={index} selected={entity.id === selected} extent={extent} fps={project.fps} onSeek={seekFromPointer} />)}
                        </div>;
                    })}
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
                                    seekAndReveal(event.key === 'Home' ? 0 : project.duration);
                                }
                            }}
                            onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.stopPropagation();
                                const rect = event.currentTarget.parentElement!.getBoundingClientRect();
                                playheadGrabOffset.current = event.clientX - rect.left;
                                event.currentTarget.setPointerCapture(event.pointerId);
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

/** Object-first hierarchy; property rows retain the existing editing tools. */
function EntityTracks({ entity, index, selected, extent, fps, onSeek }: {
    entity: Entity; index: number; selected: boolean; extent: number; fps: number;
    onSeek: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
    const t = useTranslation();
    const [expanded, setExpanded] = useState<boolean | null>(null);
    const [transformOpen, setTransformOpen] = useState(true);
    const [parametersOpen, setParametersOpen] = useState(true);
    const open = expanded ?? selected;
    const actor = entity.kind === 'actor' || entity.kind === 'crowd';
    const selectTab = (tab: 'base' | 'keys' | 'path' | 'actions' | 'light') => {
        session.selectEntity(entity.id);
        session.setInspectorTab(tab);
    };
    const vector = (values: number[]) => values.map(value => Number(value.toFixed(2))).join(' / ');
    const row = (label: string, content: React.ReactNode, depth = 2, tab: 'base' | 'keys' | 'path' | 'actions' | 'light' = 'base') => (
        <div className="timeline__row timeline__row--property" key={label}>
            <button type="button" className="track-label track-label--button track-label--property"
                style={{ paddingLeft: 16 + depth * 16 }} onClick={() => selectTab(tab)}>{label}</button>
            <div className="lane" onPointerDown={onSeek}>{content}</div>
        </div>
    );
    const value = (text: string, tab: 'base' | 'keys' | 'light' = 'base') => (
        <button type="button" className="lane__property-value" onPointerDown={event => event.stopPropagation()}
            onClick={() => selectTab(tab)}>{text}</button>
    );
    const group = (label: string, isOpen: boolean, toggle: () => void) => (
        <div className="timeline__row timeline__row--group">
            <button type="button" className="track-label track-label--button track-label--group"
                aria-label={label} aria-expanded={isOpen} onClick={toggle}>
                <CaretRightOutlined className={isOpen ? 'track-label__chevron is-open' : 'track-label__chevron'} />{label}
            </button>
            <div className="lane" onPointerDown={onSeek} />
        </div>
    );
    const numberKeys = (keys: Array<{ time: number; value: number | string }>, tab: 'keys' | 'light' = 'keys') => keys.map((key, i) => (
        <button type="button" key={`${key.time}-${i}`} className="lane__parameter-key"
            style={{ left: `${key.time / extent * 100}%` }} title={`${key.time.toFixed(2)}s · ${key.value}`}
            aria-label={`${t('关键帧')} ${key.time.toFixed(2)}s · ${key.value}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => { selectTab(tab); session.seek(key.time); }} />
    ));
    return (
        <div className={`timeline__object ${selected ? 'is-selected' : ''}`}
            style={{ '--track-accent': TRACK_COLORS[index % TRACK_COLORS.length] } as React.CSSProperties}>
            <div className="timeline__row timeline__row--object">
                <div className={`track-label track-label--object ${selected ? 'is-selected' : ''}`}>
                    <button type="button" className="track-label__expand" aria-label={`${t(open ? '折叠轨道' : '展开轨道')} · ${entity.name}`}
                        aria-expanded={open} onClick={() => setExpanded(!open)}>
                        <CaretRightOutlined className={open ? 'track-label__chevron is-open' : 'track-label__chevron'} />
                    </button>
                    <i className="track-label__dot" style={{ background: entity.color }} />
                    <button type="button" className="track-label__name"
                        title={`${entity.name} · ${entity.kind === 'camera' ? t('机位') : actor ? t('角色') : entity.light ? t('灯光') : t('道具')}`}
                        onClick={() => session.selectEntity(entity.id)}>{entity.name}</button>
                    <button type="button" className="track-label__lock" aria-label={`${t(entity.locked ? '解锁' : '锁定')} · ${entity.name}`}
                        aria-pressed={entity.locked} onClick={() => {
                            session.selectEntity(entity.id);
                            session.setEntityFlag('locked', !entity.locked);
                        }}>{entity.locked ? <LockOutlined /> : <UnlockOutlined />}</button>
                </div>
                <div className="lane lane--object" onPointerDown={onSeek} />
            </div>
            {open && <>
                {group(t('变换'), transformOpen, () => setTransformOpen(!transformOpen))}
                {transformOpen && <>
                    {row(t('位置'), entity.path ? <PathLane entity={entity} extent={extent} fps={fps} /> : value(vector(entity.position)), 2, entity.path ? 'path' : 'base')}
                    {row(t('旋转'), entity.rotationAnimation ? <RotationLane entity={entity} extent={extent} fps={fps} /> : value(`${vector(entity.rotation.map(angle => angle * 180 / Math.PI))}°`), 2, entity.rotationAnimation ? 'keys' : 'base')}
                    {row(t('缩放'), value(vector(entity.scale)))}
                </>}
                {(actor || entity.clips.length > 0) && row(t('动作'), <EntityLane entity={entity} extent={extent} fps={fps} />, 1, 'actions')}
                {entity.camera && <>
                    {group(t('镜头参数'), parametersOpen, () => setParametersOpen(!parametersOpen))}
                    {parametersOpen && row(t('焦距'), entity.camera.focalKeys?.length
                        ? numberKeys(entity.camera.focalKeys) : value(`${entity.camera.focal} mm`, 'keys'), 2, 'keys')}
                </>}
                {entity.light && <>
                    {group(t('灯光参数'), parametersOpen, () => setParametersOpen(!parametersOpen))}
                    {parametersOpen && <>
                        {row(t('强度'), typeof entity.light.intensity === 'number'
                            ? value(String(entity.light.intensity), 'light') : numberKeys(entity.light.intensity.keys, 'light'), 2, 'light')}
                        {row(t('颜色'), entity.light.colorKeys?.length ? numberKeys(entity.light.colorKeys.map(key => ({ time: key.time, value: key.color })), 'light') : value(entity.color, 'light'), 2, 'light')}
                    </>}
                </>}
            </>}
        </div>
    );
}

/** Round ruler steps (1/2/5 × 10ⁿ) so labels stay readable at any duration and width. */
function rulerTicks(extent: number, zoom: number, laneWidth: number): number[] {
    // Zoom asks for ~10 ticks per screen, but a narrow lane can only legibly hold one
    // label per ~64px; thin the ticks to whichever budget is smaller.
    const widthTarget = laneWidth > 0 ? Math.max(2, Math.floor(laneWidth / 64)) : Infinity;
    const target = Math.min((10 * zoom) / 100, widthTarget);
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

function RotationLane({ entity, extent, fps }: { entity: Entity; extent: number; fps: number }) {
    const t = useTranslation();
    const animation = entity.rotationAnimation;
    if (!animation) return null;
    const first = animation.keys[0];
    const last = animation.keys[animation.keys.length - 1];
    const showKey = (at: number) => {
        session.selectEntity(entity.id);
        session.seek(at);
        session.setInspectorTab('keys');
    };
    return (
        <div
            className="clip clip--rotation"
            style={{ left: `${(first.time / extent) * 100}%`, width: `${((last.time - first.time) / extent) * 100}%` }}
            title={`${t('旋转')} · ${first.time.toFixed(2)}s → ${last.time.toFixed(2)}s`}
            onPointerDown={(event) => {
                event.stopPropagation();
                session.selectEntity(entity.id);
                beginClipDrag(event, { kind: 'rotation', entityId: entity.id }, {
                    extent, fps, onTap: () => showKey(first.time),
                });
            }}
        >
            <span>{t('旋转')} · {first.time.toFixed(1)}–{last.time.toFixed(1)}s</span>
            {animation.keys.map((key, index) => (
                <button
                    type="button"
                    key={`${key.time}-${index}`}
                    className="clip--rotation__key"
                    style={{ left: `${((key.time - first.time) / (last.time - first.time)) * 100}%` }}
                    title={`${key.time.toFixed(2)}s · ${key.degrees.join(', ')}°`}
                    aria-label={`${key.time.toFixed(2)}s · ${key.degrees.join(', ')}°`}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        session.selectEntity(entity.id);
                        beginClipDrag(event, { kind: 'rotation', entityId: entity.id, keyIndex: index }, {
                            extent, fps, onTap: () => showKey(key.time),
                        });
                    }}
                    onClick={(event) => {
                        if (event.detail !== 0) return;
                        showKey(key.time);
                    }}
                />
            ))}
        </div>
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
                    {clip.start > 0 && <span className="clip__blend" style={{ width: `${Math.min(100, (clip.blendIn ?? entity.actionBlend ?? 0.2) / (clip.end - clip.start) * 100)}%`, minWidth: 24 }} onPointerDown={event => event.stopPropagation()}>
                        <input type="range" aria-label={t('动作过渡 / 秒')} title={`${(clip.blendIn ?? entity.actionBlend ?? 0.2).toFixed(2)}s`} min={0} max={Math.min(2, clip.end - clip.start)} step={0.05} value={clip.blendIn ?? entity.actionBlend ?? 0.2} disabled={entity.locked} onChange={event => { session.selectEntity(entity.id); session.setClipField(clip.id, { blendIn: Number(event.target.value) }); }} />
                    </span>}
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

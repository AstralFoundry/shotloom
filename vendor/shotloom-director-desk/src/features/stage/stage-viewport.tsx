import { editorPreferences } from '@/core/editor/preferences.ts';
import {
    AimOutlined,
    BorderOutlined,
    BranchesOutlined,
    CameraOutlined,
    DragOutlined,
    ExpandOutlined,
    EyeOutlined,
    HomeOutlined,
    RotateRightOutlined,
} from '@ant-design/icons';
import { Button, Popover, Select, Switch, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { activeCameraId } from '@/core/timeline.ts';
import { numberAt } from '@/core/animation/channels.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { ObjectLabels } from './object-labels.tsx';
import { FramingGuides } from './framing-guides.tsx';
import { PreviousShotOverlay } from './previous-shot-overlay.tsx';
import { StageContextMenu, type ContextMenuTarget } from './stage-context-menu.tsx';
import { session } from '@/state/editor-session.ts';
import { useEditorStore, type TransformMode } from '@/state/editor-store.ts';
import { useProject, useSelectedEntity } from '@/state/use-editor.ts';
import { usePreferences } from '@/state/use-preferences.ts';

const TOOL_MODES: Array<{ mode: TransformMode; label: string; icon: React.ReactNode; shortcut: string }> = [
    { mode: 'translate', label: '移动', icon: <DragOutlined />, shortcut: '1' },
    { mode: 'rotate', label: '旋转', icon: <RotateRightOutlined />, shortcut: '2' },
    { mode: 'scale', label: '缩放', icon: <ExpandOutlined />, shortcut: '3' },
];

/** The only place the three.js engine is mounted. React owns the frame around it. */
export function StageViewport() {
    const t = useTranslation();
    const project = useProject();
    const effects = usePreferences();
    const [pip, setPip] = useState(true);
    const view = useEditorStore((state) => state.view);
    const preview = useEditorStore((state) => state.preview);
    const time = useEditorStore((state) => state.time);
    const transformMode = useEditorStore((state) => state.transformMode);
    const gridVisible = useEditorStore((state) => state.gridVisible);
    const pathDraft = useEditorStore((state) => state.pathDraft);
    const pathDrawMode = useEditorStore((state) => state.pathDrawMode);
    const pathSurfaceMode = useEditorStore((state) => state.pathSurfaceMode);
    const preferences = usePreferences();
    const selectedEntity = useSelectedEntity();
    const draftEntity = pathDraft ? project.entities.find((entity) => entity.id === pathDraft) : undefined;
    const stageRef = useRef<HTMLDivElement>(null);
    const shotRef = useRef<HTMLDivElement>(null);
    const [menu, setMenu] = useState<ContextMenuTarget | null>(null);
    const [stageHintIdle, setStageHintIdle] = useState(false);
    const [shotHintIdle, setShotHintIdle] = useState(false);

    useEffect(() => {
        const stage = stageRef.current;
        const shot = shotRef.current;
        if (!stage || !shot) return;
        session.attachEngine(stage, shot);
        return () => {
            session.detachEngine();
        };
    }, []);

    // Navigation hints are for the first encounter; once the user steers the view (or
    // after a grace period) they fade so they stop covering the scene. Path-drawing
    // instructions stay visible for as long as the draft is active.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setStageHintIdle(true);
            setShotHintIdle(true);
        }, 8000);
        return () => window.clearTimeout(timer);
    }, []);

    const cameras = project.entities.filter((entity) => entity.kind === 'camera');
    const shotCameraId = preview === 'program' ? activeCameraId(project, time) : preview;
    const shotCamera = project.entities.find((entity) => entity.id === shotCameraId);
    const lens = shotCamera?.camera
        ? shotCamera.camera.focalKeys
            ? numberAt({ keys: shotCamera.camera.focalKeys }, time)
            : shotCamera.camera.focal
        : 40;

    return (
        <div className={`viewport viewport--${view}${pip && view === "stage" ? " viewport--pip" : ""}`}>
            <section className="viewport__panel viewport__panel--stage" aria-label={t('导演视角')}>
                <div
                    className="viewport__stage-frame"
                    onPointerDown={() => setStageHintIdle(true)}
                    onContextMenu={(event) => {
                        const engine = session.engineOrNull;
                        if (!engine) return;
                        const id = engine.entityAt(event.clientX, event.clientY);
                        if (!id) {
                            setMenu(null);
                            return;
                        }
                        event.preventDefault();
                        session.selectEntity(id);
                        const frame = event.currentTarget.getBoundingClientRect();
                        setMenu({ entityId: id, x: event.clientX - frame.left, y: event.clientY - frame.top });
                    }}
                >
                    <div className="viewport__canvas" ref={stageRef} />
                    <ObjectLabels
                        onContextMenu={(id, event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const frame = event.currentTarget
                                .closest('.viewport__stage-frame')
                                ?.getBoundingClientRect();
                            session.selectEntity(id);
                            if (frame) {
                                setMenu({
                                    entityId: id,
                                    x: event.clientX - frame.left,
                                    y: event.clientY - frame.top,
                                });
                            }
                        }}
                    />
                    <StageContextMenu target={menu} onClose={() => setMenu(null)} />
                </div>
                <div className={`viewport__hint ${!pathDraft && stageHintIdle ? 'is-idle' : ''}`}>
                    {pathDraft
                        ? pathDrawMode === 'freehand'
                            ? t('按住左键画路线 · 松开可续画 · Enter 完成 · Esc 取消')
                            : pathSurfaceMode === 'surface'
                              ? t('点击台阶、平台或地面添加路线点 · Enter 完成 · Esc 取消')
                              : t('按地面平面画路线 · Enter 完成 · Esc 取消')
                        : t('拖动鼠标观察 · 点击布景后 WASD 移动视角 · Q/E 转向 · R/F 升降')}
                </div>

                <div
                    className={`viewport__toolbar ${view === 'shot' ? 'viewport__toolbar--hidden' : ''}`}
                    role="toolbar"
                    aria-label={t('常用工具')}
                >
                    <Popover content={<div className="stack"><label>SSAO <Switch size="small" checked={effects.ambientOcclusion} onChange={value => editorPreferences.set('ambientOcclusion', value)} /></label><label>{t('轮廓描边')} <Switch size="small" checked={effects.outline} onChange={value => editorPreferences.set('outline', value)} /></label></div>}><Button size="small">{t('空间感')}</Button></Popover>
                    <Button size="small" onClick={() => setPip(!pip)}>{pip ? t('隐藏画中画') : t('显示画中画')}</Button>
                    <div className="viewport__tool-group" role="group" aria-label={t('移动 / 旋转 / 缩放')}>
                        {TOOL_MODES.map((tool) => (
                            <Tooltip key={tool.mode} title={`${t(tool.label)} · ${tool.shortcut}`}>
                                <Button
                                    size="small"
                                    className={transformMode === tool.mode ? 'is-active' : ''}
                                    icon={tool.icon}
                                    aria-label={t(tool.label)}
                                    aria-pressed={transformMode === tool.mode}
                                    onClick={() => session.setTransformMode(tool.mode)}
                                />
                            </Tooltip>
                        ))}
                    </div>
                    <span className="viewport__toolbar-separator" aria-hidden="true" />
                    <div className="viewport__tool-group">
                        <Tooltip title={t(pathDraft ? '完成路线' : '添加路径')}>
                            <Button
                                size="small"
                                className={pathDraft ? 'is-active' : ''}
                                icon={<BranchesOutlined />}
                                aria-label={t(pathDraft ? '完成路线' : '添加路径')}
                                aria-pressed={Boolean(pathDraft)}
                                disabled={!pathDraft && (!selectedEntity || selectedEntity.locked)}
                                onClick={() => (pathDraft ? session.finishPath() : session.startPath())}
                            />
                        </Tooltip>
                        {pathDraft && (
                            <span className="viewport__drawing">
                                {draftEntity?.path?.points.length ?? 0} {t('个路径点')}
                            </span>
                        )}
                        <Tooltip title={t('添加机位')}>
                            <Button
                                size="small"
                                icon={<BorderOutlined />}
                                aria-label={t('添加机位')}
                                onClick={() => session.addCamera()}
                            />
                        </Tooltip>
                        <Tooltip title={t('重置视角')}>
                            <Button
                                size="small"
                                icon={<HomeOutlined />}
                                aria-label={t('重置视角')}
                                onClick={() => session.viewHome()}
                            />
                        </Tooltip>
                    </div>
                    <span className="viewport__toolbar-separator" aria-hidden="true" />
                    <Popover
                        trigger="click"
                        placement="topRight"
                        overlayClassName="viewport-options-popover"
                        content={
                            <ViewOptions
                                gridVisible={gridVisible}
                                placementSnap={preferences.placementSnap}
                                objectSnap={preferences.objectSnap}
                                surfaceDrop={preferences.surfaceDrop}
                                draftQuality={preferences.previewQuality === 'draft'}
                            />
                        }
                    >
                        <Button size="small" icon={<EyeOutlined />} aria-label={t('视图选项')} />
                    </Popover>
                </div>
            </section>

            <section className="viewport__panel viewport__panel--shot" aria-label={t('机位视角')}>
                <div className="shot-header">
                    <CameraOutlined />
                    {view === 'stage' && <Button size="small" onClick={() => setPip(false)}>{t('关闭')}</Button>}
                    <Select
                        size="small"
                        variant="borderless"
                        value={preview}
                        aria-label={t('拍摄机位')}
                        onChange={(value) => session.setPreview(value)}
                        options={[
                            { value: 'program', label: t('成片 · 按切镜') },
                            ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
                        ]}
                    />
                    <span className="shot-header__lens">
                        {Number(lens.toFixed(1))} mm · {project.aspect}
                    </span>
                </div>
                <div
                    className="viewport__canvas viewport__canvas--shot"
                    ref={shotRef}
                    onPointerDown={() => setShotHintIdle(true)}
                >
                    <FramingGuides aspect={project.aspect} />
                    {preferences.showPreviousShot ? <PreviousShotOverlay cameraId={shotCameraId ?? ''} /> : null}
                    <span className={`viewport__shot-hint ${shotHintIdle ? 'is-idle' : ''}`}>
                        {t('拖动画面调整机位方向')}
                    </span>
                </div>
            </section>
        </div>
    );
}

/** Secondary viewport controls live in one popover so the toolbar stays a single row. */
function ViewOptions({
    gridVisible,
    placementSnap,
    objectSnap,
    surfaceDrop,
    draftQuality,
}: {
    gridVisible: boolean;
    placementSnap: number;
    objectSnap: boolean;
    surfaceDrop: boolean;
    draftQuality: boolean;
}) {
    const t = useTranslation();
    return (
        <div className="viewport-options">
            <Button size="small" icon={<AimOutlined />} onClick={() => session.viewTop()}>
                {t('俯视')}
            </Button>
            <div className="viewport-options__row">
                <span>{t('网格')}</span>
                <Switch size="small" checked={gridVisible} onChange={() => session.toggleGrid()} aria-label={t('网格')} />
            </div>
            <div className="viewport-options__row">
                <span>{t('网格吸附')}</span>
                <Select
                    size="small"
                    value={String(placementSnap)}
                    aria-label={t('网格吸附')}
                    getPopupContainer={(node) => node.parentElement ?? document.body}
                    onChange={(value) => session.setPlacementSnap(Number(value))}
                    options={[
                        { value: '0', label: t('网格吸附关') },
                        { value: '0.1', label: t('吸附 0.1m') },
                        { value: '0.5', label: t('吸附 0.5m') },
                        { value: '1', label: t('吸附 1m') },
                    ]}
                />
            </div>
            <div className="viewport-options__row">
                <span>{t('物体吸附')}</span>
                <Switch
                    size="small"
                    checked={objectSnap}
                    onChange={(checked) => session.setObjectSnap(checked)}
                    aria-label={t('物体吸附')}
                />
            </div>
            <div className="viewport-options__row">
                <span>{t('自动落到表面')}</span>
                <Switch size="small" checked={surfaceDrop} onChange={value => editorPreferences.set('surfaceDrop', value)} aria-label={t('自动落到表面')} />
            </div>
            <div className="viewport-options__row">
                <span>{t('草稿预览')}</span>
                <Switch
                    size="small"
                    checked={draftQuality}
                    onChange={(checked) => session.setPreviewQuality(checked ? 'draft' : 'full')}
                    aria-label={t('草稿预览')}
                />
            </div>
        </div>
    );
}

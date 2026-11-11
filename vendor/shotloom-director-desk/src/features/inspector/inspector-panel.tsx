import { RightOutlined } from '@ant-design/icons';
import { Button, Col, Divider, Empty, Input, Row, Select, Switch, Tabs, Tooltip } from 'antd';
import { useState } from 'react';
import type { Joint } from '@/core/model.ts';
import { numberAt } from '@/core/animation/channels.ts';
import { defaultLighting } from '@/core/lighting/model.ts';
import { ACTIONS, clipLabel, type Action, type Entity } from '@/core/model.ts';
import { findAsset } from '@/core/asset-catalog.ts';
import type { FramingName } from '@/state/commands/scene.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { ColorField } from '@/shared/ui/color-field.tsx';
import { NumberField } from '@/shared/ui/number-field.tsx';
import { session } from '@/state/editor-session.ts';
import { useEditorStore, type InspectorTab } from '@/state/editor-store.ts';
import { inspectorTabsFor } from '@/state/inspector-tabs.ts';
import { useProject, useSelectedEntity } from '@/state/use-editor.ts';
import { ActionPresetPicker, MoreActionsSelect } from '@/features/timeline/preset-picker.tsx';
import { KeyframePanel } from './keyframe-panel.tsx';
import { SpatialCheckPanel } from '@/features/spatial/spatial-check-panel.tsx';
import { ReferenceBackdropSection } from './reference-backdrop.tsx';

export function InspectorPanel({ resize, onHide }: { resize?: React.ReactNode; onHide: () => void }) {
    const t = useTranslation();
    const entity = useSelectedEntity();
    const tab = useEditorStore((state) => state.inspectorTab);

    const tabs: Array<{ key: InspectorTab; label: string }> = [
        { key: 'base', label: t('属性') },
        { key: 'path', label: t('走位') },
        { key: 'actions', label: t('动作') },
        { key: 'pose', label: t('姿态') },
        { key: 'camera', label: t('镜头') },
        { key: 'light', label: t('照明') },
        { key: 'environment', label: t('环境') },
        { key: 'keys', label: t('关键帧') },
        { key: 'spatial', label: t('空间检查') },
    ];
    const available = inspectorTabsFor(entity);
    const visibleTabs = tabs.filter((item) => available.includes(item.key));
    const activeTab = visibleTabs.some((item) => item.key === tab) ? tab : visibleTabs[0].key;

    return (
        <aside id="director-inspector" className={`inspector inspector--${entity?.kind ?? 'scene'}`} aria-label={t('属性面板')}>
            {resize}
            <header className="inspector__header">
                {entity ? (
                    <>
                        <h2>
                            {t(
                                entity.kind === 'actor' || entity.kind === 'crowd'
                                    ? '角色'
                                    : entity.kind === 'camera'
                                      ? '机位'
                                      : entity.light
                                        ? '灯光'
                                        : '道具',
                            )}
                        </h2>
                        <span className="inspector__kind">{entity.name}</span>
                    </>
                ) : (
                    <>
                        <h2>{t('3D 场景')}</h2>
                        <span className="inspector__kind">{t('天空、地面与环境光')}</span>
                    </>
                )}
                <div className="inspector__header-actions">
                    {entity ? <Button size="small" onClick={() => session.selectScene()}>{t('环境')}</Button> : null}
                    <Tooltip title={t('隐藏属性面板')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<RightOutlined />}
                            aria-label={t('隐藏属性面板')}
                            onClick={onHide}
                        />
                    </Tooltip>
                </div>
            </header>

            <Tabs
                size="small"
                activeKey={activeTab}
                onChange={(key) => session.setInspectorTab(key as InspectorTab)}
                items={visibleTabs}
                // Wrap onto a second row instead of scrolling: the English labels already fill
                // the 300px panel, and a scrolled-away tab is indistinguishable from a missing
                // feature. The wrapping itself lives in editor-page.css.
                className="inspector__tabs"
            />

            <div className="inspector__body">
                {activeTab === 'environment' || !entity ? (
                    <EnvironmentPanel />
                ) : activeTab === 'base' ? (
                    <BasePanel entity={entity} />
                ) : activeTab === 'actions' ? (
                    <ActionsPanel entity={entity} />
                ) : activeTab === 'pose' ? (
                    <PosePanel entity={entity} />
                ) : activeTab === 'camera' ? (
                    <CameraPanel entity={entity} />
                ) : activeTab === 'path' ? (
                    <PathPanel entity={entity} />
                ) : activeTab === 'light' ? (
                    <LightPanel entity={entity} />
                ) : activeTab === 'keys' ? (
                    <KeyframePanel entity={entity} />
                ) : activeTab === 'spatial' ? (
                    <SpatialCheckPanel />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('该面板迁移中')} />
                )}
            </div>
        </aside>
    );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="field-row">
            <span className="field-row__label">{label}</span>
            <div className="field-row__content">{children}</div>
        </div>
    );
}

function AxisFields({
    values,
    onCommit,
    step,
    precision,
}: {
    values: readonly number[];
    onCommit: (axis: 0 | 1 | 2, value: number) => void;
    step?: number;
    precision?: number;
}) {
    return (
        <Row gutter={6}>
            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                <Col span={8} key={axis}>
                    <div className="axis-field">
                        <span aria-hidden="true">{axis.toLowerCase()}</span>
                        <NumberField
                            aria-label={axis}
                            value={Number(values[index].toFixed(precision ?? 3))}
                            step={step}
                            precision={precision}
                            onCommit={(value) => onCommit(index as 0 | 1 | 2, value)}
                        />
                    </div>
                </Col>
            ))}
        </Row>
    );
}

function BasePanel({ entity }: { entity: Entity }) {
    const t = useTranslation();

    return (
        <div className="stack">
            <FieldRow label={t('名称')}>
                <Input
                    size="small"
                    defaultValue={entity.name}
                    key={entity.id + entity.name}
                    disabled={entity.locked}
                    onBlur={(event) => session.renameEntity(event.target.value)}
                    onPressEnter={(event) => session.renameEntity(event.currentTarget.value)}
                />
            </FieldRow>

            <FieldRow label={t('颜色')}>
                <div className="inline">
                    <ColorField
                        value={entity.color}
                        onCommit={(color) => session.setEntityColor(color)}
                        label={t('颜色')}
                    />
                    <span className="muted">{entity.color}</span>
                </div>
            </FieldRow>

            <div className="transform-matrix">
                <FieldRow label={t('位置') + ' · ' + t('米')}>
                    <AxisFields
                        values={entity.position}
                        onCommit={(axis, value) => session.setPositionAxis(axis, value)}
                        step={0.01}
                    />
                </FieldRow>
                <FieldRow label={t('旋转') + ' · ' + t('度')}>
                    <AxisFields
                        values={entity.rotation.map((radians) => (radians * 180) / Math.PI)}
                        onCommit={(axis, value) => session.setRotationAxis(axis, value)}
                        step={1}
                        precision={1}
                    />
                </FieldRow>
                <FieldRow label={t('缩放')}>
                    <AxisFields
                        values={entity.scale}
                        onCommit={(axis, value) => session.setScaleAxis(axis, value)}
                        step={0.01}
                    />
                </FieldRow>
            </div>

            {entity.kind === 'actor' || entity.kind === 'crowd' ? (
                <FieldRow label={t('身高')}>
                    <NumberField
                        value={entity.height}
                        min={0.5}
                        max={3}
                        step={0.05}
                        precision={2}
                        onCommit={(value) => session.setHeight(value)}
                    />
                </FieldRow>
            ) : null}
            {entity.kind === 'actor' || entity.kind === 'crowd' ? (
                <FieldRow label={t('体型')}>
                    <Select
                        size="small"
                        value={entity.build}
                        onChange={(value) => session.setEntityOption('build', value)}
                        options={[
                            { value: 'slim', label: t('瘦') },
                            { value: 'normal', label: t('标准') },
                            { value: 'broad', label: t('壮') },
                        ]}
                    />
                </FieldRow>
            ) : null}
            {entity.kind === 'actor' ? (
                <FieldRow label={t('性别')}>
                    <Select
                        size="small"
                        value={entity.gender}
                        onChange={(value) => session.setEntityOption('gender', value)}
                        options={[
                            { value: 'male', label: t('男') },
                            { value: 'female', label: t('女') },
                        ]}
                    />
                </FieldRow>
            ) : null}

            <FieldRow label={t('可见')}>
                <Switch
                    size="small"
                    checked={entity.visible}
                    onChange={(checked) => session.setEntityFlag('visible', checked)}
                />
            </FieldRow>
            <FieldRow label={t('锁定')}>
                <Switch
                    size="small"
                    checked={entity.locked}
                    onChange={(checked) => session.setEntityFlag('locked', checked)}
                />
            </FieldRow>
            <p className="muted small">{t('拖动场景中的对象可整体移动，路径会随对象一起平移。')}</p>
        </div>
    );
}

function CameraPanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const camera = entity.camera;
    if (!camera) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前对象不是摄影机')} />;

    return (
        <div className="stack">
            <FieldRow label={t('焦距')}>
                <NumberField
                    value={camera.focalKeys ? numberAt({ keys: camera.focalKeys }, time) : camera.focal}
                    min={8}
                    max={300}
                    step={1}
                    precision={0}
                    onCommit={(value) => session.setCameraField({ focal: value })}
                />
            </FieldRow>
            <FieldRow label={t('目标点')}>
                <AxisFields
                    values={camera.target}
                    step={0.01}
                    onCommit={(axis, value) => {
                        const target: [number, number, number] = [...camera.target] as [number, number, number];
                        target[axis] = value;
                        session.setCameraField({ target });
                    }}
                />
            </FieldRow>
            <FieldRow label={t('目标高度 / 米')}>
                <NumberField
                    value={camera.targetHeight}
                    step={0.05}
                    precision={2}
                    onCommit={(value) => session.setCameraField({ targetHeight: value })}
                />
            </FieldRow>
            <FieldRow label={t('看向对象')}>
                <Select
                    size="small"
                    value={camera.targetId}
                    onChange={(targetId) => session.setCameraField({ targetId })}
                    options={[
                        { value: '', label: t('固定空间目标') },
                        ...project.entities
                            .filter((item) => item.kind !== 'camera')
                            .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                />
            </FieldRow>
            <div className="button-row">
                {(['全景', '中景', '近景', '特写'] as FramingName[]).map((name) => (
                    <Button key={name} size="small" onClick={() => session.applyFraming(name)}>
                        {t(name)}
                    </Button>
                ))}
            </div>
            <div className="button-row">
                <Button
                    size="small"
                    onClick={() => {
                        session.setPreview(entity.id);
                        session.setView('shot');
                    }}
                >
                    {t('查看画面')}
                </Button>
                <Button size="small" type="primary" onClick={() => session.addCutAtPlayhead()}>
                    {t('设为此处镜头')}
                </Button>
            </div>
            <FieldRow label={t('朝向')}>
                <Select<'target' | 'manual'>
                    size="small"
                    value={camera.aim}
                    onChange={(aim) => session.setCameraField({ aim })}
                    options={[
                        { value: 'target', label: t('看向目标') },
                        { value: 'manual', label: t('手动') },
                    ]}
                />
            </FieldRow>
            <p className="muted small">{t('选择「手动」后可旋转机位；看向目标会保持锁定。')}</p>
        </div>
    );
}

function PosePanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const selectedJoint = useEditorStore((state) => state.selectedJoint);
    const [keyIndex, setKeyIndex] = useState(0);
    const [nodesVisible, setNodesVisible] = useState(session.engineOrNull?.jointNodesVisible ?? true);
    const { joints, angles } = session.jointState(entity);
    const joint = (selectedJoint || (joints[0]?.[0] as Joint) || 'head') as Joint;
    const jointLabel = joints.find(([id]) => id === joint)?.[1] ?? joint;
    const keys = entity.poseKeys;
    const keyAt = Math.min(Math.max(keyIndex, 0), Math.max(keys.length - 1, 0));

    return (
        <div className="stack">
            <FieldRow label={t('关节节点')}>
                <Switch
                    size="small"
                    checked={nodesVisible}
                    onChange={(checked) => {
                        setNodesVisible(checked);
                        session.setJointNodesVisible(checked);
                    }}
                />
            </FieldRow>
            <FieldRow label={t('关节')}>
                <Select
                    size="small"
                    value={joint}
                    aria-label={t('关节')}
                    onChange={(value) => session.selectJoint(value as Joint)}
                    options={joints.map(([id, label]) => ({ value: id, label }))}
                />
            </FieldRow>
            <div className="transform-matrix">
                <FieldRow label={`${jointLabel} · ${t('角度')}`}>
                    <Row gutter={6}>
                        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                            <Col span={8} key={axis}>
                                <NumberField
                                    aria-label={`${jointLabel} ${axis}`}
                                    value={Number(angles[index].toFixed(1))}
                                    min={-360}
                                    max={360}
                                    step={1}
                                    precision={1}
                                    onCommit={(value) => session.setJointAngle(joint, index as 0 | 1 | 2, value)}
                                />
                            </Col>
                        ))}
                    </Row>
                </FieldRow>
            </div>
            <div className="button-row">
                <Button size="small" onClick={() => session.resetPose()}>
                    {t('复位')}
                </Button>
                <Button size="small" onClick={() => session.mirrorPose()}>
                    {t('左右镜像')}
                </Button>
                <Button size="small" onClick={() => session.recordPoseKey()}>
                    {t('记录当前姿态')}
                </Button>
            </div>

            <Divider plain style={{ margin: '4px 0' }} />
            {keys.length ? (
                <>
                    <FieldRow label={t('姿态关键帧')}>
                        <Select
                            size="small"
                            value={String(keyAt)}
                            onChange={(value) => setKeyIndex(Number(value))}
                            options={keys.map((key, index) => ({
                                value: String(index),
                                label: `${index + 1} · ${key.time.toFixed(2)} ${t('秒')}`,
                            }))}
                        />
                    </FieldRow>
                    <div className="button-row">
                        <Button size="small" onClick={() => session.seekPoseKey(keyAt)}>
                            {t('跳到此帧')}
                        </Button>
                        <Button size="small" danger onClick={() => session.deletePoseKey(keyAt)}>
                            {t('删除此帧')}
                        </Button>
                    </div>
                </>
            ) : (
                <p className="muted small">{t('尚未记录姿态关键帧')}</p>
            )}
        </div>
    );
}

function ActionsPanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const time = useEditorStore((state) => state.time);
    const selectedClipId = useEditorStore((state) => state.selectedClipId);
    const clip = entity.clips.find((item) => item.id === selectedClipId) ?? entity.clips[0];
    const disabled = entity.locked;
    const definition = findAsset(entity.asset);
    const supported = Object.entries(ACTIONS)
        .filter(([key]) => !definition?.capabilities || definition.capabilities.actions.includes(key as Action))
        .map(([key]) => key as Action);

    return (
        <div className="stack">
            {clip ? (
                <>
                    <div className="field-pair">
                        <FieldRow label={`${t('动作片段')} · ${(clip.end - clip.start).toFixed(2)}s`}>
                            <Select
                                size="small"
                                value={clip.id}
                                disabled={disabled}
                                aria-label={t('动作片段')}
                                onChange={(id) => session.selectClip(id)}
                                options={entity.clips.map((item) => ({
                                    value: item.id,
                                    label: `${clipLabel(item)} · ${item.start.toFixed(2)}—${item.end.toFixed(2)}s`,
                                }))}
                            />
                        </FieldRow>
                        <FieldRow label={t('添加动作')}>
                            <MoreActionsSelect
                                supported={supported}
                                disabled={disabled}
                                onChoose={(action) => session.addAction(action)}
                            />
                        </FieldRow>
                    </div>
                    <div className="field-pair">
                        <FieldRow label={t('开始 / 秒')}>
                            <NumberField
                                value={clip.start}
                                min={0}
                                step={0.1}
                                precision={2}
                                onCommit={(value) => session.setClipField(clip.id, { start: value })}
                            />
                        </FieldRow>
                        <FieldRow label={t('结束 / 秒')}>
                            <NumberField
                                value={clip.end}
                                min={clip.start + 1 / 1000}
                                step={0.1}
                                precision={2}
                                onCommit={(value) => session.setClipField(clip.id, { end: value })}
                            />
                        </FieldRow>
                    </div>
                    <FieldRow label={t('动作速度')}>
                        <NumberField
                            value={clip.speed}
                            min={0.1}
                            max={5}
                            step={0.1}
                            precision={2}
                            onCommit={(value) => session.setClipField(clip.id, { speed: value })}
                        />
                    </FieldRow>
                    <div className="button-row">
                        <Button
                            size="small"
                            disabled={disabled || time <= clip.start || time >= clip.end}
                            onClick={() => session.splitSelectedClip()}
                        >
                            {t('在播放头分割')}
                        </Button>
                        <Button size="small" danger disabled={disabled} onClick={() => session.removeClip(clip.id)}>
                            {t('移除')}
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <FieldRow label={t('添加动作')}>
                        <MoreActionsSelect
                            supported={supported}
                            disabled={disabled}
                            onChoose={(action) => session.addAction(action)}
                        />
                    </FieldRow>
                    <p className="muted small">{t('尚无动作，选择下方预设即可添加。')}</p>
                </>
            )}

            <Divider plain style={{ margin: '4px 0' }} />
            <div className="field-pair">
                {entity.kind === 'actor' && !entity.external ? (
                    <FieldRow label={t('脚底贴合表面')}>
                        <Switch
                            size="small"
                            checked={Boolean(entity.footContact)}
                            onChange={(checked) => session.setFootContact(checked)}
                        />
                    </FieldRow>
                ) : null}
                <FieldRow label={t('基础动作衔接 / 秒')}>
                    <NumberField
                        value={entity.actionBlend ?? 0.2}
                        min={0}
                        max={2}
                        step={0.05}
                        precision={2}
                        onCommit={(value) => session.setActionBlend(value)}
                    />
                </FieldRow>
            </div>

            <Divider plain style={{ margin: '4px 0' }} />
            <ActionPresetPicker
                supported={supported}
                disabled={disabled}
                onChoose={(action) => session.addAction(action)}
            />
        </div>
    );
}

function PathPanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const project = useProject();
    const pathDraft = useEditorStore((state) => state.pathDraft);
    const drawMode = useEditorStore((state) => state.pathDrawMode);
    const surfaceMode = useEditorStore((state) => state.pathSurfaceMode);
    const drawDuration = useEditorStore((state) => state.pathDrawDuration);
    const selectedPoint = useEditorStore((state) => state.selectedPoint);
    const path = entity.path;
    const drawing = pathDraft === entity.id;

    if (entity.handBinding) return <p className="muted small">{t('请先解除手持绑定')}</p>;

    const pointIndex = path ? Math.min(Math.max(selectedPoint, 0), path.points.length - 1) : 0;
    const point = path?.points[pointIndex];

    return (
        <div className="stack">
            <FieldRow label={t('绘制方式')}>
                <Select<'points' | 'freehand'>
                    size="small"
                    value={drawMode}
                    disabled={Boolean(pathDraft)}
                    onChange={(value) => session.setPathDrawMode(value)}
                    options={[
                        { value: 'points', label: t('点选') },
                        { value: 'freehand', label: t('手绘') },
                    ]}
                />
            </FieldRow>
            <FieldRow label={t('绘制落点')}>
                <Select<'surface' | 'ground'>
                    size="small"
                    value={surfaceMode}
                    disabled={Boolean(pathDraft)}
                    onChange={(value) => session.setPathSurfaceMode(value)}
                    options={[
                        { value: 'surface', label: t('物体表面') },
                        { value: 'ground', label: t('地面') },
                    ]}
                />
            </FieldRow>
            {drawMode === 'freehand' ? (
                <FieldRow label={t('路线时长 / 秒')}>
                    <NumberField
                        value={drawDuration}
                        min={1 / project.fps}
                        step={0.1}
                        precision={2}
                        onCommit={(value) => session.setPathDrawDuration(value)}
                    />
                </FieldRow>
            ) : null}

            {drawing ? (
                <>
                    <div className="drawing-banner">
                        {drawMode === 'freehand' ? t('按住左键画路线，松开可续画') : t('点击场景添加途经点')}
                        {' · '}
                        {path?.points.length ?? 0} {t('点')}
                    </div>
                    <div className="button-row">
                        <Button size="small" type="primary" onClick={() => session.finishPath()}>
                            {t('完成路线')}
                        </Button>
                        <Button size="small" onClick={() => session.cancelPath()}>
                            {t('取消')}
                        </Button>
                    </div>
                </>
            ) : (
                <div className="button-row">
                    <Button size="small" disabled={entity.locked} onClick={() => session.startPath()}>
                        {path ? t('重画路线') : t('画路线')}
                    </Button>
                    {path ? (
                        <Button size="small" danger onClick={() => session.clearPath()}>
                            {t('清除')}
                        </Button>
                    ) : null}
                </div>
            )}

            {path && !drawing ? (
                <>
                    <Divider plain style={{ margin: '4px 0' }} />
                    <FieldRow label={t('途经点')}>
                        <Select
                            size="small"
                            value={String(pointIndex)}
                            onChange={(value) => session.selectPathPoint(Number(value))}
                            options={path.points.map((point, index) => ({
                                value: String(index),
                                label: `${index + 1} · ${point.time.toFixed(2)} ${t('秒')}`,
                            }))}
                        />
                    </FieldRow>
                    {point ? (
                        <>
                            <FieldRow label={`${t('时间')} / ${t('秒')}`}>
                                <NumberField
                                    value={point.time}
                                    min={0}
                                    step={0.1}
                                    precision={2}
                                    onCommit={(value) => session.setPathPointTime(pointIndex, value)}
                                />
                            </FieldRow>
                            <FieldRow label={t('位置') + ' · ' + t('米')}>
                                <AxisFields
                                    values={point.position}
                                    step={0.01}
                                    onCommit={(axis, value) => session.setPathPointPosition(pointIndex, axis, value)}
                                />
                            </FieldRow>
                        </>
                    ) : null}
                    <div className="button-row">
                        <Button size="small" onClick={() => session.appendPathPoint()}>
                            {t('添加点')}
                        </Button>
                        <Button size="small" onClick={() => session.holdPathPoint()}>
                            {t('停留 1 秒')}
                        </Button>
                        <Button
                            size="small"
                            danger
                            disabled={path.points.length <= 1}
                            onClick={() => session.removePathPoint(pointIndex)}
                        >
                            {t('删除此点')}
                        </Button>
                    </div>
                    <p className="muted small">
                        {t('路线')} {path.points.length} {t('点')} · {path.points[0].time.toFixed(2)}s →{' '}
                        {path.points.at(-1)!.time.toFixed(2)}s
                    </p>
                </>
            ) : null}
        </div>
    );
}

function LightPanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const time = useEditorStore((state) => state.time);
    const light = entity.light;
    if (!light) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前对象不是灯光')} />;

    return (
        <div className="stack">
            <FieldRow label={t('强度')}>
                <NumberField
                    value={numberAt(light.intensity, time)}
                    min={0}
                    max={500}
                    step={1}
                    precision={1}
                    onCommit={(value) => session.setLightField({ intensity: value })}
                />
            </FieldRow>
            {light.temperature === undefined ? null : (
                <FieldRow label={t('色温')}>
                    <NumberField
                        value={numberAt(light.temperature, time)}
                        min={2000}
                        max={12000}
                        step={100}
                        precision={0}
                        onCommit={(value) => session.setLightField({ temperature: value })}
                    />
                </FieldRow>
            )}
            <FieldRow label={t('范围')}>
                <NumberField
                    value={light.range}
                    min={0.5}
                    max={200}
                    step={0.5}
                    precision={1}
                    onCommit={(value) => session.setLightField({ range: value })}
                />
            </FieldRow>
            <FieldRow label={t('角度')}>
                <NumberField
                    value={light.angle}
                    min={1}
                    max={179}
                    step={1}
                    precision={0}
                    onCommit={(value) => session.setLightField({ angle: value })}
                />
            </FieldRow>
            <FieldRow label={t('半影')}>
                <NumberField
                    value={light.penumbra}
                    min={0}
                    max={1}
                    step={0.05}
                    precision={2}
                    onCommit={(value) => session.setLightField({ penumbra: value })}
                />
            </FieldRow>
            <FieldRow label={t('阴影')}>
                <Switch
                    size="small"
                    checked={light.shadows}
                    onChange={(checked) => session.setLightField({ shadows: checked })}
                />
            </FieldRow>
        </div>
    );
}

function EnvironmentPanel() {
    const t = useTranslation();
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const lighting = project.lighting ?? defaultLighting();

    return (
        <div className="stack">
            <ReferenceBackdropSection />
            <FieldRow label={t('环境光')}>
                <NumberField
                    value={numberAt(lighting.ambient, time)}
                    min={0}
                    max={20}
                    step={0.1}
                    precision={2}
                    onCommit={(value) => session.setLightingField({ ambient: value })}
                />
            </FieldRow>
            <FieldRow label={t('曝光')}>
                <NumberField
                    value={numberAt(lighting.exposure, time)}
                    min={0.05}
                    max={10}
                    step={0.05}
                    precision={2}
                    onCommit={(value) => session.setLightingField({ exposure: value })}
                />
            </FieldRow>
            <FieldRow label={t('天空颜色')}>
                <div className="inline">
                    <ColorField
                        value={lighting.background}
                        label={t('天空颜色')}
                        onCommit={(value) => session.setLightingField({ background: value })}
                    />
                    <span className="muted">{lighting.background}</span>
                </div>
            </FieldRow>
            <FieldRow label={t('地面颜色')}>
                <div className="inline">
                    <ColorField
                        value={lighting.groundColor}
                        label={t('地面颜色')}
                        onCommit={(value) => session.setLightingField({ groundColor: value })}
                    />
                    <span className="muted">{lighting.groundColor}</span>
                </div>
            </FieldRow>
            <FieldRow label={t('阴影质量')}>
                <Select<'off' | 'low' | 'medium' | 'high'>
                    size="small"
                    value={lighting.quality}
                    onChange={(quality) => session.setLightingField({ quality })}
                    options={[
                        { value: 'off', label: t('关闭阴影') },
                        { value: 'low', label: t('低 · 512') },
                        { value: 'medium', label: t('中 · 2048') },
                        { value: 'high', label: t('高 · 4096') },
                    ]}
                />
            </FieldRow>
            <Divider plain style={{ margin: '6px 0' }} />
            <FieldRow label={t('显示房间结构')}>
                <Switch
                    size="small"
                    checked={project.room.enabled}
                    onChange={(enabled) => session.updateRoom({ enabled })}
                />
            </FieldRow>
            {(['width', 'depth', 'height'] as const).map((axis) => (
                <FieldRow
                    key={axis}
                    label={`${t(axis === 'width' ? '宽度' : axis === 'depth' ? '进深' : '净高')} / ${t('米')}`}
                >
                    <NumberField
                        value={project.room[axis]}
                        min={2.3}
                        step={0.1}
                        precision={2}
                        onCommit={(value) => session.updateRoom({ [axis]: value })}
                    />
                </FieldRow>
            ))}
            <p className="muted small">
                {t('房间和家具使用真实尺寸。修改房间只改变墙体与地板，家具和人物保持原位置。')}
            </p>
        </div>
    );
}

import { AimOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Col, Row, Tooltip } from 'antd';
import { numberAt } from '@/core/animation/channels.ts';
import { rotationDegreesAt } from '@/core/animation/entity-rotation.ts';
import { pathSections } from '@/core/clip-editing.ts';
import { entityPosition } from '@/core/timeline.ts';
import type { Entity } from '@/core/model.ts';
import { timecode } from '@/shared/lib/format.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';
import { NumberField } from '@/shared/ui/number-field.tsx';

/**
 * Keyframe list for whatever the selection can animate.
 *
 * Position keys already existed in the data model — they are the motion-path waypoints — but
 * the only way to reach them was to draw a path. Focal keys were stored with no UI at all.
 * Listing both here makes "when does this happen" answerable without opening the timeline and
 * scrubbing.
 */
export function KeyframePanel({ entity }: { entity: Entity }) {
    const t = useTranslation();
    const project = useProject();
    const time = useEditorStore((state) => state.time);

    const positionKeys = entity.path?.points ?? [];
    const focalKeys = entity.camera?.focalKeys ?? [];
    const rotation = entity.rotationAnimation;
    const bounds = rotation ? session.entityBounds(entity.id) : null;
    const activeRotationKey = rotation?.keys.findIndex((key) => Math.abs(key.time - time) < 1 / project.fps / 2) ?? -1;

    const addPositionKey = () => {
        session.recordPositionKeyAtPlayhead();
    };

    const removePositionKey = (index: number) => {
        session.removePathPoint(index);
    };

    return (
        <div className="stack">
            <div className="keyframe-section">
                <div className="keyframe-section__head">
                    <span>{t('位置关键帧')}</span>
                    <Tooltip title={t('在当前时间记录位置关键帧K')}>
                        <Button
                            size="small"
                            type="text"
                            icon={<PlusOutlined />}
                            aria-label={t('位置关键帧')}
                            disabled={entity.locked}
                            onClick={addPositionKey}
                        />
                    </Tooltip>
                </div>
                {positionKeys.length ? (
                    <ul className="keyframe-list">
                        {positionKeys.map((point, index) => {
                            const active = Math.abs(point.time - time) < 1 / Math.max(1, project.fps) / 2;
                            return (
                                <li key={`${index}-${point.time}`} className={active ? 'is-active' : ''}>
                                    <button
                                        type="button"
                                        className="keyframe-row"
                                        onClick={() => session.seek(point.time)}
                                        title={`${t('跳到此处')}`}
                                    >
                                        <span className="keyframe-row__time">{timecode(point.time, project.fps)}</span>
                                        <span className="keyframe-row__value">
                                            {point.position.map((value) => value.toFixed(2)).join(', ')}
                                        </span>
                                        <AimOutlined className="keyframe-row__jump" />
                                    </button>
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={t('删除此帧')}
                                        onClick={() => removePositionKey(index)}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="muted small">{t('尚无位置关键帧；在播放头处按 K 记录当前位置。')}</p>
                )}
                {entity.path && pathSections(entity.path).length > 1 ? (
                    <p className="muted small">
                        {t('路线已分割为')} {pathSections(entity.path).length} {t('段，片段内的关键帧按片段换算。')}
                    </p>
                ) : null}
            </div>

            <div className="keyframe-section">
                <div className="keyframe-section__head">
                    <span>{t('旋转关键帧')}</span>
                    <Tooltip title={rotation ? t('在播放头处记录旋转关键帧') : t('创建旋转动画')}>
                        <Button
                            size="small"
                            type="text"
                            icon={<PlusOutlined />}
                            aria-label={rotation ? t('在播放头处记录旋转关键帧') : t('创建旋转动画')}
                            disabled={entity.locked || Boolean(entity.handBinding) || activeRotationKey >= 0}
                            onClick={() => session.recordRotationKeyAtPlayhead()}
                        />
                    </Tooltip>
                </div>
                {rotation ? (
                    <>
                        <ul className="keyframe-list">
                            {rotation.keys.map((key, index) => (
                                <li key={`${index}-${key.time}`} className={index === activeRotationKey ? 'is-active' : ''}>
                                    <button
                                        type="button"
                                        className="keyframe-row"
                                        onClick={() => session.seek(key.time)}
                                        title={t('跳到此处')}
                                    >
                                        <span className="keyframe-row__time">{timecode(key.time, project.fps)}</span>
                                        <span className="keyframe-row__value">{key.degrees.map((value) => `${value.toFixed(1)}°`).join(', ')}</span>
                                        <AimOutlined className="keyframe-row__jump" />
                                    </button>
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={t('删除此帧')}
                                        disabled={entity.locked || rotation.keys.length <= 2}
                                        onClick={() => session.removeRotationKey(index)}
                                    />
                                </li>
                            ))}
                        </ul>
                        <span className="muted small">{t('当前旋转')}：{rotationDegreesAt(rotation, time).map((value) => `${value.toFixed(1)}°`).join(', ')}</span>
                        {activeRotationKey >= 0 ? (
                            <div className="field-row">
                                <span className="field-row__label">{t('当前关键帧角度 · 度')}</span>
                                <Row gutter={6}>
                                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                                        <Col span={8} key={axis}>
                                            <div className="axis-field">
                                                <span aria-hidden="true">{axis.toLowerCase()}</span>
                                                <NumberField
                                                    value={rotation.keys[activeRotationKey].degrees[index]}
                                                    step={1}
                                                    precision={1}
                                                    disabled={entity.locked || Boolean(entity.handBinding)}
                                                    aria-label={`${t('当前关键帧角度 · 度')} ${axis}`}
                                                    onCommit={(value) => session.setRotationKeyAxis(activeRotationKey, index as 0 | 1 | 2, value)}
                                                />
                                            </div>
                                        </Col>
                                    ))}
                                </Row>
                            </div>
                        ) : (
                            <span className="muted small">{t('选择关键帧后可修改角度；播放头处可添加新帧。')}</span>
                        )}
                        <div className="field-row">
                            <span className="field-row__label">{t('旋转轴心 · 局部米')}</span>
                            <Row gutter={6}>
                                {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                                    <Col span={8} key={axis}>
                                        <div className="axis-field">
                                            <span aria-hidden="true">{axis.toLowerCase()}</span>
                                            <NumberField
                                                value={rotation.pivot[index]}
                                                step={0.01}
                                                precision={3}
                                                disabled={entity.locked || Boolean(entity.handBinding)}
                                                aria-label={`${t('旋转轴心 · 局部米')} ${axis}`}
                                                onCommit={(value) => session.setRotationPivotAxis(index as 0 | 1 | 2, value)}
                                            />
                                        </div>
                                    </Col>
                                ))}
                            </Row>
                        </div>
                        {bounds ? (
                            <>
                                <div className="inline">
                                    <Button size="small" disabled={entity.locked || Boolean(entity.handBinding)} onClick={() => session.setRotationPivotAxis(0, bounds.min[0])}>
                                        {t('轴心放到左边缘')}
                                    </Button>
                                    <Button size="small" disabled={entity.locked || Boolean(entity.handBinding)} onClick={() => session.setRotationPivotAxis(0, bounds.max[0])}>
                                        {t('轴心放到右边缘')}
                                    </Button>
                                </div>
                                <span className="muted small">
                                    {t('局部 X 范围')}：{bounds.min[0].toFixed(3)} – {bounds.max[0].toFixed(3)} · {t('X 缩放')} {entity.scale[0].toFixed(2)}
                                </span>
                                {rotation.pivot[0] < bounds.min[0] - 1e-6 || rotation.pivot[0] > bounds.max[0] + 1e-6 ? (
                                    <span className="muted small">{t('轴心在物体左右边界之外，旋转时物体会绕外侧点摆动。')}</span>
                                ) : null}
                            </>
                        ) : null}
                        <span className="muted small">{t('轴心放在门合页等旋转中心；属性页的旋转是基础朝向。')}</span>
                        <Button size="small" danger disabled={entity.locked} onClick={() => session.clearRotationAnimation()}>
                            {t('删除旋转动画')}
                        </Button>
                    </>
                ) : (
                    <p className="muted small">{t('尚无旋转动画；在播放头处创建后，选择结束帧修改角度。')}</p>
                )}
            </div>

            {entity.camera ? (
                <div className="keyframe-section">
                    <div className="keyframe-section__head">
                        <span>{t('焦距关键帧')}</span>
                        <Tooltip title={t('记录当前值')}>
                            <Button
                                size="small"
                                type="text"
                                icon={<PlusOutlined />}
                                aria-label={t('焦距关键帧')}
                                disabled={entity.locked}
                                onClick={() => session.recordFocalKeyAtPlayhead()}
                            />
                        </Tooltip>
                    </div>
                    {focalKeys.length ? (
                        <ul className="keyframe-list">
                            {focalKeys.map((key, index) => (
                                <li key={`${index}-${key.time}`}>
                                    <button
                                        type="button"
                                        className="keyframe-row"
                                        onClick={() => session.seek(key.time)}
                                        title={t('跳到此处')}
                                    >
                                        <span className="keyframe-row__time">{timecode(key.time, project.fps)}</span>
                                        <span className="keyframe-row__value">
                                            {numberAt({ keys: focalKeys }, key.time).toFixed(1)} mm
                                        </span>
                                        <AimOutlined className="keyframe-row__jump" />
                                    </button>
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={t('删除此帧')}
                                        onClick={() => session.removeFocalKey(index)}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="muted small">{t('尚无焦距关键帧；记录后当前焦距会随播放变化。')}</p>
                    )}
                </div>
            ) : null}

            <div className="keyframe-section">
                <p className="muted small">
                    {t('当前时间')} {timecode(time, project.fps)} · {t('位置')}{' '}
                    {entityPosition(entity, time)
                        .toArray()
                        .map((value: number) => value.toFixed(2))
                        .join(', ')}
                </p>
            </div>
        </div>
    );
}

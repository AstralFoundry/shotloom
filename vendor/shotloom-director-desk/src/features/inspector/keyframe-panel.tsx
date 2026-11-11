import { AimOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { numberAt } from '@/core/animation/channels.ts';
import { pathSections } from '@/core/clip-editing.ts';
import { entityPosition } from '@/core/timeline.ts';
import type { Entity } from '@/core/model.ts';
import { timecode } from '@/shared/lib/format.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';

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

import { CameraOutlined, DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entity, Project } from '@/core/model.ts';
import { timecode } from '@/shared/lib/format.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';
import './shot-list.css';

export interface ShotSpan {
    index: number;
    cameraId: string;
    camera: Entity | undefined;
    start: number;
    end: number;
    duration: number;
}

/** Resolve the cut list into the shots a director actually talks about. */
export function shotSpans(project: Project): ShotSpan[] {
    const cuts = project.cuts.length
        ? project.cuts
        : [{ time: 0, cameraId: project.entities.find((e) => e.kind === 'camera')?.id ?? '' }];
    return cuts.map((cut, index) => {
        const end = cuts[index + 1]?.time ?? project.duration;
        return {
            index,
            cameraId: cut.cameraId,
            camera: project.entities.find((entity) => entity.id === cut.cameraId),
            start: cut.time,
            end,
            duration: Math.max(0, end - cut.time),
        };
    });
}

/**
 * Shot list.
 *
 * A cut is only a draggable bar on the timeline, which makes "shot 3 repeats shot 7" invisible.
 * This view renders each shot as a still at its midpoint so the sequence can be read as a
 * storyboard, and it is also the natural unit for per-shot export.
 */
export function ShotList({ onExport }: { onExport?: (shot: ShotSpan) => void }) {
    const t = useTranslation();
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const playing = useEditorStore((state) => state.playing);
    const shots = useMemo(() => shotSpans(project), [project]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [rendering, setRendering] = useState(false);
    const request = useRef(0);

    // Render a still per shot. Serialised and debounced: this is the expensive part and it must
    // never fight the export pipeline or the playback loop for the renderer.
    const signature = shots.map((shot) => `${shot.cameraId}:${shot.start.toFixed(2)}:${shot.end.toFixed(2)}`).join('|');
    useEffect(() => {
        if (playing) return;
        const token = ++request.current;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            const engine = session.engineOrNull;
            const lease = session.renderLease;
            if (!engine || !lease) return;
            void (async () => {
                setRendering(true);
                const collected: Record<string, string> = {};
                try {
                    // One borrow for the whole strip: rendering N shots repositions the engine N
                    // times, and the viewport must not be left on the last shot's time.
                    await lease.borrow(async () => {
                        for (const shot of shots) {
                            if (cancelled || token !== request.current) return;
                            if (!shot.cameraId || shot.duration <= 0) continue;
                            const at = shot.start + shot.duration / 2;
                            await engine.prepareOutput(at);
                            if (cancelled || token !== request.current) return;
                            const canvas = engine.renderOutput(at, 240, 135, shot.cameraId);
                            collected[`${shot.index}`] = canvas.toDataURL('image/jpeg', 0.7);
                        }
                    });
                } catch {
                    // Thumbnails are a convenience; a failure leaves the placeholders in place.
                } finally {
                    if (!cancelled) setRendering(false);
                }
                if (!cancelled && token === request.current) setThumbs(collected);
            })();
        }, 260);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [playing, shots, signature]);

    if (!shots.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('还没有镜头')} />;

    return (
        <div className="shot-list">
            <div className="shot-list__head">
                <span>
                    {shots.length} {t('个镜头')} · {project.duration.toFixed(1)}s
                </span>
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined spin={rendering} />}
                    aria-label={t('刷新缩略图')}
                    onClick={() => setThumbs({})}
                />
            </div>
            <ol className="shot-list__grid">
                {shots.map((shot) => {
                    const active = time >= shot.start && time < shot.end;
                    return (
                        <li key={shot.index} className={`shot-card ${active ? 'is-active' : ''}`}>
                            <button
                                type="button"
                                className="shot-card__thumb"
                                onClick={() => {
                                    session.seek(shot.start);
                                    if (shot.cameraId) session.setPreview(shot.cameraId);
                                }}
                                title={`${t('跳到此处')} · ${timecode(shot.start, project.fps)}`}
                            >
                                {thumbs[String(shot.index)] ? (
                                    <img src={thumbs[String(shot.index)]} alt="" />
                                ) : (
                                    <span className="shot-card__placeholder">
                                        <CameraOutlined />
                                    </span>
                                )}
                                <small className="shot-card__index">{shot.index + 1}</small>
                                <small className="shot-card__time">{shot.duration.toFixed(1)}s</small>
                            </button>
                            <div className="shot-card__meta">
                                <span title={shot.camera?.name ?? t('未指定机位')}>
                                    {shot.camera?.name ?? t('未指定机位')}
                                </span>
                                <span className="shot-card__actions">
                                    {onExport ? (
                                        <Tooltip title={t('导出此镜')}>
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<DownloadOutlined />}
                                                aria-label={t('导出此镜')}
                                                onClick={() => onExport(shot)}
                                            />
                                        </Tooltip>
                                    ) : null}
                                    {shot.index > 0 ? (
                                        <Tooltip title={t('删除切镜')}>
                                            <Button
                                                size="small"
                                                type="text"
                                                danger
                                                icon={<DeleteOutlined />}
                                                aria-label={t('删除切镜')}
                                                onClick={() => session.removeCut(shot.index)}
                                            />
                                        </Tooltip>
                                    ) : null}
                                </span>
                            </div>
                            <span className="shot-card__range">
                                {timecode(shot.start, project.fps)} → {timecode(shot.end, project.fps)}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

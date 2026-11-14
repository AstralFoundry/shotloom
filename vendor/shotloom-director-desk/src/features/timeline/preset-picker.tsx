import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from 'antd';
import { Vector3 } from 'three';
import { pathPosition } from '@/core/timeline.ts';
import { cameraLookAt } from '@/core/animation/camera-look.ts';
import { numberAt } from '@/core/animation/channels.ts';
import { ACTIONS, type Action } from '@/core/model.ts';
import { ACTION_TIMING } from '@/core/animation/action-timing.ts';
import { actionThumbnail } from '@/core/animation/action-thumbnails.ts';
import { CAMERA_PRESETS, cameraPresetPath, type CameraPresetId } from '@/core/cinematography/camera-presets.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import './preset-picker.css';

const FEATURED_ACTIONS: Array<{ id: Action; name: string }> = [
    { id: 'idle', name: '待机呼吸' },
    { id: 'walk', name: '行走循环' },
    { id: 'run', name: '跑步循环' },
    { id: 'jump', name: '跳跃' },
    { id: 'wave', name: '挥手打招呼' },
    { id: 'sit', name: '坐下' },
    { id: 'standup', name: '起身' },
    { id: 'crouch', name: '蹲下' },
    { id: 'punch', name: '出拳' },
];

function ActionImage({ action }: { action: Action }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [image, setImage] = useState<string>();
    useEffect(() => {
        let active = true;
        const element = ref.current;
        if (!element) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                observer.disconnect();
                void actionThumbnail(action, () => active)
                    .then((url) => {
                        if (active && url) setImage(url);
                    })
                    .catch(() => undefined);
            },
            { rootMargin: '100px' },
        );
        observer.observe(element);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [action]);
    return (
        <span ref={ref} className="preset-card__image">
            {image ? <img src={image} alt="" /> : null}
        </span>
    );
}

export function ActionPresetPicker({
    supported,
    disabled = false,
    onChoose,
}: {
    supported: Action[];
    disabled?: boolean;
    onChoose: (action: Action) => void;
}) {
    const t = useTranslation();
    const featured = FEATURED_ACTIONS.filter((preset) => supported.includes(preset.id));
    return (
        <div className="preset-picker preset-picker--inline">
            <div className="preset-picker__heading">{t('预设动作')}</div>
            <div className="preset-picker__scroll">
                <div className="preset-picker__grid">
                    {featured.map((preset) => (
                        <button
                            type="button"
                            className="preset-card"
                            key={preset.id}
                            disabled={disabled}
                            onClick={() => onChoose(preset.id)}
                        >
                            <ActionImage action={preset.id} />
                            <span className="preset-card__name">{t(preset.name)}</span>
                            <small>
                                {ACTION_TIMING[preset.id].duration.toFixed(1)}s{' '}
                                {ACTION_TIMING[preset.id].loop ? '↻' : ''}
                            </small>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function MoreActionsSelect({
    supported,
    disabled = false,
    onChoose,
}: {
    supported: Action[];
    disabled?: boolean;
    onChoose: (action: Action) => void;
}) {
    const t = useTranslation();
    return (
        <Select<Action>
            size="small"
            showSearch
            aria-label={t('更多动作…')}
            placeholder={t('更多动作…')}
            disabled={disabled}
            optionFilterProp="label"
            value={undefined}
            onChange={onChoose}
            options={supported.map((action) => ({ value: action, label: t(ACTIONS[action]) }))}
        />
    );
}

/** A projected 3D wire study, sampled from the very same motion as the real camera. */
function CameraDiagram({ id }: { id: CameraPresetId }) {
    const svg = useRef<SVGSVGElement>(null);
    const data = useMemo(() => {
        const motion = cameraPresetPath(id === 'rack-focus' ? 'fixed' : id, [3.2, 1.6, 0.6], [0, 0.8, 0], 0, 4, 35, {
            foreground: { center: [1.4, 1, 0.5], radius: 0.4 },
        });
        const raw = (p: Vector3) => [(p.x - p.z) * 0.82, (p.x + p.z) * 0.28 - p.y * 0.9];
        const box = (center: Vector3, right: Vector3, up: Vector3, forward: Vector3, w: number, h: number, d: number) =>
            [-1, 1].flatMap((z) =>
                [-1, 1].flatMap((y) =>
                    [-1, 1].map((x) =>
                        center
                            .clone()
                            .addScaledVector(right, x * w)
                            .addScaledVector(up, y * h)
                            .addScaledVector(forward, z * d),
                    ),
                ),
            );
        const subject = box(
            new Vector3(0, 0.8, 0),
            new Vector3(1, 0, 0),
            new Vector3(0, 1, 0),
            new Vector3(0, 0, 1),
            0.55,
            0.8,
            0.55,
        );
        const frame = (time: number) => {
            const position = pathPosition(motion.path, [3.2, 1.6, 0.6], time);
            const forward = cameraLookAt(motion.targetPath, time).sub(position).normalize();
            const right = forward
                .clone()
                .cross(new Vector3(0, 1, 0))
                .normalize();
            if (right.lengthSq() < 0.001) right.set(1, 0, 0);
            const up = right.clone().cross(forward).normalize();
            const focal = motion.focalKeys ? numberAt({ keys: motion.focalKeys }, time) : 35;
            const depth = 2.3,
                halfWidth = (depth * 18) / focal;
            const plane = [-1, 1].flatMap((y) =>
                [-1, 1].map((x) =>
                    position
                        .clone()
                        .addScaledVector(forward, depth)
                        .addScaledVector(right, x * halfWidth)
                        .addScaledVector(up, (y * halfWidth) / 1.6),
                ),
            );
            const body = box(position.clone().addScaledVector(forward, -0.13), right, up, forward, 0.19, 0.13, 0.24);
            const lens = box(position.clone().addScaledVector(forward, 0.22), right, up, forward, 0.11, 0.09, 0.09);
            return { position, plane, body, lens };
        };
        const samples = Array.from({ length: 65 }, (_, i) => frame(i / 16));
        const bounds = [...subject, ...samples.flatMap((f) => [f.position, ...f.plane, ...f.body])].map(raw);
        const minX = Math.min(...bounds.map((p) => p[0])),
            maxX = Math.max(...bounds.map((p) => p[0]));
        const minY = Math.min(...bounds.map((p) => p[1])),
            maxY = Math.max(...bounds.map((p) => p[1]));
        const scale = Math.min(208 / Math.max(1, maxX - minX), 112 / Math.max(1, maxY - minY));
        const project = (p: Vector3) => {
            const [x, y] = raw(p);
            return [120 + (x - (minX + maxX) / 2) * scale, 70 + (y - (minY + maxY) / 2) * scale];
        };
        const edges = [
            [0, 1],
            [0, 2],
            [0, 4],
            [1, 3],
            [1, 5],
            [2, 3],
            [2, 6],
            [3, 7],
            [4, 5],
            [4, 6],
            [5, 7],
            [6, 7],
        ];
        const line = (a: Vector3, b: Vector3) => `M${project(a).join(' ')}L${project(b).join(' ')}`;
        const wire = (points: Vector3[]) => edges.map(([a, b]) => line(points[a], points[b])).join('');
        const drawing = (time: number) => {
            const f = frame(time);
            const frustum =
                f.plane.map((p) => line(f.position, p)).join('') +
                [
                    [0, 1],
                    [1, 3],
                    [3, 2],
                    [2, 0],
                ]
                    .map(([a, b]) => line(f.plane[a], f.plane[b]))
                    .join('');
            return { frustum, camera: wire(f.body) + wire(f.lens), position: project(f.position) };
        };
        return {
            drawing,
            subject: wire(subject),
            route: motion.path.points.map((p) => project(new Vector3(...p.position)).join(',')).join(' '),
            marks: [0, 16, 32, 48, 64].map((i) => project(samples[i].position)),
            initial: drawing(0),
        };
    }, [id]);
    useEffect(() => {
        const element = svg.current,
            button = element?.closest('button');
        if (!element || !button) return;
        let raf = 0;
        const paint = (time: number) => {
            const f = data.drawing(time);
            element.querySelector('.camera-diagram__frustum')?.setAttribute('d', f.frustum);
            element.querySelector('.camera-diagram__camera')?.setAttribute('d', f.camera);
        };
        const stop = () => {
            cancelAnimationFrame(raf);
            paint(0);
        };
        const start = () => {
            if (button.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            cancelAnimationFrame(raf);
            let began = 0;
            const tick = (now: number) => {
                began ||= now;
                const elapsed = (now - began) / 1000;
                paint(Math.min(4, elapsed));
                if (elapsed < 4) raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        };
        button.addEventListener('mouseenter', start);
        button.addEventListener('mouseleave', stop);
        button.addEventListener('focus', start);
        button.addEventListener('blur', stop);
        return () => {
            cancelAnimationFrame(raf);
            button.removeEventListener('mouseenter', start);
            button.removeEventListener('mouseleave', stop);
            button.removeEventListener('focus', start);
            button.removeEventListener('blur', stop);
        };
    }, [data]);
    return (
        <svg ref={svg} className="camera-preset-diagram" viewBox="0 0 240 140" aria-hidden="true">
            <g className="camera-diagram__grid">
                {Array.from({ length: 10 }, (_, i) => (
                    <path
                        key={i}
                        d={`M${-100 + i * 34} 140L${200 + i * 34} 0M${-100 + i * 34} 0L${200 + i * 34} 140`}
                    />
                ))}
            </g>
            <path className="camera-diagram__subject" d={data.subject} />
            <polyline className="camera-diagram__route" points={data.route} />
            <g className="camera-diagram__marks">
                {data.marks.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r="1.5" />
                ))}
            </g>
            <path className="camera-diagram__frustum" d={data.initial.frustum} />
            <path className="camera-diagram__camera" d={data.initial.camera} />
        </svg>
    );
}

export function CameraPresetPicker({
    onChoose,
    inline = false,
    disabled = false,
    hasSubject = true,
    hasForeground = false,
}: {
    onChoose: (id: CameraPresetId) => void;
    inline?: boolean;
    disabled?: boolean;
    hasSubject?: boolean;
    hasForeground?: boolean;
}) {
    const t = useTranslation();
    return (
        <div className={`preset-picker camera-preset-picker ${inline ? 'preset-picker--inline' : ''}`}>
            <div className="preset-picker__scroll">
                {(['基础控制', '人物跟拍', '空间航拍'] as const).map((group) => (
                    <section className="camera-preset-group" key={group}>
                        <h3 className="preset-picker__heading">{t(group)}</h3>
                        <div className="preset-picker__grid">
                            {CAMERA_PRESETS.filter((preset) => preset.group === group).map((preset) => {
                                const reason =
                                    'unavailable' in preset
                                        ? preset.description
                                        : 'subject' in preset && !hasSubject
                                          ? '请先选择跟拍主体'
                                          : 'foreground' in preset && !hasForeground
                                            ? '请先选择前景遮挡物'
                                            : '';
                                return (
                                    <button
                                        type="button"
                                        className="preset-card camera-preset-card"
                                        key={preset.id}
                                        disabled={disabled || !!reason}
                                        title={t(reason || preset.description)}
                                        onClick={() => onChoose(preset.id)}
                                    >
                                        <CameraDiagram id={preset.id} />
                                        <span className="preset-card__name">{t(preset.name)}</span>
                                        <small className="preset-card__description">
                                            {t(reason || preset.description)}
                                        </small>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

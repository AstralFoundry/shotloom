import { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
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

function CameraDiagram({ id }: { id: CameraPresetId }) {
    const { path } = cameraPresetPath(id, [3.2, 1.6, 0.6], [0, 0.8, 0], 0, 4, 35);
    const project = ([x, y, z]: readonly number[]) => [80 + (x - z) * 15, 58 + (x + z) * 5 - (y - 0.8) * 16];
    const route = path.points.map((point) => project(point.position).join(',')).join(' ');
    const start = project(path.points[0].position);
    return (
        <svg className="preset-card__diagram" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true">
            <rect width="160" height="100" fill="#202425" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <path
                    key={i}
                    d={`M0 ${38 + i * 13}L160 ${38 + i * 13} M${i * 33 - 15} 100L${i * 33 + 80} 24`}
                    stroke="#343b3e"
                    strokeWidth="0.5"
                />
            ))}
            <path
                d="M69 51L80 45L91 51L80 57Z M69 51V68L80 74L91 68V51 M80 57V74"
                fill="none"
                stroke="#aab1b1"
                strokeWidth="1"
            />
            <polyline
                points={route}
                fill="none"
                stroke="#d7759e"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx={start[0]} cy={start[1]} r="3" fill="#f2f2f2" />
        </svg>
    );
}

export function CameraPresetPicker({ onChoose }: { onChoose: (id: CameraPresetId) => void }) {
    const t = useTranslation();
    return (
        <div className="preset-picker">
            <div className="preset-picker__heading">{t('预设运镜')}</div>
            <div className="preset-picker__scroll">
                <div className="preset-picker__grid">
                    {CAMERA_PRESETS.map((preset) => (
                        <button
                            type="button"
                            className="preset-card"
                            key={preset.id}
                            onClick={() => onChoose(preset.id)}
                        >
                            <CameraDiagram id={preset.id} />
                            <span className="preset-card__name">{t(preset.name)}</span>
                            <small>4.0s</small>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

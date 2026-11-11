import { Vector3 } from 'three';
import type { MotionPath, Vec3 } from '../model.ts';
import type { NumberKey } from '../animation/channels.ts';

export const CAMERA_PRESETS = [
    { id: 'orbit', name: '环绕' },
    { id: 'half-orbit', name: '半弧' },
    { id: 'dolly-in', name: '推近' },
    { id: 'dolly-out', name: '拉远' },
    { id: 'dolly-zoom', name: '滑动变焦' },
    { id: 'rise', name: '上升' },
    { id: 'fall', name: '下降' },
    { id: 'truck', name: '横移' },
    { id: 'spiral-rise', name: '螺旋上升' },
] as const;
export type CameraPresetId = (typeof CAMERA_PRESETS)[number]['id'];

export function cameraPresetPath(
    id: CameraPresetId,
    start: Vec3,
    target: Vec3,
    from: number,
    duration: number,
    focal: number,
): { path: MotionPath; focalKeys?: NumberKey[] } {
    const origin = new Vector3(...start);
    const focus = new Vector3(...target);
    const offset = origin.clone().sub(focus);
    const radius = Math.max(0.5, Math.hypot(offset.x, offset.z));
    const outward = new Vector3(offset.x, 0, offset.z).normalize();
    if (outward.lengthSq() < 0.001) outward.set(0, 0, 1);
    const sideways = new Vector3(outward.z, 0, -outward.x);
    const distance = Math.max(0.5, offset.length());
    const lift = Math.max(1.5, distance * 0.4);
    const samples = id === 'orbit' || id === 'spiral-rise' ? 16 : id === 'half-orbit' ? 9 : 2;
    const points = Array.from({ length: samples + 1 }, (_, index) => {
        const u = index / samples;
        let position = origin.clone();
        if (id === 'orbit' || id === 'half-orbit' || id === 'spiral-rise') {
            const angle = u * (id === 'half-orbit' ? Math.PI : Math.PI * 2);
            position = focus
                .clone()
                .addScaledVector(outward, Math.cos(angle) * radius)
                .addScaledVector(sideways, Math.sin(angle) * radius);
            position.y = origin.y + (id === 'spiral-rise' ? lift * u : 0);
        } else if (id === 'dolly-in' || id === 'dolly-zoom') {
            position.lerp(focus, 0.45 * u);
        } else if (id === 'dolly-out') {
            position.addScaledVector(offset, 0.55 * u);
        } else if (id === 'rise' || id === 'fall') {
            position.y += lift * u * (id === 'rise' ? 1 : -1);
            if (id === 'fall') position.y = Math.max(focus.y - 0.6, position.y);
        } else if (id === 'truck') {
            position.addScaledVector(sideways, distance * 0.75 * u);
        }
        return { time: from + duration * u, position: position.toArray() as Vec3 };
    });
    return {
        path: { smooth: true, interpolation: 'continuous', points },
        ...(id === 'dolly-zoom'
            ? {
                  focalKeys: [
                      { time: from, value: focal },
                      { time: from + duration, value: Math.max(8, focal * 0.55) },
                  ],
              }
            : {}),
    };
}

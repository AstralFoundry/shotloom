import { Vector3 } from 'three';
import type { MotionPath, Vec3 } from '../model.ts';
import type { NumberKey } from '../animation/channels.ts';
import type { CameraLookPath } from '../animation/camera-look.ts';

/** IDs are persisted and exposed to the host catalogue; keep existing IDs stable. */
export const CAMERA_PRESETS = [
    { id: 'fixed', name: '固定镜头', description: '机位和方向不变', group: '基础控制' },
    { id: 'tilt-up', name: '镜头上摇', description: '固定机位向上转动', group: '基础控制' },
    { id: 'tilt-down', name: '镜头下摇', description: '固定机位向下转动', group: '基础控制' },
    { id: 'pan-left', name: '镜头左摇', description: '固定机位向左转动', group: '基础控制' },
    { id: 'pan-right', name: '镜头右摇', description: '固定机位向右转动', group: '基础控制' },
    { id: 'rise', name: '镜头上升', description: '垂直上升并保持方向', group: '基础控制' },
    { id: 'fall', name: '镜头下降', description: '垂直下降并保持方向', group: '基础控制' },
    { id: 'truck-left', name: '镜头左移', description: '横向左移并保持方向', group: '基础控制' },
    { id: 'truck', name: '镜头右移', description: '横向右移并保持方向', group: '基础控制' },
    { id: 'dolly-in', name: '镜头前推', description: '沿镜头方向前推', group: '基础控制' },
    { id: 'dolly-out', name: '镜头后移', description: '沿镜头方向后拉', group: '基础控制' },
    { id: 'zoom-in', name: '变焦推进', description: '机位不动画面收紧', group: '基础控制' },
    { id: 'zoom-out', name: '变焦拉远', description: '机位不动画面放宽', group: '基础控制' },
    { id: 'handheld', name: '手持拍摄', description: '轻微自然晃动', group: '基础控制' },
    { id: 'reveal', name: '横滑揭示', description: '横移绕过所选遮挡物', group: '基础控制', foreground: true },
    { id: 'foreground-wipe', name: '前景擦过', description: '近景遮挡擦过画面', group: '基础控制', foreground: true },
    { id: 'fly-through', name: '穿越镜头', description: '快速前推进入后景', group: '基础控制' },
    { id: 'whip-pan', name: '甩摇', description: '快速水平甩到新构图', group: '基础控制' },
    { id: 'rack-focus', name: '焦点转移', description: '需要景深渲染，暂不可用', group: '基础控制', unavailable: true },
    { id: 'snap-zoom', name: '急速变焦', description: '快速收紧到目标区域', group: '基础控制' },
    { id: 'follow', name: '跟随拍摄', description: '跟随主体保持构图', group: '人物跟拍', subject: true },
    { id: 'front-follow', name: '迎面跟拍', description: '主体前方同步后退', group: '人物跟拍', subject: true },
    { id: 'side-follow', name: '侧面跟拍', description: '主体侧方平行移动', group: '人物跟拍', subject: true },
    { id: 'orbit', name: '环绕拍摄', description: '围绕主体旋转 360°', group: '人物跟拍', subject: true },
    { id: 'half-orbit', name: '半弧环绕', description: '围绕主体旋转 180°', group: '人物跟拍', subject: true },
    { id: 'spiral-rise', name: '盘旋抬升', description: '环绕主体并逐渐升高', group: '人物跟拍', subject: true },
    { id: 'spiral-fall', name: '盘旋下降', description: '环绕主体并逐渐降低', group: '人物跟拍', subject: true },
    { id: 'aerial', name: '高空航拍', description: '高角度稳定滑行', group: '空间航拍' },
    { id: 'fpv', name: '穿越机运镜', description: '第一视角高速穿行', group: '空间航拍' },
    { id: 'dive', name: '俯冲下降', description: '从高处俯冲靠近', group: '空间航拍' },
    { id: 'pull-away', name: '拉升离场', description: '向后并向上离场', group: '空间航拍' },
    { id: 'dolly-zoom', name: '滑动变焦', description: '前推同时变焦保持主体大小', group: '基础控制' },
] as const;
export type CameraPresetId = (typeof CAMERA_PRESETS)[number]['id'];
export interface CameraMoveContext {
    subjectAt?: (time: number) => Vec3;
    subjectYaw?: number;
    foreground?: { center: Vec3; radius: number };
}

/** Bake world-space position and look keys so playback, seeking and exports share one result. */
export function cameraPresetPath(
    id: CameraPresetId,
    start: Vec3,
    target: Vec3,
    from: number,
    duration: number,
    focal: number,
    context: CameraMoveContext = {},
): { path: MotionPath; targetPath: CameraLookPath; focalKeys?: NumberKey[] } {
    const preset = CAMERA_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error('未知运镜预设');
    if ('unavailable' in preset) throw new Error(preset.description);
    if ('foreground' in preset && !context.foreground) throw new Error('请先选择前景遮挡物');
    if (!Number.isFinite(from) || from < 0 || !Number.isFinite(duration) || duration <= 0)
        throw new Error('运镜时间无效');
    const origin = new Vector3(...start),
        focus = new Vector3(...target);
    const offset = origin.clone().sub(focus);
    const distance = Math.max(0.5, offset.length());
    const forward = focus.clone().sub(origin).normalize();
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    const right = forward
        .clone()
        .cross(new Vector3(0, 1, 0))
        .normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    const up = right.clone().cross(forward).normalize();
    const lift = Math.max(1.5, distance * 0.4);
    const subjectStart = context.subjectAt ? new Vector3(...context.subjectAt(from)) : focus;
    const isOrbit = ['orbit', 'half-orbit', 'spiral-rise', 'spiral-fall'].includes(id);
    const isFollow = ['follow', 'front-follow', 'side-follow'].includes(id);
    const samples = 64;
    const points: MotionPath['points'] = [],
        lookPoints: MotionPath['points'] = [];
    for (let index = 0; index <= samples; index++) {
        const u = index / samples,
            time = from + duration * u;
        const position = origin.clone(),
            look = focus.clone();
        const subject = context.subjectAt ? new Vector3(...context.subjectAt(time)) : focus.clone();
        if (isOrbit) {
            const angle = u * (id === 'half-orbit' ? Math.PI : Math.PI * 2);
            position
                .copy(offset)
                .applyAxisAngle(new Vector3(0, 1, 0), angle)
                .add(subject);
            if (id === 'spiral-rise' || id === 'spiral-fall') position.y += lift * u * (id === 'spiral-rise' ? 1 : -1);
            look.copy(subject);
        } else if (isFollow) {
            position.add(subject.clone().sub(subjectStart));
            if (id !== 'follow') {
                const yaw = context.subjectYaw ?? 0;
                const desired =
                    id === 'front-follow'
                        ? new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
                        : new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
                desired.multiplyScalar(Math.max(0.5, Math.hypot(offset.x, offset.z)));
                desired.y = offset.y;
                position.lerp(subject.clone().add(desired), Math.min(1, u * 4));
            }
            look.copy(subject);
        } else if (['tilt-up', 'tilt-down', 'pan-left', 'pan-right', 'whip-pan'].includes(id)) {
            let amount = u;
            if (id === 'whip-pan') amount = Math.max(0, Math.min(1, (u - 0.4) / 0.15));
            const direction = forward.clone();
            if (id === 'tilt-up' || id === 'tilt-down')
                direction.applyAxisAngle(right, ((amount * Math.PI) / 6) * (id === 'tilt-up' ? 1 : -1));
            else
                direction.applyAxisAngle(
                    new Vector3(0, 1, 0),
                    amount * (id === 'whip-pan' ? Math.PI / 2 : Math.PI / 4) * (id === 'pan-right' ? -1 : 1),
                );
            look.copy(origin).addScaledVector(direction, distance);
        } else if (id === 'handheld') {
            // Deterministic, starts at zero: scrub and exported frames reproduce the same shake.
            position.addScaledVector(right, Math.sin(u * Math.PI * 11) * distance * 0.007);
            position.addScaledVector(up, Math.sin(u * Math.PI * 17) * distance * 0.004);
            look.addScaledVector(right, Math.sin(u * Math.PI * 7) * distance * 0.012);
        } else if (id === 'reveal' || id === 'foreground-wipe') {
            const obstacle = new Vector3(...context.foreground!.center);
            const radius = Math.max(0.1, context.foreground!.radius);
            if (id === 'reveal') {
                const separation = obstacle.distanceTo(origin);
                const clearance = radius * Math.max(1, distance / Math.max(radius, separation));
                const side = obstacle.clone().sub(origin).dot(right) > 0 ? -1 : 1;
                position.addScaledVector(right, (clearance * 2 + distance * 0.3) * u * side);
            } else {
                // Cross the sight line just behind the chosen real foreground object.
                const crossing = obstacle.clone().addScaledVector(forward, -radius * 1.5);
                const end = origin.clone().addScaledVector(right, distance * 0.8 + radius * 2);
                // A quadratic curve passes the occluder at mid-shot and clears it again.
                const control = crossing
                    .clone()
                    .multiplyScalar(2)
                    .addScaledVector(origin, -0.5)
                    .addScaledVector(end, -0.5);
                position
                    .multiplyScalar((1 - u) ** 2)
                    .addScaledVector(control, 2 * u * (1 - u))
                    .addScaledVector(end, u * u);
            }
        } else {
            if (id === 'dolly-in' || id === 'dolly-zoom') position.addScaledVector(forward, distance * 0.45 * u);
            if (id === 'dolly-out') position.addScaledVector(forward, -distance * 0.55 * u);
            if (id === 'rise' || id === 'fall') position.y += lift * u * (id === 'rise' ? 1 : -1);
            if (id === 'truck' || id === 'truck-left')
                position.addScaledVector(right, distance * 0.75 * u * (id === 'truck' ? 1 : -1));
            if (id === 'fly-through' || id === 'fpv') {
                position.addScaledVector(forward, distance * (id === 'fpv' ? 2.5 : 1.5) * u);
                if (id === 'fpv') position.addScaledVector(right, Math.sin(u * Math.PI * 2) * distance * 0.12);
            }
            if (id === 'aerial') position.addScaledVector(right, distance * 0.8 * u).addScaledVector(up, lift * u);
            if (id === 'dive') position.addScaledVector(forward, distance * 0.65 * u).addScaledVector(up, -lift * u);
            if (id === 'pull-away') position.addScaledVector(forward, -distance * u).addScaledVector(up, lift * u);
            // Translations preserve orientation, unlike tracking/orbit moves.
            look.add(position.clone().sub(origin));
            if (['dolly-zoom', 'dive', 'pull-away', 'aerial'].includes(id)) look.copy(focus);
        }
        if (id === 'fall' || id === 'spiral-fall' || id === 'dive') {
            const before = position.y;
            position.y = Math.max(Math.min(origin.y, focus.y - 0.6), position.y);
            if (id === 'fall') look.y += position.y - before;
        }
        points.push({ time, position: position.toArray() as Vec3 });
        lookPoints.push({ time, position: look.toArray() as Vec3 });
    }
    let focalKeys: NumberKey[] | undefined;
    const clampFocal = (value: number) => Math.max(8, Math.min(300, value));
    if (id === 'zoom-in' || id === 'zoom-out' || id === 'snap-zoom' || id === 'dolly-zoom') {
        const end = clampFocal(focal * (id === 'zoom-out' ? 0.55 : id === 'dolly-zoom' ? 0.55 : 1.8));
        focalKeys =
            id === 'snap-zoom'
                ? [
                      { time: from, value: focal },
                      { time: from + duration * 0.4, value: focal },
                      { time: from + duration * 0.55, value: end },
                      { time: from + duration, value: end },
                  ]
                : [
                      { time: from, value: focal },
                      { time: from + duration, value: end },
                  ];
    }
    return {
        path: { smooth: true, interpolation: 'continuous', points },
        targetPath: { smooth: true, interpolation: 'continuous', points: lookPoints },
        ...(focalKeys ? { focalKeys } : {}),
    };
}

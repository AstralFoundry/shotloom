import * as T from 'three';
import type { Entity, RotationAnimation, Vec3 } from '../model.ts';
import { eased } from './channels.ts';

/** Angles are additive to the entity's base orientation; authored turns over 180° are preserved. */
export function rotationDegreesAt(animation: RotationAnimation, time: number): Vec3 {
    const keys = animation.keys;
    if (time <= keys[0].time) return keys[0].degrees;
    for (let index = 1; index < keys.length; index++) {
        const next = keys[index];
        if (time < next.time) {
            const previous = keys[index - 1];
            const amount = eased((time - previous.time) / (next.time - previous.time), previous.easing);
            return previous.degrees.map((angle, axis) => T.MathUtils.lerp(angle, next.degrees[axis], amount)) as Vec3;
        }
    }
    return keys[keys.length - 1].degrees;
}

/** Move an animation or one key by a frame-snapped delta without changing its angles. */
export function retimeRotationAnimation(
    animation: RotationAnimation,
    delta: number,
    fps: number,
    keyIndex?: number,
): RotationAnimation {
    if (!Number.isFinite(delta) || !Number.isFinite(fps) || fps <= 0) throw Error('旋转时间无效');
    const frame = 1 / fps;
    const keys = animation.keys.map((key) => ({ ...key }));
    if (keyIndex === undefined) {
        const shift = Math.max(-keys[0].time, Math.round(delta * fps) * frame);
        keys.forEach((key) => { key.time += shift; });
    } else {
        if (!Number.isInteger(keyIndex) || !keys[keyIndex]) throw Error('旋转关键帧不存在');
        const previous = keys[keyIndex - 1];
        const next = keys[keyIndex + 1];
        const requested = keys[keyIndex].time + Math.round(delta * fps) * frame;
        const minimum = previous
            ? previous.time + Math.min(frame, (keys[keyIndex].time - previous.time) / 2)
            : 0;
        const maximum = next
            ? next.time - Math.min(frame, (next.time - keys[keyIndex].time) / 2)
            : Infinity;
        keys[keyIndex].time = Math.max(minimum, Math.min(maximum, requested));
    }
    return { ...animation, keys };
}

/** Keep a local pivot fixed in world space while the object rotates on top of its path. */
export function applyEntityRotation(root: T.Object3D, entity: Entity, time: number): void {
    const animation = entity.rotationAnimation;
    if (!animation) return;
    const base = root.quaternion.clone();
    const pivot = new T.Vector3(...animation.pivot).multiply(root.scale);
    const worldOffset = pivot.clone().applyQuaternion(base);
    const angles = rotationDegreesAt(animation, time).map(T.MathUtils.degToRad) as Vec3;
    root.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(...angles)));
    root.position.add(worldOffset.sub(pivot.applyQuaternion(root.quaternion)));
}

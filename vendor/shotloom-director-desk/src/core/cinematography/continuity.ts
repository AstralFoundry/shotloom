import type { PerspectiveCamera } from 'three';
import type { Entity } from '../model.ts';
/** Preserve the captured ending optics when a camera is frozen into a free camera. */
export function freezeEndingCamera(entity: Entity, camera: PerspectiveCamera) {
    const c = entity.camera!;
    c.focal = camera.getFocalLength();
    delete c.focalKeys;
    if (c.mode === 'free') {
        c.aim = 'manual';
        c.targetPath = null;
    }
}

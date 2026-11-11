import type { Entity, Vec3 } from '../model.ts';

/** Ray hits are world coordinates. Cameras retain their height above the active floor,
 * including when drawing over steps; ordinary models are placed on the hit surface. */
export function pathDrawingPosition(point: Vec3, entity: Entity, floorElevation: number): Vec3 {
    const result: Vec3 = [...point];
    if (entity.kind === 'camera')
        result[1] += (entity.path?.points[0]?.position[1] ?? entity.position[1]) - floorElevation;
    return result;
}

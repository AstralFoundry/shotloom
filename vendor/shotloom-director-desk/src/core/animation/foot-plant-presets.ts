import type { FootPlantOptions } from './foot-plant-plan.ts';

// Contact intervals measured on the pinned CC0 source with inspect-motion-contacts.mjs.
// Conservative stance windows; they do not infer contact for arbitrary imported clips.
const windows: Record<string, [number, number, number, number]> = {
    'human-walk-v1': [0.02, 0.52, 0.52, 1.02],
    'human-jog-v1': [0.045, 0.17, 0.545, 0.67],
    'human-crouch-walk-v1': [0, 0.5, 0.52, 1],
};
export function footPlantProfile(id: string): FootPlantOptions | undefined {
    const w = windows[id];
    return w ? { mode: 'stance', left: [w[0], w[1]], right: [w[2], w[3]], fade: 0.04, maxCorrection: 0.25 } : undefined;
}

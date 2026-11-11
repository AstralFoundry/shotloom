import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { material, sphere, cylinder, box } from './geometry.ts';
import { scaleHuman } from './humanoid.ts';
import { assetParameters } from './parameters.ts';

/** Knuckle-supported ape proportions, using the shared front/rear limb controls. */
export function makePrimate(e: Entity): Rig {
    const { bodyRatio: body, widthRatio: width, legRatio: leg, headRatio } = assetParameters(e);
    // Lengthen both arm segments to keep the knuckles and rear feet on the same floor.
    const armLength = 1 + (0.6 * (leg - 1) + 0.4 * (body - 1)) / 0.96;
    const root = new T.Group(),
        hips = new T.Group();
    root.add(hips);
    hips.position.y = 0.63 + 0.6 * (leg - 1);
    const skin = material(e.color),
        joints: Record<string, T.Group> = {};
    const joint = (name: string, parent: T.Object3D, x: number, y: number, z = 0) => {
        const group = new T.Group();
        group.position.set(x, y, z);
        parent.add(group);
        joints[name] = group;
        return group;
    };
    const torso = joint('torso', hips, 0, 0);
    sphere(torso, skin, 0, 0.26 * body, 0.04 * body, 0.31 * width, 0.43 * body, 0.23 * body).rotation.x = 0.25;
    sphere(torso, skin, 0, 0.39 * body, 0.13 * body, 0.39 * width, 0.29 * body, 0.21 * body);
    sphere(hips, skin, 0, 0.02, -0.1 * body, 0.23 * width, 0.24, 0.2 * body);
    const head = joint('head', torso, 0, 0.7 * body, 0.26 * body);
    head.scale.setScalar(headRatio);
    sphere(head, skin, 0, 0.02, 0, 0.18, 0.22, 0.17);
    sphere(head, skin, 0, -0.065, 0.1, 0.145, 0.135, 0.13);
    sphere(head, skin, 0, 0.055, 0.14, 0.17, 0.042, 0.035);
    for (const [side, sign] of [
        ['left', -1],
        ['right', 1],
    ] as const) {
        sphere(head, skin, sign * 0.177, 0.015, -0.025, 0.035, 0.05, 0.024);
        const arm = joint(side + 'Arm', torso, sign * 0.34 * width, 0.4 * body, 0.12 * body);
        sphere(arm, skin, 0, -0.05, 0, 0.13 * width, 0.18, 0.13);
        cylinder(arm, skin, 0.105, 0.072, 0.5 * armLength, 0, -0.25 * armLength);
        const elbow = joint(side + 'Elbow', arm, 0, -0.5 * armLength);
        sphere(elbow, skin, 0, 0, 0, 0.073);
        cylinder(elbow, skin, 0.085, 0.058, 0.46 * armLength, 0, -0.23 * armLength);
        box(elbow, skin, 0.15, 0.11, 0.18, 0, -0.475 - 0.46 * (armLength - 1), 0.03, 0.03);
        const hip = joint(side + 'Hip', hips, sign * 0.155 * width, 0, -0.15 * body);
        cylinder(hip, skin, 0.12, 0.075, 0.3 * leg, 0, -0.15 * leg);
        const knee = joint(side + 'Knee', hip, 0, -0.3 * leg);
        sphere(knee, skin, 0, 0, 0, 0.075);
        cylinder(knee, skin, 0.07, 0.042, 0.3 * leg, 0, -0.15 * leg);
        sphere(knee, skin, 0, -0.3 * leg, 0.045, 0.08, 0.03, 0.14);
    }
    root.updateMatrixWorld(true);
    const rig: Rig = {
        root,
        hips,
        joints,
        skin,
        head,
        referenceHeight: new T.Box3().setFromObject(root, true).max.y,
        restHipHeight: hips.position.y,
        headRestHeight: hips.position.y + 0.7 * body,
    };
    scaleHuman(rig, e);
    return rig;
}

// Preserve the legacy skeleton and dimensions for existing projects.
import * as T from 'three';
import type { Entity } from '../model.ts';
import { material, sphere, cylinder } from './geometry.ts';
import { humanSurfaces, rebaseHumanSurface, humanSurfaceSlot } from './human-surfaces.ts';
export interface Rig {
    poseAxes?: Record<string, 'x' | 'y' | 'z'>;
    poseSigns?: Record<string, number>;
    root: T.Group;
    hips: T.Group;
    joints: Record<string, T.Group>;
    skin: T.MeshStandardMaterial;
    head: T.Group;
    referenceHeight?: number;
    restHipHeight?: number;
    headRestHeight?: number;
    legLengths?: { upper: number; lower: number };
    jointSkin?: T.MeshStandardMaterial;
}
export function makeHuman(e: Entity): Rig {
    const root = new T.Group(),
        hips = new T.Group();
    root.add(hips);
    hips.position.y = 0.94;
    const skin = material(e.color),
        jointMat = material(new T.Color(e.color).multiplyScalar(0.91));
    const surfaces = humanSurfaces();
    const joints: Record<string, T.Group> = {};
    const makeJoint = (name: string, parent: T.Object3D, x: number, y: number, z = 0) => {
        const g = new T.Group();
        g.position.set(x, y, z);
        parent.add(g);
        joints[name] = g;
        return g;
    };
    rebaseHumanSurface(surfaces.pelvis(hips, skin, 0.155, 0.112), new T.Vector3(), new T.Vector3(0.155, 0.12, 0.112));
    const torso = makeJoint('torso', hips, 0, 0.1);
    rebaseHumanSurface(
        surfaces.torso(torso, skin, 0.38, e.gender === 'female' ? 0.157 : 0.174, 0.13, 0.106),
        new T.Vector3(0, 0.105, 0),
        new T.Vector3(0.133, 0.19, 0.092),
    );
    humanSurfaceSlot(
        torso,
        new T.Vector3(0, 0.255, 0),
        new T.Vector3(e.gender === 'female' ? 0.157 : 0.174, 0.18, 0.106),
    );
    const neck = cylinder(torso, skin, 0.046, 0.058, 0.12, 0, 0.432);
    neck.castShadow = true;
    const head = makeJoint('head', torso, 0, 0.49);
    sphere(head, skin, 0, 0.105, 0.006, 0.095, 0.115, 0.094);
    sphere(head, skin, 0, 0.045, 0.028, 0.077, 0.055, 0.076);
    // A small nose establishes facing direction without facial expression detail.
    sphere(head, skin, 0, 0.084, 0.096, 0.018, 0.026, 0.025);
    for (const side of ['left', 'right']) {
        const sign = side === 'left' ? -1 : 1;
        const arm = makeJoint(`${side}Arm`, torso, sign * (e.gender === 'female' ? 0.165 : 0.188), 0.31);
        surfaces.joint(arm, skin, 0.054);
        const upper = surfaces.limb(arm, skin, 0.285, 0.057, 0.039, 0.95);
        upper.position.y = -0.135;
        upper.rotation.z = sign * 0.04;
        const elbow = makeJoint(`${side}Elbow`, arm, 0, -0.285);
        surfaces.joint(elbow, skin, 0.036);
        surfaces.limb(elbow, skin, 0.24, 0.041, 0.027, 0.93).position.y = -0.116;
        rebaseHumanSurface(
            surfaces.hand(elbow, skin, 0.24),
            new T.Vector3(0, -0.277, 0.01),
            new T.Vector3(0.033, 0.065, 0.023),
        );
        const hip = makeJoint(`${side}Hip`, hips, sign * 0.09, -0.015);
        surfaces.limb(hip, skin, 0.43, 0.085, 0.057, 0.96).position.y = -0.21;
        humanSurfaceSlot(hip, new T.Vector3(0, -0.04, 0), new T.Vector3(0.078, 0.11, 0.079));
        const knee = makeJoint(`${side}Knee`, hip, 0, -0.43);
        surfaces.joint(knee, skin, 0.049);
        surfaces.limb(knee, skin, 0.458, 0.06, 0.032, 1.03).position.y = -0.215;
        humanSurfaceSlot(knee, new T.Vector3(0, -0.16, -0.012), new T.Vector3(0.055, 0.14, 0.057));
        sphere(knee, skin, 0, -0.424, 0, 0.028, 0.03, 0.029);
        const ankle = makeJoint(`${side}Ankle`, knee, 0, -0.458);
        surfaces.foot(ankle, skin, 0.05);
    }
    scaleLegacyHuman(root, e);
    return { root, hips, joints, skin, head, jointSkin: jointMat };
}
export function scaleLegacyHuman(root: T.Group, e: Pick<Entity, 'height' | 'build'>) {
    const build = e.build === 'slim' ? 0.87 : e.build === 'broad' ? 1.2 : 1;
    root.scale.set((e.height / 1.75) * build, e.height / 1.75, e.height / 1.75);
}

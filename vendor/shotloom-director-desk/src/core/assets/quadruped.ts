import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { QUADRUPED_SHAPES } from './catalog/animals.ts';
import { material, sphere, cylinder, box, mesh } from './geometry.ts';
import { scaleHuman } from './humanoid.ts';
export { poseAnimal as poseQuadruped } from './rig-pose.ts';
import { addAnimalDetails } from './animal-details.ts';
import { makePrimate } from './primate.ts';
import { animalShape } from './animal-parameters.ts';

export function makeQuadruped(e: Entity): Rig {
    const base = QUADRUPED_SHAPES[e.asset];
    if (!base) throw new Error(`未知四足白模：${e.asset}`);
    const p = animalShape(e, base);
    if (p.species === 'gorilla') return makePrimate(e);
    const root = new T.Group(),
        hips = new T.Group();
    root.add(hips);
    const skin = material(e.color),
        jointSkin = material(new T.Color(e.color).multiplyScalar(0.91));
    const joints: Record<string, T.Group> = {};
    const joint = (name: string, parent: T.Object3D, x: number, y: number, z: number) => {
        const g = new T.Group();
        g.position.set(x, y, z);
        parent.add(g);
        joints[name] = g;
        return g;
    };
    const hoof = 0.055;
    hips.position.y = p.leg + hoof / 2;
    const torso = joint('torso', hips, 0, 0, 0);
    if (p.species === 'turtle') sphere(torso, skin, 0, 0.025, 0, p.width * 1.2, 0.055, p.body * 0.58);
    else {
        sphere(torso, skin, 0, p.width * 0.45, 0, p.width, p.width * 0.9, p.body * 0.62);
        sphere(torso, skin, 0, 0.06, -p.body * 0.32, p.width * 0.92, p.width * 0.88, p.body * 0.28);
    }
    sphere(torso, skin, 0, p.neck / 2 + 0.06, p.body * 0.42, p.width * 0.6, p.neck / 2 + 0.1, p.width * 0.65);
    const head = joint('head', torso, 0, p.neck + 0.1, p.body * 0.46);
    sphere(head, skin, 0, p.head * 0.45, 0.04, p.head * 0.7, p.head * 0.9, p.head);
    sphere(head, skin, 0, p.head * 0.15, p.head + p.muzzle * 0.45, p.head * 0.54, p.head * 0.48, p.muzzle);
    for (const sign of [-1, 1]) {
        if (p.ear > 0) {
            const ear = sphere(
                head,
                skin,
                sign * p.head * 0.52,
                p.head * 1.1 + p.ear / 2,
                -0.005,
                p.head * 0.21,
                p.ear / 2,
                0.035,
            );
            ear.rotation.z = sign * -0.2;
        }
        if (p.horn) {
            const horn = mesh(
                head,
                new T.ConeGeometry(0.035, p.species === 'deer' ? 0.32 : 0.2, 8),
                jointSkin,
                sign * p.head * 0.6,
                p.head * 1.65,
                -0.04,
            );
            horn.rotation.z = sign * -0.4;
            if (p.species === 'deer')
                for (const dz of [0, 0.08]) {
                    const tine = mesh(
                        head,
                        new T.ConeGeometry(0.018, 0.12, 6),
                        jointSkin,
                        sign * p.head * 0.82,
                        p.head * 1.9 + dz,
                        dz,
                    );
                    tine.rotation.z = sign * -0.8;
                }
        }
    }
    for (const side of ['left', 'right'])
        for (const front of [true, false]) {
            const sign = side === 'left' ? -1 : 1,
                z = (front ? 1 : -1) * p.body * 0.34;
            const upper = joint(side + (front ? 'Arm' : 'Hip'), torso, sign * p.width * 0.68, 0, z);
            const radius =
                p.species === 'elephant'
                    ? 0.1
                    : p.species === 'bear'
                      ? 0.075
                      : ['lion', 'tiger'].includes(p.species)
                        ? 0.055
                        : p.hoof
                          ? 0.04
                          : 0.036;
            cylinder(upper, skin, radius * 1.5, radius, p.leg * 0.5, 0, -p.leg * 0.25);
            const lower = joint(side + (front ? 'Elbow' : 'Knee'), upper, 0, -p.leg * 0.5, 0);
            sphere(lower, jointSkin, 0, 0, 0, radius);
            cylinder(lower, skin, radius, radius * 0.75, p.leg * 0.5, 0, -p.leg * 0.25);
            if (p.hoof) box(lower, jointSkin, radius * 2.2, hoof, radius * 3, 0, -p.leg * 0.5, radius * 0.4, 0.012);
            else sphere(lower, skin, 0, -p.leg * 0.5, radius * 0.4, radius * 1.3, hoof / 2, radius * 1.75);
        }
    if (p.tail > 0) {
        const tail = sphere(
            torso,
            skin,
            0,
            p.width * 0.28,
            -p.body * 0.6 - p.tail * 0.32,
            p.species === 'cat' ? 0.025 : 0.045,
            0.05,
            p.tail * 0.5,
        );
        tail.rotation.x = -0.25;
    }
    if (p.species === 'horse') {
        sphere(torso, jointSkin, 0, p.neck * 0.65, p.body * 0.36, 0.034, p.neck * 0.6, 0.07);
        sphere(torso, jointSkin, 0, -p.tail * 0.2, -p.body * 0.61, 0.05, p.tail * 0.5, 0.06);
    }
    if (p.species === 'sheep' && !p.horn) {
        for (const z of [-0.22, 0, 0.22])
            for (const x of [-p.width * 0.55, p.width * 0.55])
                sphere(torso, skin, x, p.width * 0.5, z * (p.body / 0.8), p.width * 0.62, p.width * 0.8, 0.2);
    }
    addAnimalDetails(torso, head, p, skin);
    root.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(root, true);
    // Short-legged pets may have a belly below the foot baseline; lift the whole rig.
    hips.position.y -= bounds.min.y;
    root.updateMatrixWorld(true);
    const referenceHeight = new T.Box3().setFromObject(root, true).max.y;
    const rig: Rig = {
        root,
        hips,
        joints,
        skin,
        jointSkin,
        head,
        referenceHeight,
        restHipHeight: hips.position.y,
        headRestHeight: hips.position.y + p.neck + 0.1,
    };
    scaleHuman(rig, e);
    return rig;
}

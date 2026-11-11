import * as T from 'three';
import type { Rig } from './human-legacy.ts';
import type { HumanProportions } from './catalog/humans.ts';
import { box, cylinder, mesh, sphere } from './geometry.ts';

/** Costume meshes use the same pose joints as the body. */
export function addHumanCostume(r: Rig, p: HumanProportions, lengthRatio = 1, thickness = 1) {
    const { head, hips, joints, skin } = r,
        torso = joints.torso;
    if (!p.outfit) return;
    const existing = new Set<T.Object3D>();
    r.root.traverse((object) => existing.add(object));
    const girth = Math.sqrt(p.girth),
        shoulder = p.shoulder / 0.19,
        bodyLength = p.torso / 0.44;
    const jacket = ['casual', 'robe', 'armor', 'uniform'].includes(p.outfit);
    if (jacket) {
        box(torso, skin, p.shoulder * 1.85, p.torso * 0.75, 0.25 * p.girth, 0, p.torso * 0.43, 0, 0.03);
        for (const side of ['left', 'right']) {
            cylinder(
                joints[side + 'Arm'],
                skin,
                0.064 * girth,
                0.055 * girth,
                p.upperArm * (p.outfit === 'casual' ? 0.5 : 0.94) * lengthRatio,
                0,
                -p.upperArm * (p.outfit === 'casual' ? 0.25 : 0.47) * lengthRatio,
            );
            if (p.outfit === 'armor') sphere(joints[side + 'Arm'], skin, 0, 0, 0, 0.085 * girth, 0.06, 0.075 * girth);
        }
    }
    if (p.outfit === 'dress' || p.outfit === 'robe') {
        const length = (p.thigh + p.shin) * 0.9 * lengthRatio;
        for (const side of ['left', 'right']) {
            // Separate overlapping panels follow each thigh; no cloth simulation is implied.
            const panel = mesh(
                joints[side + 'Hip'],
                new T.CylinderGeometry(0.095 * girth, 0.18 * girth, length, 12, 1, true),
                skin,
                0,
                -length / 2,
                0.015,
            );
            panel.scale.z = 1.15;
        }
        if (p.outfit === 'dress')
            sphere(torso, skin, 0, p.torso * 0.48, 0, p.shoulder * 0.95, p.torso * 0.49, 0.125 * p.girth);
    }
    if (p.outfit === 'uniform') {
        for (const x of [-0.075, 0.075])
            box(
                torso,
                skin,
                0.08 * shoulder,
                0.08 * bodyLength,
                0.015,
                x * shoulder,
                p.torso * 0.55,
                0.145 * p.girth,
                0.005,
            );
        box(hips, skin, p.pelvis * 3.2, 0.035, 0.23 * p.girth, 0, 0.065, 0, 0.008);
    }
    if (p.outfit === 'helmet') {
        mesh(
            head,
            new T.SphereGeometry(p.head * 0.76, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.54),
            skin,
            0,
            p.head * 1.35,
            0,
        );
        cylinder(head, skin, p.head * 0.82, p.head * 0.82, 0.022, 0, p.head * 1.34);
    }
    if (p.outfit === 'hat') {
        cylinder(head, skin, p.head * 1.28, p.head * 1.28, 0.022, 0, p.head * 1.7);
        cylinder(head, skin, p.head * 0.62, p.head * 0.69, p.head * 0.65, 0, p.head * 2.02);
    }
    if (p.outfit === 'backpack') {
        box(torso, skin, 0.28 * shoulder, 0.36 * bodyLength, 0.17 * p.girth, 0, p.torso * 0.45, -0.18 * p.girth, 0.035);
        box(torso, skin, 0.22 * shoulder, 0.16 * bodyLength, 0.065 * p.girth, 0, p.torso * 0.2, -0.29 * p.girth, 0.025);
        for (const x of [-0.11, 0.11])
            box(torso, skin, 0.033, p.torso * 0.75, 0.025, x * shoulder, p.torso * 0.48, 0.118 * p.girth, 0.008);
    }
    r.root.traverse((object) => {
        if (existing.has(object) || !(object instanceof T.Mesh)) return;
        object.userData.costume = p.outfit;
        // Expand the outer silhouette around each joint, preserving attachment and height.
        // Default thickness leaves the historical preset geometry untouched.
        if (thickness !== 1) {
            object.geometry.computeBoundingBox();
            const size = object.geometry.boundingBox!.getSize(new T.Vector3()),
                padding = 0.01 * (thickness - 1);
            object.geometry.scale(1 + (2 * padding) / size.x, 1, 1 + (2 * padding) / size.z);
        }
    });
}

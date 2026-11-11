import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { humanShape } from './human-parameters.ts';

const mannequinAssets = new Set([
    'person',
    'woman',
    'crowd',
    'human-adult',
    'human-female',
    'human-child',
    'human-teen',
    'human-elder',
    'human-slender',
    'human-muscular',
    'human-full',
]);

function finish(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z = 0) {
    const object = new T.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.studioVisual = true;
    parent.add(object);
    return object;
}

function rounded(
    parent: T.Object3D,
    material: T.Material,
    width: number,
    height: number,
    depth: number,
    radius: number,
    x: number,
    y: number,
    z = 0,
) {
    return finish(
        parent,
        new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width / 3, height / 3, depth / 3)),
        material,
        x,
        y,
        z,
    );
}

function segment(parent: T.Object3D, material: T.Material, width: number, length: number, depth: number, y: number) {
    return rounded(parent, material, width, length * 0.91, depth, width * 0.32, 0, y);
}

function sculptColor(material: T.MeshStandardMaterial, color: string, shade = 0) {
    material.color.set(shade ? '#d9d8d5' : '#f3f2ef').lerp(new T.Color(color), 0.08);
    material.roughness = 0.68;
    material.metalness = 0;
}

/** Original geometry mounted on the existing pose rig; no external mesh or skeleton is used. */
export function attachStudioMannequin(rig: Rig, entity: Entity): void {
    if (!mannequinAssets.has(entity.asset) || rig.root.userData.studioMannequin) return;
    const profile = humanShape(entity)?.proportions;
    if (profile?.form) return;
    const p = profile ?? {
        thigh: 0.43,
        shin: 0.458,
        torso: 0.38,
        upperArm: 0.285,
        forearm: 0.24,
        shoulder: entity.gender === 'female' ? 0.165 : 0.188,
        pelvis: 0.09,
        head: 0.13,
        girth: 1,
    };
    rig.root.traverse((node) => {
        if (node instanceof T.Mesh && !node.userData.costume) node.visible = false;
    });
    sculptColor(rig.skin, entity.color);
    if (rig.jointSkin) sculptColor(rig.jointSkin, entity.color, 1);
    const body = rig.skin;
    const inset = rig.jointSkin ?? body;
    const fullness = Math.sqrt(p.girth);
    const torso = rig.joints.torso;
    const torsoWidth = p.shoulder * 1.94;
    rounded(rig.hips, body, p.pelvis * 2.5, 0.18, 0.2 * fullness, 0.055, 0, 0).name = 'StudioPelvis';
    rounded(torso, body, torsoWidth, p.torso * 0.96, 0.235 * fullness, 0.065, 0, p.torso * 0.48).name = 'StudioTorso';
    rounded(torso, inset, 0.09, 0.09, 0.09, 0.025, 0, p.torso + 0.035);
    const headRadius = Math.min(p.shoulder * 0.91, p.head * 1.16);
    const headTop = profile ? p.head * 2 : 0.22;
    const head = finish(rig.head, new T.SphereGeometry(1, 32, 20), body, 0, headTop - headRadius * 1.04);
    head.name = 'StudioHead';
    head.scale.set(headRadius * 0.96, headRadius * 1.04, headRadius);

    for (const side of ['left', 'right']) {
        const arm = rig.joints[side + 'Arm'];
        const elbow = rig.joints[side + 'Elbow'];
        const hip = rig.joints[side + 'Hip'];
        const knee = rig.joints[side + 'Knee'];
        const ankle = rig.joints[side + 'Ankle'];
        const upper = segment(arm, body, 0.122 * fullness, p.upperArm, 0.13 * fullness, -p.upperArm * 0.49);
        upper.rotation.z = side === 'left' ? -0.035 : 0.035;
        finish(elbow, new T.SphereGeometry(0.043 * fullness, 16, 12), inset, 0, 0);
        segment(elbow, body, 0.105 * fullness, p.forearm, 0.11 * fullness, -p.forearm * 0.49);
        rounded(elbow, body, 0.097 * fullness, 0.125, 0.092 * fullness, 0.035, 0, -p.forearm - 0.052).name =
            `Studio${side}Hand`;
        segment(hip, body, 0.158 * fullness, p.thigh, 0.16 * fullness, -p.thigh * 0.49);
        finish(knee, new T.SphereGeometry(0.058 * fullness, 16, 12), inset, 0, 0);
        segment(knee, body, 0.138 * fullness, p.shin, 0.145 * fullness, -p.shin * 0.49);
        rounded(ankle, body, 0.145 * fullness, 0.125, 0.235, 0.045, 0, -0.026, 0.068);
    }
    rig.root.userData.studioMannequin = true;
}

export function colorStudioMannequin(rig: Rig, color: string): void {
    if (!rig.root.userData.studioMannequin) return;
    sculptColor(rig.skin, color);
    if (rig.jointSkin) sculptColor(rig.jointSkin, color, 1);
}

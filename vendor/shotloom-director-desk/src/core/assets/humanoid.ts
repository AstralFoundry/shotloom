import * as T from 'three';
import type { Entity } from '../model.ts';
import { humanShape } from './human-parameters.ts';
import { makeHuman as makeLegacyHuman, type Rig } from './human-legacy.ts';
import { material, sphere, cylinder } from './geometry.ts';
import { addHumanDetails } from './human-details.ts';
import { addHumanCostume } from './human-costume.ts';
import { humanSurfaces, rebaseHumanSurface, humanSurfaceSlot } from './human-surfaces.ts';
import { attachStudioMannequin, colorStudioMannequin } from './studio-mannequin.ts';

export function makeHuman(e: Entity): Rig {
    const shape = humanShape(e);
    if (!shape) {
        const rig = makeLegacyHuman(e);
        attachStudioMannequin(rig, e);
        return rig;
    }
    const p = shape.proportions;
    const root = new T.Group(),
        hips = new T.Group();
    root.add(hips);
    const skin = material(e.color),
        jointSkin = material(new T.Color(e.color).multiplyScalar(0.91));
    const surfaces = humanSurfaces(),
        girth = Math.sqrt(p.girth);
    const joints: Record<string, T.Group> = {};
    function joint(name: string, parent: T.Object3D, x: number, y: number, z = 0) {
        const g = new T.Group();
        g.position.set(x, y, z);
        parent.add(g);
        joints[name] = g;
        return g;
    }
    const restHipHeight = p.thigh + p.shin + 0.037;
    hips.position.y = restHipHeight;
    rebaseHumanSurface(
        surfaces.pelvis(hips, skin, p.pelvis * 1.65, 0.108 * p.girth),
        new T.Vector3(0, 0.02, 0),
        new T.Vector3(p.pelvis * 1.6, 0.12, 0.105 * p.girth),
    );
    const torso = joint('torso', hips, 0, 0.08);
    if (p.form !== 'skeleton') {
        rebaseHumanSurface(
            surfaces.torso(torso, skin, p.torso, p.shoulder * 0.86, p.shoulder * 0.65 * girth, 0.11 * p.girth),
            new T.Vector3(0, p.torso * 0.27, 0),
            new T.Vector3(p.shoulder * 0.7, p.torso * 0.38, 0.1 * p.girth),
        );
        humanSurfaceSlot(
            torso,
            new T.Vector3(0, p.torso * 0.65, 0),
            new T.Vector3(p.shoulder * 0.86, p.torso * 0.35, 0.11 * p.girth),
        );
    }
    cylinder(torso, skin, 0.045, 0.055, 0.09, 0, p.torso + 0.02);
    const head = joint('head', torso, 0, p.torso + 0.055);
    rebaseHumanSurface(
        surfaces.head(head, skin, p.head),
        new T.Vector3(0, p.head, 0),
        new T.Vector3(p.head * 0.64, p.head, p.head * 0.66),
    );
    sphere(head, skin, 0, p.head * 0.76, p.head * 0.67, 0.018, 0.025, 0.026);
    for (const side of ['left', 'right']) {
        const sign = side === 'left' ? -1 : 1;
        const arm = joint(`${side}Arm`, torso, sign * p.shoulder, p.torso * 0.78);
        surfaces.joint(arm, skin, 0.049 * girth);
        surfaces.limb(arm, skin, p.upperArm, 0.054 * girth, 0.037 * girth, 0.95);
        const elbow = joint(`${side}Elbow`, arm, 0, -p.upperArm);
        surfaces.joint(elbow, skin, 0.034 * girth);
        surfaces.limb(elbow, skin, p.forearm, 0.042 * girth, 0.026, 0.93);
        rebaseHumanSurface(
            surfaces.hand(elbow, skin, p.forearm),
            new T.Vector3(0, -p.forearm - 0.045, 0.012),
            new T.Vector3(0.033, 0.057, 0.025),
        );
        const hip = joint(`${side}Hip`, hips, sign * p.pelvis, 0);
        surfaces.limb(hip, skin, p.thigh, 0.084 * girth, 0.052, 0.96);
        const knee = joint(`${side}Knee`, hip, 0, -p.thigh);
        surfaces.joint(knee, skin, 0.048);
        surfaces.limb(knee, skin, p.shin, 0.054, 0.029, 1.03);
        const ankle = joint(`${side}Ankle`, knee, 0, -p.shin);
        surfaces.foot(ankle, skin);
    }
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
        restHipHeight,
        headRestHeight: restHipHeight + 0.08 + p.torso + 0.055,
        legLengths: { upper: p.thigh, lower: p.shin },
    };
    addHumanDetails(rig, p);
    for (const outfit of shape.costumes) addHumanCostume(rig, { ...p, outfit }, shape.length, shape.thickness);
    scaleHuman(rig, e);
    attachStudioMannequin(rig, e);
    return rig;
}

export function scaleHuman(rig: Rig, e: Entity) {
    const h = e.height / (rig.referenceHeight ?? 1.75);
    rig.root.scale.set(
        h * e.scale[0] * (e.build === 'slim' ? 0.87 : e.build === 'broad' ? 1.2 : 1),
        h * e.scale[1],
        h * e.scale[2],
    );
}
export function colorHuman(rig: Rig, color: string) {
    rig.skin.color.set(color);
    rig.jointSkin?.color.set(color).multiplyScalar(0.91);
    colorStudioMannequin(rig, color);
}

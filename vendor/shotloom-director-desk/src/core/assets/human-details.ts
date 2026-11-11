import * as T from 'three';
import type { Rig } from './human-legacy.ts';
import type { HumanProportions } from './catalog/humans.ts';
import { box, cylinder, mesh, sphere } from './geometry.ts';

/** Species details are attached to the same body joints used by animation. */
export function addHumanDetails(r: Rig, p: HumanProportions) {
    const { head, joints, skin } = r,
        torso = joints.torso;
    if (p.form === 'elf')
        for (const sign of [-1, 1]) {
            const ear = mesh(head, new T.ConeGeometry(0.025, 0.15, 6), skin, sign * p.head * 0.85, p.head * 1.05, 0);
            ear.rotation.z = -sign * Math.PI * 0.35;
        }
    if (p.form === 'orc') {
        sphere(head, skin, 0, p.head * 0.45, p.head * 0.4, p.head * 0.67, p.head * 0.42, p.head * 0.52);
        for (const x of [-0.047, 0.047])
            mesh(head, new T.ConeGeometry(0.018, 0.075, 8), skin, x, p.head * 0.55, p.head * 0.8);
    }
    if (p.form === 'robot') {
        box(torso, skin, p.shoulder * 1.6, p.torso * 0.7, 0.25, 0, p.torso * 0.48, 0, 0.025);
        box(head, skin, p.head * 1.25, p.head * 1.6, p.head * 1.3, 0, p.head, 0, 0.015);
        for (const side of ['left', 'right'])
            box(joints[side + 'Arm'], skin, 0.11, p.upperArm * 0.7, 0.11, 0, -p.upperArm * 0.4);
    }
    if (p.form === 'skeleton') {
        cylinder(torso, skin, 0.023, 0.03, p.torso, 0, p.torso / 2);
        for (let i = 0; i < 6; i++) {
            const rib = new T.TorusGeometry(p.shoulder * (0.6 + Math.sin((i / 5) * Math.PI) * 0.15), 0.01, 6, 20);
            rib.rotateX(Math.PI / 2);
            const m = mesh(torso, rib, skin, 0, p.torso * (0.35 + i * 0.095), 0);
            m.scale.z = 0.75;
        }
        box(torso, skin, 0.026, p.torso * 0.5, 0.02, 0, p.torso * 0.6, p.shoulder * 0.52, 0.004);
    }
}

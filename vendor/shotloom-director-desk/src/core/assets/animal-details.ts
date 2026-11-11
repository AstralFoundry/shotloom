import * as T from 'three';
import type { QuadrupedShape } from './catalog/animals.ts';
import { sphere, mesh, cylinder } from './geometry.ts';

export function addAnimalDetails(torso: T.Group, head: T.Group, p: QuadrupedShape, skin: T.Material) {
    if (p.species === 'turtle') {
        const shell = mesh(torso, new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0, 0.06, 0);
        shell.scale.set(p.width * 1.3, 0.28, p.body * 0.62);
        const rim = cylinder(torso, skin, 1, 1, 0.025, 0, 0.06, 0);
        rim.scale.set(p.width * 1.3, 1, p.body * 0.62);
    }
    if (p.species === 'camel')
        for (const z of [-0.24, 0.16])
            sphere(torso, skin, 0, p.width * 1.35, z * (p.body / 0.95), p.width * 0.75, p.width * 1.0, p.body * 0.2);
    if (p.species === 'lion')
        sphere(head, skin, 0, p.head * 0.45, -p.head * 0.3, p.head * 1.35, p.head * 1.35, p.head * 0.8);
    if (p.species === 'elephant') {
        for (const sign of [-1, 1]) {
            const ear = sphere(
                head,
                skin,
                sign * p.head * 0.83,
                p.head * 0.45,
                -0.04,
                p.head * 0.6 * (p.ear / 0.08),
                p.head * 0.95 * (p.ear / 0.08),
                0.05,
            );
            ear.userData.animalPart = 'ear';
            const tusk = mesh(head, new T.ConeGeometry(0.035, 0.32, 8), skin, sign * p.head * 0.4, -0.1, p.head * 0.83);
            tusk.rotation.x = Math.PI * 0.35;
        }
        const points = [
            new T.Vector3(0, 0.1, p.head),
            new T.Vector3(0, -0.12, p.head + 0.13),
            new T.Vector3(0, -0.4, p.head + 0.18),
            new T.Vector3(0, -0.65, p.head + 0.1),
        ];
        const ratio = p.muzzle / 0.08;
        if (ratio !== 1)
            for (const point of points) {
                point.y = 0.1 + (point.y - 0.1) * ratio;
                point.z = p.head + (point.z - p.head) * ratio;
            }
        const trunk = mesh(head, new T.TubeGeometry(new T.CatmullRomCurve3(points), 16, 0.065, 8, false), skin);
        trunk.userData.animalPart = 'trunk';
    }
    if (p.species === 'giraffe')
        for (const x of [-0.07, 0.07]) {
            cylinder(head, skin, 0.016, 0.02, 0.16, x, p.head * 1.55, -0.01);
            sphere(head, skin, x, p.head * 1.55 + 0.08, -0.01, 0.027);
        }
}

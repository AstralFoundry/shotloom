import * as T from 'three';
import type { QuadrupedShape } from './catalog/animals.ts';
import type { Entity } from '../model.ts';
import { sphere, mesh, cylinder, material } from './geometry.ts';

export function addAnimalDetails(torso: T.Group, head: T.Group, p: QuadrupedShape, skin: T.Material) {
    if (p.species === 'turtle') {
        const shellSkin = material('#586344');
        const shell = mesh(
            torso,
            new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
            shellSkin,
            0,
            0.06,
            0,
        );
        shell.scale.set(p.width * 1.3, 0.28, p.body * 0.62);
        const rim = cylinder(torso, skin, 1, 1, 0.025, 0, 0.06, 0);
        rim.scale.set(p.width * 1.3, 1, p.body * 0.62);
    }
    if (p.species === 'camel')
        for (const z of [-0.24, 0.16])
            sphere(torso, skin, 0, p.width * 1.35, z * (p.body / 0.95), p.width * 0.75, p.width * 1.0, p.body * 0.2);
    if (p.species === 'lion') {
        const mane = material('#735238');
        for (let i = 0; i < 11; i++) {
            const a = (i / 11) * Math.PI * 2;
            sphere(
                head,
                mane,
                Math.sin(a) * p.head * 0.85,
                p.head * 0.45 + Math.cos(a) * p.head * 0.9,
                -p.head * 0.27,
                p.head * 0.48,
                p.head * 0.52,
                p.head * 0.65,
            );
        }
    }
    if (p.species === 'elephant') {
        const ivory = material('#d7cbae');
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
            const tusk = mesh(
                head,
                new T.ConeGeometry(0.035, 0.32, 8),
                ivory,
                sign * p.head * 0.4,
                -0.1,
                p.head * 0.83,
            );
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

/** Geometry-bound markings remain attached to each articulated part when posed. */
export function finishAnimalCoat(
    root: T.Group,
    torso: T.Group,
    head: T.Group,
    p: QuadrupedShape,
    e: Entity,
    skin: T.MeshStandardMaterial,
) {
    const pale = material('#d9cbb2'),
        dark = material('#51483b');
    const tube = (parent: T.Group, points: number[][], radius: number, surface: T.Material) =>
        mesh(
            parent,
            new T.TubeGeometry(
                new T.CatmullRomCurve3(points.map((v) => new T.Vector3(...(v as [number, number, number])))),
                20,
                radius,
                7,
                false,
            ),
            surface,
        );
    if (p.ear > 0 && p.species !== 'elephant') {
        const inner = material('#b78e7f');
        for (const sign of [-1, 1]) {
            const ear = sphere(
                head,
                inner,
                sign * p.head * 0.52,
                p.head * 1.1 + p.ear * 0.53,
                0.027,
                p.head * 0.11,
                p.ear * 0.31,
                0.012,
            );
            ear.rotation.z = sign * -0.2;
        }
    }
    // Catchlights and lower jaw give the face a readable direction at thumbnail size.
    for (const sign of [-1, 1]) sphere(head, pale, sign * p.head * 0.59, p.head * 0.76, p.head * 0.72, p.head * 0.03);
    if (!['turtle', 'elephant', 'lizard'].includes(p.species))
        sphere(
            head,
            pale,
            0,
            -p.head * 0.05,
            p.head + p.muzzle * 0.25,
            p.head * 0.43,
            p.head * 0.18,
            Math.max(p.muzzle * 0.8, p.head * 0.25),
        );
    if (p.tail > 0 && ['cat', 'dog', 'lion', 'tiger', 'pig'].includes(p.species)) {
        const z = -p.body * 0.57,
            y = p.width * 0.3;
        const cat = p.species === 'cat',
            pig = p.species === 'pig';
        const points = pig
            ? [
                  [0, y, z],
                  [p.tail * 0.4, y + p.tail * 0.5, z - p.tail * 0.4],
                  [0, y + p.tail * 0.7, z - p.tail * 0.6],
                  [-p.tail * 0.25, y + p.tail * 0.4, z - p.tail * 0.45],
              ]
            : [
                  [0, y, z],
                  [0, y + p.tail * (cat ? 0.2 : -0.05), z - p.tail * 0.35],
                  [p.tail * 0.12, y + p.tail * (cat ? 0.6 : -0.15), z - p.tail * 0.7],
                  [p.tail * 0.2, y + p.tail * (cat ? 0.65 : 0.05), z - p.tail * 0.65],
              ];
        const radius =
            e.asset === 'animal-fox' ? 0.07 : e.asset === 'animal-wolf' ? 0.055 : cat ? 0.025 : pig ? 0.012 : 0.028;
        tube(torso, points, radius, skin);
        const last = points[points.length - 1];
        if (e.asset === 'animal-fox')
            sphere(torso, pale, ...(last as [number, number, number]), radius * 1.1, radius * 1.1, p.tail * 0.1);
        if (p.species === 'lion') sphere(torso, dark, ...(last as [number, number, number]), 0.05, 0.06, 0.065);
    }
    if (p.species === 'turtle') {
        // Longitudinal and transverse scute seams follow the actual dome.
        for (const angle of [-0.65, 0, 0.65]) {
            const pts = Array.from({ length: 17 }, (_, i) => {
                const t = 0.12 + (i / 16) * (Math.PI - 0.24);
                return [
                    Math.sin(angle) * Math.sin(t) * p.width * 1.31,
                    0.06 + Math.cos(angle) * Math.sin(t) * 0.283,
                    Math.cos(t) * p.body * 0.625,
                ];
            });
            tube(torso, pts, 0.004, dark);
        }
        for (const z of [-0.55, 0, 0.55]) {
            const r = Math.sqrt(1 - z * z);
            tube(
                torso,
                Array.from({ length: 17 }, (_, i) => {
                    const a = (i / 16) * Math.PI;
                    return [Math.cos(a) * r * p.width * 1.31, 0.06 + Math.sin(a) * r * 0.283, z * p.body * 0.625];
                }),
                0.004,
                dark,
            );
        }
    }
    if (p.species === 'horse') {
        const mane = material('#4c4035');
        for (let i = 0; i < 7; i++)
            sphere(torso, mane, 0, 0.1 + p.neck * (i / 7), p.body * 0.36, 0.045, p.neck * 0.13, 0.08);
    }
    root.updateMatrixWorld(true);
    const local = torso.matrixWorld.clone().invert();
    skin.vertexColors = true;
    root.traverse((object) => {
        if (!(object instanceof T.Mesh) || object.material !== skin) return;
        let geometry = object.geometry;
        if (['tiger', 'giraffe', 'cow'].includes(p.species) && geometry.type === 'SphereGeometry') {
            geometry.dispose();
            geometry = object.geometry = new T.SphereGeometry(1, 28, 20);
        }
        const pos = geometry.attributes.position,
            colors = [];
        const transform = new T.Matrix4().multiplyMatrices(local, object.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
            const point = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(transform);
            const x = point.x / p.width,
                y = point.y / p.width,
                z = point.z / p.body;
            let shade = 1;
            if (p.species === 'tiger') {
                const stripe = Math.sin(z * 32 + Math.sin(y * 3.2) * 0.8 + Math.abs(x) * 2);
                if (stripe > 0.45 && y > -0.6) shade = 0.19;
            } else if (p.species === 'giraffe') {
                const cell = Math.sin(z * 24 + y * 1.2) * Math.sin(y * 12 + x * 2.8);
                if (cell > 0.12) shade = 0.43;
            } else if (p.species === 'cow') {
                if (Math.sin(z * 15 + y * 2) + Math.cos(x * 4 - y * 5) > 0.35) shade = 0.19;
            } else if (['deer', 'cat', 'dog'].includes(p.species) && y < 0.15) shade = 1.15;
            const color = new T.Color().setRGB(shade, shade, shade);
            colors.push(color.r, color.g, color.b);
        }
        geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    });
    const used = new Set<T.Material>();
    root.traverse((object) => {
        if (object instanceof T.Mesh)
            for (const m of Array.isArray(object.material) ? object.material : [object.material]) used.add(m);
    });
    for (const m of [pale, dark]) if (!used.has(m)) m.dispose();
}

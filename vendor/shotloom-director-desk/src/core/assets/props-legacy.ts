import * as T from 'three';
import type { Entity } from '../model.ts';
import { parameterDefaults, structureBoxes } from '../parametric-props.ts';
import { material, mesh, sphere, cylinder, box } from './geometry.ts';
export function makeProp(e: Entity): T.Group {
    const g = new T.Group();
    const m = material(e.color),
        light = material(new T.Color(e.color).lerp(new T.Color('#ffffff'), 0.28)),
        dark = material(new T.Color(e.color).multiplyScalar(0.77));
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, mat: T.Material = m) =>
        box(g, mat, w, h, d, x, y, z);
    if (parameterDefaults[e.asset]) {
        for (const part of structureBoxes(e))
            b(part.width, part.height, part.depth, part.x, part.y, part.z, part.mark ? light : m);
        return g;
    }
    switch (e.asset) {
        case 'building':
            b(4, 6, 4);
            b(4.2, 0.15, 4.2, 0, 6.05);
            for (const z of [-2.01, 2.01])
                for (const x of [-1.1, 1.1]) for (const y of [1.5, 3.2, 4.9]) b(0.9, 1.05, 0.04, x, y, z, dark);
            break;
        case 'bench':
            g.userData.contactAnchors = [-0.6, 0, 0.6].map((x, i) => ({
                id: `seat-${i + 1}`,
                role: 'seat',
                position: [x, 0.49, 0],
                normal: [0, 1, 0],
            }));
            b(1.8, 0.08, 0.5, 0, 0.45);
            b(1.8, 0.4, 0.06, 0, 0.76, -0.22);
            for (const x of [-0.65, 0.65]) b(0.08, 0.44, 0.44, x, 0.22, 0, dark);
            break;
        case 'fence':
            for (let x = -1; x <= 1; x += 0.25) b(0.08, 1.1, 0.08, x);
            for (const y of [0.3, 0.8]) b(2.1, 0.08, 0.07, 0, y);
            break;
        case 'streetlight':
            cylinder(g, m, 0.055, 0.085, 4, 0, 2);
            b(0.8, 0.06, 0.06, 0.35, 4);
            b(0.4, 0.07, 0.22, 0.7, 3.93, 0, light);
            break;
        case 'bed':
            g.userData.contactAnchors = [
                { id: 'bed', role: 'bed', position: [0, 0.5425, 0.32], normal: [0, 1, 0] },
                { id: 'bed-edge', role: 'seat', position: [0.72, 0.5425, 0.32], normal: [0, 1, 0], forward: [1, 0, 0] },
            ];
            b(1.8, 0.27, 2, 0, 0.2, 0, dark);
            b(1.78, 0.18, 1.98, 0, 0.41, 0, light);
            b(1.85, 0.98, 0.08, 0, 0.49, -1);
            for (const x of [-0.43, 0.43]) {
                const pillow = b(0.72, 0.11, 0.4, x, 0.55, -0.65, light);
                pillow.rotation.x = 0.05;
            }
            b(1.76, 0.045, 1.27, 0, 0.52, 0.32);
            break;
        case 'wardrobe':
            b(1.8, 2.2, 0.6);
            for (const x of [-0.449, 0.449]) b(0.883, 2.13, 0.025, x, 1.1, 0.314, light);
            for (const x of [-0.055, 0.055]) b(0.014, 0.25, 0.024, x, 1.05, 0.343, dark);
            break;
        case 'nightstand':
            b(0.5, 0.58, 0.46);
            b(0.46, 0.2, 0.02, 0, 0.42, 0.24, light);
            b(0.09, 0.015, 0.025, 0, 0.42, 0.26, dark);
            break;
        case 'desk':
        case 'table': {
            g.userData.contactAnchors = [{ id: 'top', role: 'surface', position: [0, 0.75, 0], normal: [0, 1, 0] }];
            const w = e.asset === 'desk' ? 1.2 : 1.8,
                d = e.asset === 'desk' ? 0.6 : 0.9;
            b(w, 0.055, d, 0, 0.7225, 0, light);
            for (const x of [-w / 2 + 0.055, w / 2 - 0.055])
                for (const z of [-d / 2 + 0.055, d / 2 - 0.055]) b(0.055, 0.7, 0.055, x, 0.35, z);
            break;
        }
        case 'chair':
            g.userData.contactAnchors = [{ id: 'seat', role: 'seat', position: [0, 0.45, 0], normal: [0, 1, 0] }];
            b(0.46, 0.055, 0.45, 0, 0.4225);
            b(0.46, 0.48, 0.055, 0, 0.69, -0.2);
            for (const x of [-0.175, 0.175]) for (const z of [-0.16, 0.16]) b(0.04, 0.41, 0.04, x, 0.205, z, dark);
            break;
        case 'sofa':
            g.userData.contactAnchors = [-0.55, 0.55].map((x, i) => ({
                id: `seat-${i + 1}`,
                role: 'seat',
                position: [x, 0.57, 0.08],
                normal: [0, 1, 0],
            }));
            // The plinth reaches the floor: the model has no legs, and a 9 cm gap under it read as
            // a levitating sofa (and as "floating" to the spatial check). Its top stays at 0.42 m.
            b(2, 0.42, 0.86, 0, 0.21, 0, dark);
            b(1.76, 0.18, 0.72, 0, 0.48, 0.04, light);
            b(2, 0.55, 0.19, 0, 0.64, -0.36);
            for (const x of [-0.94, 0.94]) b(0.18, 0.48, 0.88, x, 0.52);
            break;
        case 'lamp':
            cylinder(g, dark, 0.1, 0.13, 0.025, 0, 0.012);
            cylinder(g, m, 0.013, 0.013, 0.31, 0, 0.18);
            cylinder(g, light, 0.11, 0.18, 0.22, 0, 0.39);
            break;
        case 'laptop':
            b(0.32, 0.018, 0.22, 0, 0.009);
            b(0.32, 0.22, 0.013, 0, 0.12, -0.105, dark);
            b(0.292, 0.183, 0.003, 0, 0.123, -0.096, material('#596569'));
            break;
        case 'cup':
            cylinder(g, light, 0.044, 0.035, 0.1, 0, 0.05);
            {
                const handle = mesh(g, new T.TorusGeometry(0.028, 0.007, 8, 20), m, 0.05, 0.055, 0);
                handle.rotation.y = Math.PI / 2;
            }
            break;
        case 'sword':
            b(0.06, 0.78, 0.012, 0, 0.55, 0, light);
            b(0.23, 0.025, 0.04, 0, 0.16, 0, dark);
            b(0.035, 0.16, 0.035, 0, 0.08, 0, dark);
            break;
        case 'car':
            b(1.75, 0.58, 3.8, 0, 0.65);
            b(1.48, 0.7, 1.9, 0, 1.15, -0.15, light);
            for (const x of [-0.89, 0.89])
                for (const z of [-1.22, 1.22]) {
                    const wheel = cylinder(g, dark, 0.33, 0.33, 0.17, x, 0.33, z);
                    wheel.rotation.z = Math.PI / 2;
                }
            break;
        case 'tree':
            cylinder(g, dark, 0.1, 0.18, 2.3, 0, 1.15);
            sphere(g, m, 0, 2.45, 0, 1.0, 1.2, 0.95);
            sphere(g, light, 0.5, 2.1, 0.3, 0.65, 0.8, 0.65);
            break;
        case 'rock': {
            const r = mesh(g, new T.DodecahedronGeometry(0.6, 1), m, 0, 0.34);
            r.scale.set(1.3, 0.7, 1);
            r.rotation.set(0.2, 0.4, 0.1);
            break;
        }
        case 'sphere':
            sphere(g, m, 0, 0.5, 0, 0.5);
            break;
        case 'cylinder':
            cylinder(g, m, 0.5, 0.5, 1, 0, 0.5);
            break;
        case 'door':
            b(0.88, 2.08, 0.042, 0.44, 1.04);
            b(0.1, 0.015, 0.04, 0.78, 1, 0.04, dark);
            break;
        case 'cube':
            b(1, 1, 1);
            break;
        default:
            throw new Error(`不支持的道具白模：${e.asset}`);
    }
    return g;
}

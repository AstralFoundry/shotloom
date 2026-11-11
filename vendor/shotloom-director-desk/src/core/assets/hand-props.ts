import * as T from 'three';
import type { Entity } from '../model.ts';
import { HAND_PROP_SPECS } from './catalog/hand-props.ts';
import { assetParameters } from './parameters.ts';
import { box, cylinder, material, mesh } from './geometry.ts';

export function makeHandProp(e: Entity) {
    const spec = HAND_PROP_SPECS.find((s) => s.id === e.asset);
    if (!spec) throw new Error(`未实现生活道具：${e.asset}`);
    const root = new T.Group(),
        model = new T.Group();
    root.add(model);
    const m = material(e.color),
        dark = material(new T.Color(e.color).multiplyScalar(0.72)),
        light = material(new T.Color(e.color).lerp(new T.Color('#ffffff'), 0.3));
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, mat: T.Material = m) =>
        box(model, mat, w, h, d, x, y, z, 0.025);
    const turn = (points: number[][]) =>
        mesh(
            model,
            new T.LatheGeometry(
                points.map(([x, y]) => new T.Vector2(x, y)),
                32,
            ),
            m,
        );
    if (spec.style === 'cup') {
        turn([
            [0, 0],
            [0.42, 0],
            [0.5, 0.05],
            [0.5, 1],
            [0.43, 1],
            [0.43, 0.12],
            [0, 0.12],
        ]);
        const handle = new T.TorusGeometry(0.29, 0.055, 12, 24);
        mesh(model, handle, m, 0.56, 0.56, 0);
    } else if (spec.style === 'bowl')
        turn([
            [0, 0],
            [0.22, 0],
            [0.3, 0.04],
            [0.43, 0.18],
            [0.5, 0.5],
            [0.46, 0.52],
            [0.39, 0.2],
            [0.23, 0.1],
            [0, 0.1],
        ]);
    else if (spec.style === 'plate')
        turn([
            [0, 0],
            [0.38, 0],
            [0.5, 0.06],
            [0.5, 0.09],
            [0.4, 0.045],
            [0, 0.035],
        ]);
    else if (spec.style === 'bottle') {
        turn([
            [0, 0],
            [0.34, 0],
            [0.38, 0.05],
            [0.38, 0.75],
            [0.14, 0.94],
            [0.14, 1.18],
            [0.105, 1.18],
            [0.105, 0.95],
            [0.31, 0.73],
            [0.31, 0.07],
            [0, 0.07],
        ]);
    } else if (spec.style === 'book') {
        b(1, 0.04, 1.45, 0, 0.02, 0);
        b(0.96, 0.16, 1.4, 0, 0.12, 0, light);
        b(1, 0.04, 1.45, 0, 0.22, 0);
        b(0.06, 0.24, 1.45, -0.47, 0.12, 0);
        for (const y of [0.075, 0.1, 0.125, 0.15, 0.175]) b(0.9, 0.003, 1.4, 0.01, y, 0, dark);
    } else if (spec.style === 'phone') {
        b(0.75, 0.06, 1.55);
        b(0.68, 0.008, 1.4, 0, 0.064, 0, dark);
        b(0.14, 0.005, 0.02, 0, 0.071, -0.63, light);
    } else if (spec.style === 'suitcase') {
        b(1, 1.25, 0.55, 0, 0.74, 0);
        b(0.85, 0.88, 0.05, 0, 0.75, 0.3, light);
        for (const x of [-0.4, 0.4])
            for (const z of [-0.18, 0.18]) {
                const wheel = cylinder(model, dark, 0.07, 0.07, 0.075, x, 0.07, z);
                wheel.rotation.z = Math.PI / 2;
            }
        for (const x of [-0.22, 0.22]) b(0.035, 0.45, 0.035, x, 1.45, -0.15, dark);
        b(0.5, 0.06, 0.08, 0, 1.7, -0.15, dark);
    } else if (spec.style === 'backpack') {
        b(0.8, 1.15, 0.48, 0, 0.575, 0);
        b(0.62, 0.5, 0.18, 0, 0.3, 0.29, light);
        b(0.45, 0.12, 0.1, 0, 1.21, 0);
        for (const x of [-0.22, 0.22]) {
            b(0.1, 0.94, 0.08, x, 0.6, -0.34);
            b(0.1, 0.08, 0.18, x, 0.18, -0.29);
            b(0.1, 0.08, 0.18, x, 1.02, -0.29);
        }
    }
    model.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(model, true),
        size = bounds.getSize(new T.Vector3()),
        center = bounds.getCenter(new T.Vector3()),
        p = assetParameters(e);
    model.scale.set(p.width / size.x, p.height / size.y, p.depth / size.z);
    model.position.set(-center.x * model.scale.x, -bounds.min.y * model.scale.y, -center.z * model.scale.z);
    return root;
}

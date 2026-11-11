import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeThemed(e: Entity) {
    const f = objectBuilder(e),
        { model, p, m, shade, b, c, link, anchor } = f,
        style = e.asset.replace('theme-', '');
    if (style === 'throne') {
        b(0.85, 0.06, 0.85, 0, 0.36);
        b(0.9, 0.6, 0.07, 0, 0.7, -0.42);
        for (const x of [-0.39, 0.39]) {
            b(0.065, 0.6, 0.065, x, 0.3, 0.36);
            b(0.1, 0.045, 0.85, x, 0.6);
        }
        for (const x of [-0.38, 0.38]) b(0.08, 1, 0.08, x, 0.5, -0.4);
        b(0.65, 0.04, 0.82, 0, 0.405, 0.01, shade);
        anchor('seat', 'seat', 0, 0.425, 0.04);
    } else if (style === 'table') {
        b(1, 0.065, 1, 0, 0.9675);
        b(0.96, 0.12, 0.87, 0, 0.88);
        for (const x of [-0.4, 0.4])
            for (const z of [-0.37, 0.37]) {
                b(0.055, 0.9, 0.09, x, 0.45, z);
                b(0.18, 0.055, 0.16, x, 0.0275, z);
            }
        for (const z of [-0.37, 0.37]) b(0.8, 0.045, 0.035, 0, 0.23, z);
        anchor('top', 'surface', 0, 1, 0);
    } else if (style === 'weaponrack') {
        for (const x of [-0.45, 0.45]) {
            b(0.04, 1, 0.06, x);
            b(0.18, 0.045, 1, x);
        }
        for (const y of [0.3, 0.78]) b(0.94, 0.06, 0.06, 0, y);
        for (let i = 0; i < p.slots; i++) {
            const x = ((i - (p.slots - 1) / 2) * 0.8) / Math.max(1, p.slots);
            b(0.045, 0.08, 0.3, x, 0.79, 0.12);
            anchor('slot-' + i, 'surface', x, 0.83, 0.2);
        }
    } else if (style === 'flagpole') {
        c(0.16, 0.04, -0.32);
        c(0.018, 1, -0.32, 0.5);
        const flag = b(0.8, 0.3, 0.009, 0.08, 0.81, 0, shade);
        flag.visible = !!p.flag;
    } else if (style === 'altar') {
        for (let i = 0; i < p.steps; i++) {
            const span = 1 - (i / p.steps) * 0.3,
                y = ((i + 1) / p.steps) * 0.45;
            b(span, 0.45 / p.steps, span, 0, y - 0.225 / p.steps);
            anchor('step-' + i, 'surface', span / 2 - 0.075 / p.steps, y, 0);
        }
        b(0.4, 0.45, 0.4, 0, 0.675);
        b(0.65, 0.1, 0.58, 0, 0.95);
        anchor('altar', 'surface', 0, 1, 0);
    } else if (style === 'ring') {
        b(1, 0.25, 1);
        anchor('stage', 'surface', 0, 0.25, 0);
        for (const x of [-0.48, 0.48]) for (const z of [-0.48, 0.48]) c(0.015, 1, x, 0.5, z);
        for (const y of [0.5, 0.72, 0.92])
            for (const sign of [-1, 1]) {
                link([-0.48, y, sign * 0.48], [0.48, y, sign * 0.48], 0.005, shade).visible = !!p.ropes;
                link([sign * 0.48, y, -0.48], [sign * 0.48, y, 0.48], 0.005, shade).visible = !!p.ropes;
            }
    } else if (style === 'tent') {
        b(1, 0.02, 1);
        for (const sign of [-1, 1]) {
            const slope = new T.BufferGeometry();
            slope.setAttribute(
                'position',
                new T.Float32BufferAttribute([0, 1, -0.5, sign * 0.5, 0, -0.5, 0, 1, 0.5, sign * 0.5, 0, 0.5], 3),
            );
            slope.setIndex(sign === 1 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]);
            slope.computeVertexNormals();
            const fabric = m.clone();
            fabric.side = T.DoubleSide;
            mesh(model, slope, fabric);
        }
        const rear = new T.Shape([new T.Vector2(-0.5, 0), new T.Vector2(0.5, 0), new T.Vector2(0, 1)]);
        const g = new T.ExtrudeGeometry(rear, { depth: 0.012, bevelEnabled: false });
        mesh(model, g, m, 0, 0, -0.5);
        link([0, 0, -0.49], [0, 1, -0.49], 0.008, shade);
        anchor('floor', 'surface', 0, 0.02, 0.15);
    } else {
        b(1, 0.055, 0.85, 0, 0.43);
        anchor('counter', 'surface', 0, 0.4575, 0.1);
        for (const x of [-0.46, 0.46]) for (const z of [-0.4, 0.4]) b(0.035, 0.9, 0.035, x, 0.45, z);
        b(0.96, 0.3, 0.025, 0, 0.25, 0.4);
        const shape = new T.Shape([new T.Vector2(-0.55, 0), new T.Vector2(0.55, 0), new T.Vector2(0, 0.17)]);
        const roof = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        mesh(model, roof, shade, 0, 0.88, -0.5).visible = !!p.canopy;
    }
    return f.fit();
}

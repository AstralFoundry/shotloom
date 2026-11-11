import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh, cylinder } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeIndustrial(e: Entity) {
    const f = objectBuilder(e),
        { model, p, m, shade, b, c, link, anchor } = f,
        hinges: Array<{ group: T.Group; sign: number }> = [];
    const style = e.asset.replace('industrial-', '');
    if (style === 'container') {
        b(1, 0.025, 1);
        b(1, 0.025, 1, 0, 0.9875);
        b(1, 1, 0.025, 0, 0.5, -0.4875);
        for (const x of [-0.4875, 0.4875]) {
            b(0.025, 1, 1, x);
            for (let i = 0; i < 16; i++) b(0.012, 0.93, 0.015, x, 0.5, -0.46 + (i * 0.92) / 15, shade);
        }
        for (const sign of [-1, 1]) {
            const hinge = new T.Group();
            hinge.position.set(sign * 0.4875, 0, 0.4875);
            model.add(hinge);
            b(0.4875, 0.95, 0.025, -sign * 0.24375, 0.5, 0, m, hinge);
            b(0.014, 0.7, 0.02, -sign * 0.12, 0.5, 0.022, shade, hinge);
            hinges.push({ group: hinge, sign });
        }
        anchor('floor', 'surface', 0, 0.025, 0);
    } else if (style === 'pallet') {
        for (const x of [-0.4, 0, 0.4]) b(0.14, 0.6, 1, x, 0.3);
        for (let i = 0; i < 7; i++) b(1, 0.2, 0.12, 0, 0.9, -0.44 + (i * 0.88) / 6);
        for (const z of [-0.44, 0, 0.44]) b(1, 0.2, 0.12, 0, 0.1, z);
        anchor('top', 'surface', 0, 1, 0);
    } else if (style === 'barrel') {
        c(0.46, 1);
        for (const y of [0.05, 0.32, 0.68, 0.95]) c(0.5, 0.035, 0, y, 0, shade);
        c(0.07, 0.015, 0.16, 1, 0, shade);
        anchor('lid', 'surface', -0.15, 1, 0);
    } else if (style === 'pipeline') {
        const shape = new T.Shape();
        shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
        const hole = new T.Path();
        hole.absarc(0, 0, 0.37, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        const g = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 24 });
        g.translate(0, 0, -0.5);
        g.rotateY(Math.PI / 2);
        mesh(model, g, m);
        for (const x of [-0.46, 0.46]) {
            const ring = new T.TorusGeometry(0.465, 0.035, 8, 32);
            ring.rotateY(Math.PI / 2);
            mesh(model, ring, shade, x);
        }
    } else if (style === 'scaffold') {
        for (const x of [-0.48, 0.48]) for (const z of [-0.48, 0.48]) b(0.035, 1, 0.035, x, 0.5, z);
        for (let i = 0; i < p.levels; i++) {
            const y = (i + 1) / (p.levels + 1);
            b(0.94, 0.025, 0.94, 0, y - 0.0125);
            anchor('deck-' + i, 'surface', 0, y, 0);
            for (const z of [-0.48, 0.48]) {
                link([-0.48, i / (p.levels + 1), z], [0.48, y, z], 0.012);
                link([0.48, i / (p.levels + 1), z], [-0.48, y, z], 0.012);
            }
        }
    } else if (style === 'barrier') {
        b(1, 0.82, 0.12, 0, 0.57);
        for (const x of [-0.45, 0.45]) {
            b(0.05, 1, 0.14, x);
            b(0.16, 0.04, 1, x);
        }
        for (let i = 0; i < 14; i++) b(0.008, 0.8, 0.012, -0.46 + (i * 0.92) / 13, 0.57, 0.07, shade);
    } else if (style === 'cone') {
        b(1, 0.1, 1);
        mesh(model, new T.ConeGeometry(0.4, 0.9, 24), m, 0, 0.55);
        cylinder(model, shade, 0.18, 0.24, 0.12, 0, 0.51);
    } else {
        b(0.9, 0.06, 1, 0, 0.22);
        anchor('platform', 'surface', 0, 0.25, 0);
        for (const x of [-0.38, 0.38])
            for (const z of [-0.38, 0.38]) {
                const wheel = c(0.09, 0.08, x, 0.09, z, shade);
                wheel.rotation.z = Math.PI / 2;
            }
        for (const x of [-0.38, 0.38]) link([x, 0.22, -0.42], [x, 0.94, -0.42], 0.025);
        link([-0.38, 0.94, -0.42], [0.38, 0.94, -0.42], 0.03);
    }
    const root = f.fit();
    if (hinges.length) {
        // Bake the unrotated layout before opening: a long container must not
        // stretch a door when its width rotates into the container's depth axis.
        const scale = model.scale.clone();
        model.traverse((o) => {
            if (o !== model) o.position.multiply(scale);
            if (o instanceof T.Mesh) o.geometry.scale(scale.x, scale.y, scale.z);
        });
        model.scale.set(1, 1, 1);
        hinges.forEach((h) => (h.group.rotation.y = h.sign * T.MathUtils.degToRad(p.opening)));
    }
    return root;
}

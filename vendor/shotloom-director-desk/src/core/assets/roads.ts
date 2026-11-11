import * as T from 'three';
import type { Entity } from '../model.ts';
import type { ContactAnchor } from './furniture/shared.ts';
import { assetParameters } from './parameters.ts';
import { box, material, mesh } from './geometry.ts';

export function makeRoad(e: Entity) {
    const root = new T.Group(),
        p = assetParameters(e),
        m = material(e.color),
        mark = material(new T.Color(e.color).multiplyScalar(0.45));
    const anchors: ContactAnchor[] = [];
    root.userData.contactAnchors = anchors;
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, mat: T.Material = m) =>
        box(root, mat, w, h, d, x, y, z, 0);
    const anchor = (id: string, x: number, y: number, z: number, role: ContactAnchor['role'] = 'surface') =>
        anchors.push({ id, role, position: [x, y, z], normal: [0, 1, 0] });
    const w = p.width,
        l = p.length,
        h = p.height;
    if (e.asset === 'road-curve') {
        const angle = T.MathUtils.degToRad(p.turn),
            inner = p.radius - w / 2,
            outer = p.radius + w / 2;
        const shape = new T.Shape();
        shape.absarc(0, 0, outer, -angle, 0, false);
        shape.absarc(0, 0, inner, 0, -angle, true);
        shape.closePath();
        const g = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 48 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -h, 0);
        mesh(root, g, m);
        for (const [id, a] of [
            ['start', 0.01],
            ['middle', angle / 2],
            ['end', angle - 0.01],
        ] as const)
            anchor(id, p.radius * Math.cos(a), 0, p.radius * Math.sin(a));
        const count = Math.max(1, Math.ceil((p.radius * angle) / 2));
        for (let i = 0; i < count; i++) {
            const a = ((i + 0.5) * angle) / count;
            const dash = b(
                Math.min(0.09, w * 0.05),
                0.005,
                Math.min(0.85, ((p.radius * angle) / count) * 0.5),
                p.radius * Math.cos(a),
                0.003,
                p.radius * Math.sin(a),
                mark,
            );
            dash.rotation.y = -a;
        }
        // Surface query points avoid raised paint at the centerline.
        anchors.forEach((a) => {
            a.position[0] *= (p.radius + w * 0.25) / p.radius;
            a.position[2] *= (p.radius + w * 0.25) / p.radius;
        });
    } else if (e.asset === 'road-junction') {
        const a = w / 2,
            c = l / 2;
        const outline = [
            [-a, -c],
            [a, -c],
            [a, -a],
            [c, -a],
            [c, a],
            [a, a],
            [a, c],
            [-a, c],
            [-a, a],
            [-c, a],
            [-c, -a],
            [-a, -a],
        ];
        const g = new T.ExtrudeGeometry(new T.Shape(outline.map((v) => new T.Vector2(v[0], v[1]))), {
            depth: h,
            bevelEnabled: false,
        });
        g.rotateX(Math.PI / 2);
        mesh(root, g, m);
        anchor('center', 0, 0, 0);
    } else if (e.asset === 'road-busstop') {
        b(w, 0.08, l, 0, h - 0.04);
        const post = Math.min(0.09, w * 0.05, l * 0.08);
        for (const x of [-w / 2 + post / 2, w / 2 - post / 2]) b(post, h, post, x, h / 2, -l / 2 + post / 2);
        b(w - post * 2, h * 0.6, post * 0.5, 0, h * 0.55, -l / 2 + post / 2);
        const seatW = w * 0.65,
            seatD = l * 0.28,
            seatH = Math.min(0.45, h * 0.25);
        b(seatW, 0.06, seatD, 0, seatH - 0.03, -l * 0.1);
        for (const x of [-seatW * 0.4, seatW * 0.4])
            b(post, seatH - 0.06, seatD * 0.8, x, (seatH - 0.06) / 2, -l * 0.1);
        const seats = Math.max(1, Math.floor(seatW / 0.6));
        for (let i = 0; i < seats; i++)
            anchor('seat-' + i, ((i - (seats - 1) / 2) * seatW) / seats, seatH, -l * 0.1, 'seat');
    } else {
        const top = ['road-sidewalk', 'road-curb'].includes(e.asset) ? h : 0;
        b(w, h, l, 0, top - h / 2);
        anchor('surface', w * 0.25, top, 0);
        if (e.asset === 'road-straight')
            for (let z = -l / 2 + 0.6; z < l / 2 - 0.4; z += 2)
                b(Math.min(0.1, w * 0.05), 0.005, Math.min(1, l * 0.2), 0, 0.003, z, mark);
        if (e.asset === 'road-parking') {
            const t = Math.min(0.06, w * 0.05, l * 0.05);
            for (const x of [-w / 2 + t, w / 2 - t]) b(t, 0.005, l - t * 2, x, 0.003, 0, mark);
            b(w - t, 0.005, t, 0, 0.003, -l / 2 + t, mark);
        }
        if (e.asset === 'road-bridge') {
            const t = Math.min(0.08, w * 0.04),
                railH = 1.1,
                count = Math.max(2, Math.ceil(l / 1.5));
            for (const x of [-w / 2 + t, w / 2 - t]) {
                b(t, t, l, x, railH - t / 2);
                for (let i = 0; i < count; i++)
                    b(t, railH, t, x, railH / 2, -l / 2 + t + (i * (l - t * 2)) / (count - 1));
            }
        }
    }
    return root;
}

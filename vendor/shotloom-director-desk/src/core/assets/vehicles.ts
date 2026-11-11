import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh, sphere } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeVehicle(e: Entity) {
    const f = objectBuilder(e),
        { model, p, m, shade, b, c, link, anchor } = f,
        style = e.asset.replace('vehicle-', '');
    const r = p.wheelRatio,
        wheelDepthScale = p.height / p.depth,
        wheelbase = p.wheelbaseRatio;
    if (style === 'bicycle' || style === 'motorcycle') {
        for (const z of [-0.3 * wheelbase, 0.3 * wheelbase]) {
            const tire = mesh(model, new T.TorusGeometry(r - 0.025, 0.025, 10, 32), shade, 0, r, z);
            tire.rotation.y = Math.PI / 2;
            tire.scale.x = wheelDepthScale;
            tire.userData.vehiclePart = 'wheel';
            for (let i = 0; i < 8; i++) {
                const angle = (i * Math.PI) / 4;
                link(
                    [0, r, z],
                    [0, r + Math.sin(angle) * (r - 0.025), z + Math.cos(angle) * (r - 0.025) * wheelDepthScale],
                    0.004,
                    shade,
                );
            }
        }
        const bikeLink = (a: number[], end: number[], radius: number, mat = m) =>
            link([a[0], a[1], a[2] * wheelbase], [end[0], end[1], end[2] * wheelbase], radius, mat);
        const rear = [0, r, -0.3],
            front = [0, r, 0.3],
            crank = [0, 0.28, -0.04],
            saddle = [0, 0.69, -0.13],
            stem = [0, 0.73, 0.24];
        for (const [a, end] of [
            [rear, crank],
            [rear, saddle],
            [crank, saddle],
            [saddle, stem],
            [crank, stem],
            [stem, front],
        ])
            bikeLink(a, end, style === 'bicycle' ? 0.015 : 0.025);
        bikeLink([0, 0.73, 0.24], [0, 0.978, 0.22], 0.022);
        bikeLink([-0.48, 0.978, 0.22], [0.48, 0.978, 0.22], 0.022);
        b(0.3, 0.06, style === 'motorcycle' ? 0.35 : 0.18, 0, 0.72, -0.13 * wheelbase, shade);
        anchor('rider', 'seat', 0, 0.75, -0.13 * wheelbase);
        anchor('camera-handlebar', 'surface', 0, 1, 0.22 * wheelbase);
        if (style === 'motorcycle') {
            sphere(model, m, 0, 0.63, 0.06 * wheelbase, 0.27, 0.16, 0.16);
            b(0.36, 0.23, 0.22, 0, 0.4, -0.02 * wheelbase, shade);
            bikeLink([0.22, 0.28, -0.3], [0.22, 0.28, 0.03], 0.035, shade);
        } else bikeLink([-0.22, 0.28, -0.04], [0.22, 0.28, -0.04], 0.012, shade);
    } else if (style === 'boat') {
        const shape = new T.Shape([
            new T.Vector2(-0.42, -0.5),
            new T.Vector2(0.42, -0.5),
            new T.Vector2(0.5, 0.16),
            new T.Vector2(0, 0.5),
            new T.Vector2(-0.5, 0.16),
        ]);
        const inner = new T.Path([
            new T.Vector2(-0.35, -0.42),
            new T.Vector2(-0.42, 0.14),
            new T.Vector2(0, 0.4),
            new T.Vector2(0.42, 0.14),
            new T.Vector2(0.35, -0.42),
        ]);
        shape.holes.push(inner);
        const walls = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        walls.rotateX(Math.PI / 2);
        walls.translate(0, 1, 0);
        mesh(model, walls, m);
        const bottom = new T.Shape(shape.getPoints());
        const floor = new T.ExtrudeGeometry(bottom, { depth: 0.07, bevelEnabled: false });
        floor.rotateX(Math.PI / 2);
        floor.translate(0, 0.07, 0);
        mesh(model, floor, m);
        for (let i = 0; i < p.seats; i++) {
            const z = -0.28 + ((i + 0.5) / p.seats) * 0.58,
                width = 0.7 * (1 - Math.max(0, -z) * 0.6);
            b(width, 0.055, 0.08, 0, 0.56, z, shade);
            anchor('seat-' + i, 'seat', 0, 0.5875, z);
        }
        anchor('floor', 'surface', 0.12, 0.07, 0);
        anchor('camera-bow', 'surface', 0, 1, 0.45);
    } else {
        const floor = r * 0.7 + 0.12,
            cabinLength =
                style === 'bus'
                    ? 0.86
                    : style === 'van'
                      ? 0.82
                      : style === 'truck'
                        ? 0.29
                        : style === 'suv'
                          ? 0.67
                          : 0.58;
        const cabinZ = style === 'truck' ? 0.32 : style === 'van' || style === 'bus' ? 0.015 : -0.035;
        b(0.95, 0.14, 1, 0, floor - 0.07);
        for (const x of [-0.455 * p.trackRatio, 0.455 * p.trackRatio])
            for (const z of [-0.3 * wheelbase, 0.3 * wheelbase]) {
                const tire = c(r, 0.09, x, r, z, shade);
                tire.rotation.z = Math.PI / 2;
                tire.scale.z = wheelDepthScale;
                tire.userData.vehiclePart = 'wheel';
            }
        const roofY = style === 'sedan' ? 0.95 : 0.975;
        const frontInset = style === 'sedan' ? 0.1 : style === 'suv' ? 0.06 : 0,
            rearInset = style === 'sedan' ? 0.07 : style === 'suv' ? 0.015 : 0;
        b(
            0.84,
            1 - roofY,
            cabinLength - frontInset - rearInset,
            0,
            (1 + roofY) / 2,
            cabinZ + (rearInset - frontInset) / 2,
        );
        anchor('camera-roof', 'surface', 0, 1, cabinZ + (rearInset - frontInset) / 2);
        for (const x of [-0.405, 0.405]) {
            b(0.04, 0.3, cabinLength, x, floor + 0.15, cabinZ);
            const pillars = style === 'bus' ? Math.max(4, Math.ceil(p.seats / 2)) : 3;
            for (let i = 0; i < pillars; i++) {
                const z = cabinZ - cabinLength / 2 + (i * cabinLength) / (pillars - 1);
                const inset = i === 0 ? rearInset : i === pillars - 1 ? -frontInset : 0;
                link([x, floor + 0.28, z], [x, roofY, z + inset], 0.014);
            }
        }
        if (style === 'truck') {
            b(0.9, 0.055, 0.6, 0, floor + 0.02, -0.18);
            for (const x of [-0.43, 0.43]) b(0.04, 0.3, 0.6, x, floor + 0.18, -0.18);
            b(0.9, 0.3, 0.03, 0, floor + 0.18, -0.465);
            anchor('cargo', 'surface', 0, floor + 0.0475, -0.2);
        } else if (!['van', 'bus'].includes(style)) {
            b(0.93, 0.2, 0.22, 0, floor + 0.1, 0.39);
            b(0.91, 0.15, 0.16, 0, floor + 0.075, -0.42);
            anchor('camera-hood', 'surface', 0, floor + 0.2, 0.39);
        }
        const rows = Math.ceil(p.seats / 2),
            start = cabinZ + cabinLength * 0.25;
        for (let i = 0; i < p.seats; i++) {
            const x = i % 2 ? 0.21 : -0.21,
                z = rows === 1 ? cabinZ : start - (Math.floor(i / 2) / (rows - 1)) * cabinLength * 0.55;
            const seatD = (cabinLength / Math.max(rows, 2)) * 0.4,
                y = floor + 0.1;
            b(0.3, 0.04, seatD, x, y - 0.02, z, shade);
            b(0.3, 0.23, 0.025, x, y + 0.09, z - seatD / 2, shade);
            anchor('seat-' + i, 'seat', x, y, z);
        }
        for (const x of [-0.32, 0.32]) b(0.16, 0.05, 0.012, x, floor + 0.08, 0.503, shade);
    }
    return f.fit();
}

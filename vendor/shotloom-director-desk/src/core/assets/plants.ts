import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, sphere, cylinder, mesh } from './geometry.ts';
import { branch, fitModel, seededRandom } from './procedural.ts';

export function makePlant(e: Entity) {
    const p = assetParameters(e),
        root = new T.Group(),
        model = new T.Group();
    root.add(model);
    const m = material(e.color),
        stem = material(new T.Color(e.color).multiplyScalar(0.77)),
        rng = seededRandom(p.seed);
    const n = p.density,
        style = e.asset.replace('plant-', '');
    const leaf = (center: T.Vector3, tip: T.Vector3, width: number) => {
        const middle = center
            .clone()
            .lerp(tip, 0.5)
            .add(new T.Vector3(0, 0.04, 0));
        const across = new T.Vector3()
            .subVectors(tip, center)
            .cross(new T.Vector3(0, 1, 0))
            .normalize()
            .multiplyScalar(width);
        const points = [center, tip, middle.clone().add(across), middle.clone().sub(across)].flatMap((v) => [
            v.clone().add(new T.Vector3(0, 0.003, 0)),
            v.clone().add(new T.Vector3(0, -0.003, 0)),
        ]);
        mesh(model, new ConvexGeometry(points), m);
    };
    if (['broadleaf', 'conifer', 'palm', 'dead'].includes(style)) {
        cylinder(model, stem, 0.035, 0.065, 0.86, 0, 0.43);
        if (style === 'conifer') {
            const layers = Math.max(3, Math.round(n / 3));
            for (let i = 0; i < layers; i++) {
                const y = 0.25 + (i / layers) * 0.6,
                    r = 0.32 * (1 - i / layers) * (0.9 + rng() * 0.2);
                mesh(model, new T.ConeGeometry(r, 0.35, 9), m, (rng() - 0.5) * 0.035, y + 0.175, (rng() - 0.5) * 0.035);
            }
        } else
            for (let i = 0; i < n; i++) {
                const a = i * 2.39996 + rng() * 0.2,
                    radius = 0.18 + rng() * 0.18;
                const from = new T.Vector3(0, style === 'palm' ? 0.82 : 0.36 + rng() * 0.4, 0);
                const to = new T.Vector3(
                    Math.cos(a) * radius,
                    style === 'palm' ? 0.8 - rng() * 0.15 : 0.55 + rng() * 0.4,
                    Math.sin(a) * radius,
                );
                branch(model, stem, from, to, 0.016, 0.005);
                if (style === 'broadleaf')
                    sphere(model, m, to.x, to.y, to.z, 0.13 + rng() * 0.06, 0.13 + rng() * 0.05, 0.14);
                else if (style === 'palm') leaf(from, to, 0.035);
                else {
                    const tip = to.clone().add(new T.Vector3(Math.cos(a + 0.5) * 0.12, 0.12, Math.sin(a + 0.5) * 0.12));
                    branch(model, stem, to, tip, 0.007, 0.001);
                }
            }
    } else if (style === 'grass') {
        for (let i = 0; i < n; i++) {
            const base = new T.Vector3((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6);
            leaf(
                base,
                base.clone().add(new T.Vector3((rng() - 0.5) * 0.3, 0.25 + rng() * 0.5, (rng() - 0.5) * 0.3)),
                0.014 + rng() * 0.015,
            );
        }
    } else if (style === 'potted') {
        const profile = [
            [0, 0],
            [0.17, 0],
            [0.24, 0.3],
            [0.205, 0.3],
            [0.15, 0.045],
            [0, 0.045],
        ].map((v) => new T.Vector2(v[0], v[1]));
        mesh(model, new T.LatheGeometry(profile, 24), stem);
        cylinder(model, stem, 0.022, 0.032, 0.55, 0, 0.52);
        for (let i = 0; i < n; i++) {
            const a = i * 2.39996,
                start = new T.Vector3(0, 0.38 + (i / n) * 0.42, 0);
            leaf(start, new T.Vector3(Math.cos(a) * (0.2 + rng() * 0.08), start.y + 0.08, Math.sin(a) * 0.25), 0.045);
        }
    } else {
        for (let i = 0; i < n; i++) {
            const x = style === 'hedge' ? (i / Math.max(1, n - 1) - 0.5) * 1.4 : (rng() - 0.5) * 0.5;
            const z = (rng() - 0.5) * 0.3,
                y = 0.2 + rng() * 0.2;
            branch(model, stem, new T.Vector3(x, 0, z), new T.Vector3(x, y, z), 0.018);
            sphere(model, m, x, y, z, 0.16 + rng() * 0.1, 0.2 + rng() * 0.1, 0.18 + rng() * 0.08);
        }
    }
    fitModel(model, p.width, p.height, p.depth);
    return root;
}

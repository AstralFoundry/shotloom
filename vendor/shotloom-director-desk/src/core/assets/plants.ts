import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, mesh } from './geometry.ts';
import { fitModel, seededRandom } from './procedural.ts';

/** Repeated foliage and branches share draw calls within each plant, never between owners. */
function instances(parent: T.Group, geometry: T.BufferGeometry, surface: T.Material, transforms: T.Matrix4[]) {
    if (!transforms.length) {
        geometry.dispose();
        return;
    }
    const object = new T.InstancedMesh(geometry, surface, transforms.length);
    transforms.forEach((matrix, i) => object.setMatrixAt(i, matrix));
    object.castShadow = object.receiveShadow = true;
    object.computeBoundingBox();
    parent.add(object);
}

export function makePlant(e: Entity) {
    const p = assetParameters(e),
        root = new T.Group(),
        model = new T.Group();
    root.add(model);
    const rng = seededRandom(p.seed),
        n = p.density,
        style = e.asset.replace('plant-', '');
    const foliage = [0.84, 0.96, 1.08].map((value) => material(new T.Color(e.color).multiplyScalar(value)));
    const bark = material(new T.Color('#665044').lerp(new T.Color(e.color), 0.12));
    const wood: T.Matrix4[] = [],
        crowns: T.Matrix4[][] = [[], [], []];
    const matrix = (position: T.Vector3, scale: T.Vector3, rotation = new T.Quaternion()) =>
        new T.Matrix4().compose(position, rotation, scale);
    const branch = (from: T.Vector3, to: T.Vector3, radius: number) => {
        const delta = to.clone().sub(from);
        wood.push(
            matrix(
                from.clone().add(to).multiplyScalar(0.5),
                new T.Vector3(radius, delta.length(), radius),
                new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()),
            ),
        );
    };
    const crown = (x: number, y: number, z: number, width: number, height: number, depth = width) => {
        crowns[Math.floor(rng() * 3)].push(
            matrix(
                new T.Vector3(x, y, z),
                new T.Vector3(width, height, depth),
                new T.Quaternion().setFromEuler(new T.Euler((rng() - 0.5) * 0.3, rng() * Math.PI, (rng() - 0.5) * 0.3)),
            ),
        );
    };
    const blades: number[] = [],
        bladeColors: number[] = [];
    /** Curved folded leaves have real silhouettes from either side, with no alpha textures. */
    const leaf = (base: T.Vector3, direction: T.Vector3, length: number, width: number, droop = 0) => {
        const across = new T.Vector3(direction.z, 0, -direction.x).normalize();
        const color = new T.Color(e.color).multiplyScalar(0.8 + rng() * 0.35);
        for (let segment = 0; segment < 6; segment++) {
            const pair = [segment / 6, (segment + 1) / 6].map((t) => {
                const center = base.clone().addScaledVector(direction, length * t);
                center.y -= droop * t * t;
                const span = Math.sin(Math.PI * t) * width;
                return [
                    center.clone().addScaledVector(across, -span),
                    center.clone().add(new T.Vector3(0, span * 0.2, 0)),
                    center.clone().addScaledVector(across, span),
                ];
            });
            for (let side = 0; side < 2; side++) {
                const [a, b, c, d] = [pair[0][side], pair[0][side + 1], pair[1][side], pair[1][side + 1]];
                for (const point of [a, c, b, b, c, d]) {
                    blades.push(...point.toArray());
                    bladeColors.push(color.r, color.g, color.b);
                }
            }
        }
    };
    if (style === 'broadleaf' || style === 'dead') {
        const bend = new T.Vector3(0.025, 0.47, -0.015);
        branch(new T.Vector3(0, 0, 0), bend, 0.052);
        branch(bend, new T.Vector3(-0.02, 0.83, 0.01), 0.029);
        for (let i = 0; i < n; i++) {
            const angle = i * 2.39996,
                radius = 0.2 + rng() * 0.18;
            const start = new T.Vector3(0.01, 0.32 + rng() * 0.34, 0);
            const fork = new T.Vector3(
                Math.cos(angle) * radius * 0.6,
                0.53 + rng() * 0.28,
                Math.sin(angle) * radius * 0.6,
            );
            const tip = new T.Vector3(Math.cos(angle) * radius, fork.y + 0.06 + rng() * 0.1, Math.sin(angle) * radius);
            branch(start, fork, 0.018);
            branch(fork, tip, 0.01);
            if (style === 'broadleaf') {
                crown(tip.x, tip.y, tip.z, 0.18 + rng() * 0.06, 0.12 + rng() * 0.06, 0.17);
                crown(tip.x * 0.75, tip.y + 0.07, tip.z * 0.75, 0.14, 0.12, 0.16);
                crown(fork.x, fork.y + 0.015, fork.z, 0.16, 0.11, 0.17);
            } else {
                const twig = tip
                    .clone()
                    .add(new T.Vector3(Math.cos(angle + 0.7) * 0.12, 0.12, Math.sin(angle + 0.7) * 0.12));
                branch(tip, twig, 0.004);
            }
        }
        if (style === 'broadleaf') crown(0, 0.92, 0, 0.2, 0.14, 0.19);
        for (let i = 0; i < 5; i++) {
            const a = i * Math.PI * 0.4;
            branch(new T.Vector3(0, 0.07, 0), new T.Vector3(Math.cos(a) * 0.12, 0.012, Math.sin(a) * 0.12), 0.025);
        }
    } else if (style === 'conifer') {
        branch(new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), 0.035);
        const layers = Math.max(4, Math.round(n / 2));
        for (let i = 0; i < layers; i++) {
            const t = i / layers,
                y = 0.32 + t * 0.58,
                radius = 0.25 * (1 - t) + 0.035;
            for (let spoke = 0; spoke < 5; spoke++) {
                const a = spoke * Math.PI * 0.4 + i * 0.9;
                const tip = new T.Vector3(Math.cos(a) * radius, y - 0.025, Math.sin(a) * radius);
                branch(new T.Vector3(0, y + 0.04, 0), tip, 0.006);
                crown(tip.x * 0.5, y + radius * 0.25, tip.z * 0.5, radius * 0.72, radius * 0.9, radius * 0.72);
            }
        }
        crown(0, 0.94, 0, 0.07, 0.18, 0.07);
    } else if (style === 'palm') {
        for (let i = 0; i < 9; i++) {
            const t = i / 9;
            branch(
                new T.Vector3(0.045 * t * t, t * 0.78, 0),
                new T.Vector3(0.045 * (t + 1 / 9) ** 2, (t + 1 / 9) * 0.78, 0),
                0.027 - t * 0.008,
            );
        }
        for (let i = 0; i < n; i++) {
            const a = i * 2.39996,
                origin = new T.Vector3(0.045, 0.77, 0);
            const direction = new T.Vector3(Math.cos(a), 0.35 + rng() * 0.25, Math.sin(a)).normalize();
            const length = 0.48 + rng() * 0.13;
            for (let leaflet = 1; leaflet < 9; leaflet++) {
                const t = leaflet / 10,
                    base = origin.clone().addScaledVector(direction, length * t);
                base.y -= 0.32 * t * t;
                for (const side of [-1, 1])
                    leaf(
                        base,
                        new T.Vector3(
                            direction.x - direction.z * side,
                            -0.3,
                            direction.z + direction.x * side,
                        ).normalize(),
                        0.12 * Math.sin(Math.PI * t) + 0.015,
                        0.018,
                        0.025,
                    );
            }
            leaf(origin, direction, length, 0.015, 0.32);
        }
    } else if (style === 'grass') {
        for (let i = 0; i < n * 3; i++) {
            const a = rng() * Math.PI * 2,
                r = Math.sqrt(rng()) * 0.26;
            leaf(
                new T.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
                new T.Vector3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize(),
                0.3 + rng() * 0.42,
                0.014,
                0.08,
            );
        }
    } else if (style === 'potted') {
        const pot = material('#b49379'),
            soil = material('#493d32');
        const profile = [
            [0.13, 0],
            [0.14, 0.025],
            [0.19, 0.28],
            [0.2, 0.29],
            [0.2, 0.32],
            [0.175, 0.32],
            [0.16, 0.06],
            [0, 0.06],
        ].map((v) => new T.Vector2(v[0], v[1]));
        mesh(model, new T.LatheGeometry(profile, 32), pot);
        mesh(model, new T.CylinderGeometry(0.173, 0.173, 0.01, 24), soil, 0, 0.285);
        for (let i = 0; i < n; i++) {
            const a = i * 2.39996,
                y = 0.34 + (i / n) * 0.36;
            branch(new T.Vector3(0, 0.29, 0), new T.Vector3(Math.cos(a) * 0.04, y, Math.sin(a) * 0.04), 0.005);
            leaf(
                new T.Vector3(0, y, 0),
                new T.Vector3(Math.cos(a), 0.7, Math.sin(a)).normalize(),
                0.22 + rng() * 0.12,
                0.055,
                0.09,
            );
        }
    } else {
        for (let i = 0; i < n; i++) {
            const x = style === 'hedge' ? (i / Math.max(1, n - 1) - 0.5) * 1.2 : (rng() - 0.5) * 0.42;
            const z = (rng() - 0.5) * 0.28,
                y = 0.2 + rng() * 0.13;
            branch(new T.Vector3(x, 0, z), new T.Vector3(x, y, z), 0.012);
            crown(x, y, z, 0.18 + rng() * 0.06, 0.17 + rng() * 0.06, 0.18);
            crown(x + 0.04, y + 0.1, z, 0.12, 0.13, 0.14);
        }
    }
    instances(model, new T.CylinderGeometry(0.5, 1, 1, 8), bark, wood);
    const canopy = style === 'conifer' ? new T.ConeGeometry(1, 2, 9) : new T.IcosahedronGeometry(1, 2);
    const positions = canopy.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
            y = positions.getY(i),
            z = positions.getZ(i);
        const wobble = 1 + 0.09 * Math.sin(x * 13 + y * 9) * Math.cos(z * 11 - y * 7);
        positions.setXYZ(i, x * wobble, y * wobble, z * wobble);
    }
    canopy.computeVertexNormals();
    crowns.forEach((transforms, i) => instances(model, canopy.clone(), foliage[i], transforms));
    canopy.dispose();
    if (blades.length) {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(blades, 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(bladeColors, 3));
        geometry.computeVertexNormals();
        const surface = material('#ffffff');
        surface.vertexColors = true;
        surface.side = T.DoubleSide;
        mesh(model, geometry, surface);
    }
    // Materials without any attached instance are not owned by disposeTree.
    foliage.forEach((surface, i) => {
        if (!crowns[i].length) surface.dispose();
    });
    if (!wood.length) bark.dispose();
    fitModel(model, p.width, p.height, p.depth);
    return root;
}

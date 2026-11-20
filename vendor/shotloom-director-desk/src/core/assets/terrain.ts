import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, mesh, box } from './geometry.ts';
import { fitModel } from './procedural.ts';

/** Closed heightfield: camera views and surface paths use the same top triangles. */
function heightfield(height: (x: number, z: number) => number, count = 24) {
    const positions: number[] = [],
        indices: number[] = [],
        side = count + 1;
    for (let z = 0; z <= count; z++)
        for (let x = 0; x <= count; x++) {
            const u = x / count - 0.5,
                v = z / count - 0.5;
            positions.push(u, height(u, v), v);
        }
    for (let z = 0; z < count; z++)
        for (let x = 0; x < count; x++) {
            const a = z * side + x;
            indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
        }
    const boundary: number[] = [];
    for (let x = 0; x < count; x++) boundary.push(x);
    for (let z = 0; z < count; z++) boundary.push(z * side + count);
    for (let x = count; x > 0; x--) boundary.push(count * side + x);
    for (let z = count; z > 0; z--) boundary.push(z * side);
    const bottomStart = positions.length / 3;
    boundary.forEach((index) => positions.push(positions[index * 3], 0, positions[index * 3 + 2]));
    for (let i = 0; i < boundary.length; i++) {
        const next = (i + 1) % boundary.length,
            a = boundary[i],
            b = boundary[next],
            c = bottomStart + i,
            d = bottomStart + next;
        indices.push(a, b, c, b, d, c);
    }
    const center = positions.length / 3;
    positions.push(0, 0, 0);
    for (let i = 0; i < boundary.length; i++)
        indices.push(center, bottomStart + i, bottomStart + ((i + 1) % boundary.length));
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}
export function makeTerrain(e: Entity) {
    const p = assetParameters(e),
        root = new T.Group(),
        model = new T.Group();
    root.add(model);
    const m = material(e.color),
        style = e.asset.replace('terrain-', '');
    const noise = (x: number, y: number, z: number) =>
        Math.sin(x * 9.31 + y * 7.71 + z * 4.73 + (p.seed ?? 1) * 0.73) * 0.55 +
        Math.sin(x * 19.19 - y * 5.4 + z * 17.17 + (p.seed ?? 1) * 0.31) * 0.45;
    if (style === 'rock') {
        const geometry = new T.IcosahedronGeometry(1, 4),
            vertices = geometry.attributes.position;
        // Broad weathered planes, a flattened foot and off-centre shoulders.
        // Coordinate noise is coherent at duplicated vertices, keeping the surface closed.
        for (let i = 0; i < vertices.count; i++) {
            const x = vertices.getX(i),
                y = vertices.getY(i),
                z = vertices.getZ(i);
            const weather = 1 + (0.1 + p.roughness * 0.36) * noise(x * 0.55, y * 0.55, z * 0.55);
            const rounded = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.78);
            const h = Math.max(-0.62, rounded(y) * weather);
            vertices.setXYZ(
                i,
                rounded(x) * weather * 0.5 + h * 0.075,
                h * 0.5 + 0.32,
                rounded(z) * weather * 0.5 - h * 0.04,
            );
        }
        geometry.computeVertexNormals();
        mesh(model, geometry, m);
    } else if (['ground', 'water'].includes(style)) box(model, m, 1, 1, 1, 0, 0.5, 0, 0);
    else if (style === 'cliff') {
        const g = new T.BoxGeometry(1, 1, 1, 18, 12, 8),
            v = g.attributes.position;
        for (let i = 0; i < v.count; i++) {
            const x = v.getX(i),
                y = v.getY(i) + 0.5,
                z = v.getZ(i);
            const strata = Math.sin(y * 32 + x * 2) * 0.012 + Math.sin(y * 12) * 0.018;
            const face = p.roughness * (noise(x, y, z) * 0.12 + strata);
            const top = 0.8 + 0.12 * Math.sin(x * 8 + 1) + p.roughness * noise(x, 1, z) * 0.18;
            v.setXYZ(i, x + Math.sign(x) * face * y, y * top, z + Math.sign(z) * face);
        }
        g.computeVertexNormals();
        mesh(model, g, m);
    } else {
        const top = (x: number, z: number) => {
            if (style === 'slope') return 0.03 + (0.5 - z) * 0.97;
            if (style === 'hill')
                return 0.03 + Math.max(0, 1 - (x * x + z * z) * 3) * (0.9 + p.roughness * noise(x, 0, z) * 0.12);
            if (style === 'ditch')
                return Math.abs(x) < 0.2 ? 0.08 : Math.abs(x) > 0.35 ? 1 : 0.08 + ((Math.abs(x) - 0.2) / 0.15) * 0.92;
            return 0.06 + Math.pow(Math.abs(x) * 2, 2) * 0.9 + p.roughness * (noise(x, 0, z) + 1) * 0.018;
        };
        mesh(model, heightfield(top), m);
    }
    if (!['ground', 'water'].includes(style)) {
        m.vertexColors = true;
        m.flatShading = style === 'rock' || style === 'cliff';
        m.roughness = 0.96;
        m.metalness = 0;
        model.traverse((object) => {
            if (!(object instanceof T.Mesh)) return;
            const g = object.geometry,
                positions = g.attributes.position,
                colors = [];
            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i),
                    y = positions.getY(i),
                    z = positions.getZ(i);
                const grain = noise(x * 0.7, y * 0.8, z * 0.7);
                const strata = Math.sin(y * 31 + noise(x, 0, z) * 0.4);
                const brightness =
                    0.85 + grain * 0.11 + (style === 'cliff' ? strata * 0.065 : 0) + Math.min(y, 1) * 0.12;
                const color = new T.Color().setRGB(brightness, brightness * 0.985, brightness * 0.95);
                if (style === 'hill') color.setRGB(0.82 + grain * 0.09, 0.94 + grain * 0.08, 0.75 + grain * 0.07);
                colors.push(color.r, color.g, color.b);
            }
            g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
        });
    }
    fitModel(model, p.width, p.height, p.depth);
    if (style === 'water') root.userData.referenceSurface = 'static-water';
    return root;
}

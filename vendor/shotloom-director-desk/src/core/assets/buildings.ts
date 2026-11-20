import * as T from 'three';
import type { Entity } from '../model.ts';
import type { ContactAnchor } from './furniture/shared.ts';
import { assetParameters } from './parameters.ts';
import { material, mesh } from './geometry.ts';

/** Local instancing keeps window mouldings affordable on multi-storey buildings. */
function detailBoxes(parent: T.Group, surface: T.Material) {
    const matrices: T.Matrix4[] = [];
    return {
        add(w: number, h: number, d: number, x: number, y: number, z: number) {
            matrices.push(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion(), new T.Vector3(w, h, d)));
        },
        finish() {
            if (!matrices.length) return;
            const batch = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), surface, matrices.length);
            matrices.forEach((matrix, i) => batch.setMatrixAt(i, matrix));
            batch.castShadow = batch.receiveShadow = true;
            batch.computeBoundingBox();
            parent.add(batch);
        },
    };
}

/** A swept hip roof with a ridge, concave slopes and subtly lifted corners. */
function hipRoof(width: number, depth: number, height: number) {
    const positions: number[] = [],
        indices: number[] = [],
        steps = 24;
    for (let row = 0; row <= steps; row++)
        for (let col = 0; col <= steps; col++) {
            const x = (col / steps - 0.5) * width,
                z = (row / steps - 0.5) * depth;
            const nx = Math.abs(x) / (width / 2),
                nz = Math.abs(z) / (depth / 2);
            const slope = Math.max(Math.max(0, nx - 0.3) / 0.7, nz);
            positions.push(x, height * (Math.pow(1 - slope, 1.55) + 0.12 * Math.pow(nx * nz, 6)), z);
            if (row < steps && col < steps) {
                const a = row * (steps + 1) + col,
                    b = a + steps + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function makeBuilding(e: Entity) {
    const p = assetParameters(e),
        root = new T.Group(),
        m = material(e.color),
        anchors: ContactAnchor[] = [];
    const roofMaterial = material(new T.Color(e.color).lerp(new T.Color('#293c41'), 0.82));
    roofMaterial.roughness = 0.9;
    roofMaterial.side = T.DoubleSide;
    const trimMaterial = material(new T.Color(e.color).lerp(new T.Color('#66564a'), 0.72));
    const stoneMaterial = material(new T.Color(e.color).multiplyScalar(0.76));
    const trim = detailBoxes(root, trimMaterial),
        stone = detailBoxes(root, stoneMaterial);
    root.userData.contactAnchors = anchors;
    const w = p.width,
        d = p.depth,
        t = p.thickness,
        fh = p.floorHeight,
        height = fh * p.levels,
        slab = Math.min(0.16, t);
    const style = e.asset.replace('building-', '');
    const b = (width: number, h: number, depth: number, x = 0, y = h / 2, z = 0, parent: T.Object3D = root) =>
        mesh(parent, new T.BoxGeometry(width, h, depth), m, x, y, z);
    const facade = (width: number, level: number, front: boolean, parent: T.Object3D, outward: number) => {
        const bay = width / p.bays;
        const frames = detailBoxes(parent as T.Group, trimMaterial);
        for (let i = 0; i < p.bays; i++) {
            const x = -width / 2 + (i + 0.5) * bay,
                doorway = front && level === 0 && i === Math.floor(p.bays / 2);
            const holeW = doorway ? Math.min(bay * 0.72, style === 'warehouse' ? 3 : 1.5) : bay * 0.56;
            const sill = doorway ? slab : fh * 0.32,
                holeH = doorway ? fh * 0.76 : fh * 0.43;
            const pier = (bay - holeW) / 2,
                base = level * fh;
            b(pier, fh, t, x - bay / 2 + pier / 2, base + fh / 2, 0, parent);
            b(pier, fh, t, x + bay / 2 - pier / 2, base + fh / 2, 0, parent);
            b(holeW, sill, t, x, base + sill / 2, 0, parent);
            const lintel = fh - sill - holeH;
            b(holeW, lintel, t, x, base + fh - lintel / 2, 0, parent);
            const frame = Math.min(0.07, bay * 0.04),
                face = outward * (t / 2 + frame / 2);
            // The frame stays outside the original opening; doors retain their clear width.
            for (const sign of [-1, 1])
                frames.add(
                    frame,
                    holeH + frame,
                    frame,
                    x + (sign * (holeW + frame)) / 2,
                    base + sill + holeH / 2,
                    face,
                );
            frames.add(holeW + frame * 2, frame, frame * 1.5, x, base + sill + holeH + frame / 2, face);
            if (!doorway) {
                frames.add(holeW + frame * 3, frame, frame * 2.5, x, base + sill - frame / 2, face);
                frames.add(frame * 0.55, holeH, frame * 0.6, x, base + sill + holeH / 2, face);
                frames.add(holeW, frame * 0.55, frame * 0.6, x, base + sill + holeH * 0.6, face);
            }
        }
        frames.finish();
    };
    if (style === 'fortwall') {
        b(w, height, d).name = 'wall_body';
        anchors.push({ id: 'wall-walk', role: 'surface', position: [0, height, 0], normal: [0, 1, 0] });
    } else {
        for (let level = 0; level < p.levels; level++) {
            b(w, slab, d, 0, level * fh + slab / 2).name = `floor_${level + 1}`;
            anchors.push({
                id: 'floor-' + level,
                role: 'surface',
                position: [0, level * fh + slab, 0],
                normal: [0, 1, 0],
            });
        }
        if (style === 'pavilion')
            for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
                for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) {
                    const column = mesh(
                        root,
                        new T.CylinderGeometry(t * 0.42, t * 0.5, height, 12),
                        trimMaterial,
                        x,
                        height / 2,
                        z,
                    );
                    column.name = 'column';
                    stone.add(t * 1.6, slab, t * 1.6, x, slab / 2, z);
                }
        else
            for (const side of ['front', 'back', 'left', 'right']) {
                const wall = new T.Group();
                wall.name = `wall_${side}`;
                root.add(wall);
                const across = side === 'front' || side === 'back';
                if (across) wall.position.z = (side === 'front' ? 1 : -1) * (d / 2 - t / 2);
                else {
                    wall.position.x = (side === 'right' ? 1 : -1) * (w / 2 - t / 2);
                    wall.rotation.y = Math.PI / 2;
                }
                for (let level = 0; level < p.levels; level++)
                    facade(
                        across ? w : d - 2 * t,
                        level,
                        side === 'front',
                        wall,
                        side === 'back' || side === 'left' ? -1 : 1,
                    );
            }
    }
    if (p.roofStyle === 3) {
        if (style !== 'fortwall') {
            b(w, slab, d, 0, height - slab / 2).name = 'roof_slab';
            anchors.push({ id: 'roof', role: 'surface', position: [0, height, 0], normal: [0, 1, 0] });
        }
        if (p.roofHeight > 0) {
            const count = p.bays ?? 3;
            for (let i = 0; i < count; i++)
                for (const z of [-d / 2 + t / 2, d / 2 - t / 2])
                    b(
                        (w / count) * 0.55,
                        p.roofHeight,
                        t,
                        -w / 2 + ((i + 0.5) * w) / count,
                        height + p.roofHeight / 2,
                        z,
                    ).name = `parapet_${i + 1}_${z < 0 ? 'back' : 'front'}`;
            if (style !== 'fortwall')
                for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
                    b(t, p.roofHeight * 0.5, d, x, height + p.roofHeight * 0.25).name =
                        x < 0 ? 'parapet_left' : 'parapet_right';
        }
    } else if (p.roofStyle === 0 || p.roofHeight === 0) {
        b(w + 0.2, slab, d + 0.2, 0, height + slab / 2).name = 'roof_slab';
        if (p.roofHeight > 0)
            for (const z of [-d / 2, d / 2])
                b(w, p.roofHeight, t, 0, height + slab + p.roofHeight / 2, z).name = z < 0 ? 'roof_back' : 'roof_front';
        if (style === 'fortwall') anchors[0].position[1] = height + slab;
        else anchors.push({ id: 'roof', role: 'surface', position: [0, height + slab, 0], normal: [0, 1, 0] });
    } else if (p.roofStyle === 2) {
        const roof = hipRoof(w + 0.4, d + 0.4, p.roofHeight);
        const part = mesh(root, roof, roofMaterial, 0, height);
        part.name = 'roof';
        trim.add(w + 0.35, slab * 0.7, d + 0.35, 0, height - slab * 0.35, 0);
    } else {
        const shape = new T.Shape([
            new T.Vector2(-w / 2 - 0.15, 0),
            new T.Vector2(w / 2 + 0.15, 0),
            new T.Vector2(0, p.roofHeight),
        ]);
        const roof = new T.ExtrudeGeometry(shape, { depth: d + 0.3, bevelEnabled: false });
        roof.translate(0, height, -d / 2 - 0.15);
        mesh(root, roof, roofMaterial).name = 'roof';
        // Separate ridge and eave courses give the roof a readable thickness.
        trim.add(0.13, 0.13, d + 0.3, 0, height + p.roofHeight - 0.065, 0);
        for (const side of [-1, 1]) trim.add(0.12, 0.12, d + 0.3, side * (w / 2 + 0.09), height + 0.06, 0);
    }
    if (style !== 'fortwall') {
        const band = Math.min(0.12, fh * 0.035);
        // Bases and floor belts add depth without sealing any window or doorway.
        for (let level = 1; level <= p.levels; level++) {
            for (const sign of [-1, 1]) {
                stone.add(w, band, 0.05, 0, level * fh - band / 2, sign * (d / 2 + 0.025));
                stone.add(0.05, band, d, sign * (w / 2 + 0.025), level * fh - band / 2, 0);
            }
        }
    }
    trim.finish();
    stone.finish();
    // Some roof styles do not use all three surfaces.
    const used = new Set<T.Material>();
    root.traverse((object) => {
        if (object instanceof T.Mesh)
            for (const surface of Array.isArray(object.material) ? object.material : [object.material])
                used.add(surface);
    });
    for (const surface of [roofMaterial, trimMaterial, stoneMaterial]) if (!used.has(surface)) surface.dispose();
    return root;
}

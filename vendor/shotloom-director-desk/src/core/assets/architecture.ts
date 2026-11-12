import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { box, material } from './geometry.ts';

export function makeArchitecture(e: Entity) {
    const root = new T.Group(),
        p = assetParameters(e),
        m = material(e.color);
    const w = p.width,
        h = p.height,
        d = p.depth,
        t = p.frame;
    const b = (width: number, height: number, depth: number, x = 0, y = height / 2, z = 0, parent: T.Object3D = root) =>
        box(parent, m, width, height, depth, x, y, z, 0);
    const frame = (width: number, height: number, thick: number, bottom: boolean, parent: T.Object3D = root) => {
        b(thick, height, d, -width / 2 + thick / 2, height / 2, 0, parent);
        b(thick, height, d, width / 2 - thick / 2, height / 2, 0, parent);
        b(width - thick * 2, thick, d, 0, height - thick / 2, 0, parent);
        if (bottom) b(width - thick * 2, thick, d, 0, thick / 2, 0, parent);
    };
    if (e.asset === 'structure-wall' && p.openingWidth > 0) {
        // The opening sits at openingOffset along the wall (0 = centred); the two side panels therefore
        // have different widths. Doors are rarely centred, and without this every off-centre door was
        // built as two separate walls — which is what doubled the wall count in long layout sessions.
        const offset = Math.max(-(w - p.openingWidth) / 2, Math.min((w - p.openingWidth) / 2, p.openingOffset ?? 0));
        const openingCenter = offset,
            openingLeft = openingCenter - p.openingWidth / 2,
            openingRight = openingCenter + p.openingWidth / 2;
        const leftWidth = openingLeft + w / 2,
            rightWidth = w / 2 - openingRight;
        const top = h - p.sill - p.openingHeight;
        if (leftWidth > 1e-6) b(leftWidth, h, d, -w / 2 + leftWidth / 2);
        if (rightWidth > 1e-6) b(rightWidth, h, d, w / 2 - rightWidth / 2);
        if (p.sill > 0) b(p.openingWidth, p.sill, d, openingCenter);
        if (top > 0) b(p.openingWidth, top, d, openingCenter, h - top / 2);
    } else if (
        ['structure-doorframe', 'structure-door', 'structure-windowframe', 'structure-window'].includes(e.asset)
    ) {
        const window = e.asset.includes('window');
        frame(w, h, t, window);
        if (e.asset === 'structure-door' || e.asset === 'structure-window') {
            const leaf = new T.Group(),
                innerW = w - t * 2,
                innerH = h - t * (window ? 2 : 1);
            leaf.position.set(-w / 2 + t, window ? t : 0, 0);
            leaf.rotation.y = -T.MathUtils.degToRad(p.opening);
            root.add(leaf);
            if (!window) {
                b(innerW, innerH - 0.012, Math.min(0.045, d * 0.7), innerW / 2, innerH / 2, 0, leaf);
                b(0.12, 0.025, 0.06, innerW - 0.1, innerH * 0.47, d * 0.3, leaf);
            } else {
                // Open white-frame sash, without a fake opaque glass surface.
                const sash = new T.Group();
                sash.position.x = innerW / 2;
                leaf.add(sash);
                frame(innerW, innerH, t * 0.55, true, sash);
                b(t * 0.45, innerH - t, Math.min(0.05, d), 0, innerH / 2, 0, sash);
            }
        }
    } else b(w, h, d);
    if (['structure-slab', 'structure-beam', 'structure-column'].includes(e.asset))
        root.userData.contactAnchors = [{ id: 'top', role: 'surface', position: [0, h, 0], normal: [0, 1, 0] }];
    return root;
}

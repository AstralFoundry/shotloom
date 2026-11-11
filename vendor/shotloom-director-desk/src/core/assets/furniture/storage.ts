import * as T from 'three';
import type { FurnitureStyle } from '../catalog/furniture.ts';
import type { FurnitureBuilder } from './shared.ts';

export function buildStorage(f: FurnitureBuilder, style: FurnitureStyle): boolean {
    const { root, w, h, d, t, p, b, c, legs, anchor, dark, light } = f;
    if (['table', 'roundtable', 'desk', 'coffeetable', 'counter', 'lectern', 'register', 'vanity'].includes(style)) {
        const top = p.surfaceHeight ?? h;
        if (style === 'roundtable') {
            const disc = c(0.5, t, 0, top - t / 2);
            disc.scale.set(w, 1, d);
            c(t, top - t, 0, (top - t) / 2);
            const foot = c(0.35, t, 0, t / 2);
            foot.scale.set(w, 1, d);
        } else {
            b(w, t, d, 0, top - t / 2);
            if (['counter', 'lectern', 'register'].includes(style)) b(w * 0.85, top - t, d * 0.85, 0, (top - t) / 2);
            else legs(top - t, t * 1.5);
            if (style === 'desk') {
                b(w * 0.28, top * 0.7, d * 0.9, w * 0.31, top * 0.55);
                for (let i = 1; i < 4; i++)
                    b(w * 0.22, t * 0.4, t, w * 0.31, top * 0.25 + i * top * 0.14, d * 0.455, dark);
            }
        }
        if (style === 'vanity') {
            b(w * 0.65, h - top, t, 0, (h + top) / 2, -d / 2 + t / 2);
            b(w * 0.58, (h - top) * 0.83, t * 0.5, 0, (h + top) / 2, -d / 2 + t, light);
        }
        if (style === 'register') {
            b(w * 0.26, h - top, d * 0.28, w * 0.24, (h + top) / 2, -d * 0.2, dark);
        }
        anchor('surface', 'surface', 0, top, 0);
        return true;
    }
    if (!['wardrobe', 'shelf', 'rack', 'nightstand', 'cabinet'].includes(style)) return false;
    if (style === 'rack') legs(h, t / 2);
    else {
        b(t, h, d, -w / 2 + t / 2, h / 2);
        b(t, h, d, w / 2 - t / 2, h / 2);
        b(w, h, t, 0, h / 2, -d / 2 + t / 2);
    }
    const layers = p.layers ?? 2;
    for (let i = 0; i < layers; i++) {
        const y = t / 2 + ((h - t) * i) / (layers - 1);
        b(w, t, d, 0, y);
        anchor(`shelf-${i + 1}`, 'surface', 0, y + t / 2, 0);
    }
    if (style === 'wardrobe') {
        for (const sign of [-1, 1]) {
            const hinge = new T.Group();
            hinge.position.set((sign * w) / 2, 0, d / 2);
            hinge.rotation.y = sign * T.MathUtils.degToRad(p.opening ?? 0);
            root.add(hinge);
            b(w / 2 - t, h - t, t, (-sign * w) / 4, h / 2, -t / 2, f.m, hinge);
            b(t * 0.45, h * 0.1, t * 1.5, -sign * (w / 2 - t * 2), h * 0.5, t * 0.3, dark, hinge);
        }
    } else if (['nightstand', 'cabinet'].includes(style)) {
        const rows = style === 'nightstand' ? 2 : 1;
        for (let i = 0; i < rows; i++) {
            b(w - t * 2, h / rows - t, t, 0, ((i + 0.5) * h) / rows, d / 2 - t / 2);
            b(w * 0.25, t * 0.4, t, 0, ((i + 0.55) * h) / rows, d / 2, dark);
        }
    }
    return true;
}

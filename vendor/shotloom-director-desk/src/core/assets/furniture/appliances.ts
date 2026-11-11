import type { FurnitureStyle } from '../catalog/furniture.ts';
import type { FurnitureBuilder } from './shared.ts';

export function buildAppliance(f: FurnitureBuilder, style: FurnitureStyle): boolean {
    if (!['sink', 'stove', 'fridge', 'washer', 'toilet', 'bathtub', 'shower', 'vending'].includes(style)) return false;
    const { w, h, d, t, b, c, anchor, dark, light, disk } = f;
    if (style === 'bathtub' || style === 'sink') {
        const base = style === 'sink' ? h * 0.58 : t,
            rim = style === 'sink' ? h * 0.87 : h;
        b(w, base, d, 0, base / 2);
        for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) b(t, rim - base, d, x, (rim + base) / 2);
        for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) b(w, rim - base, t, 0, (rim + base) / 2, z);
        if (style === 'sink') {
            c(t * 0.45, h - rim, 0, (h + rim) / 2, -d * 0.4);
            b(t, t, h * 0.1, 0, h - t / 2, -d * 0.4 + h * 0.05);
        }
        anchor('basin', 'surface', 0, base, 0);
        return true;
    }
    if (style === 'toilet') {
        b(w * 0.75, h * 0.34, d * 0.6, 0, h * 0.17, d * 0.08);
        const ring = c(0.5, t, 0, h * 0.5);
        ring.scale.set(w, 1, d * 0.72);
        c(w * 0.25, h * 0.12, 0, h * 0.4, d * 0.06, light);
        b(w * 0.9, h * 0.5, d * 0.25, 0, h * 0.75, -d * 0.375);
        anchor('seat', 'seat', 0, h * 0.5 + t / 2, d * 0.08);
        return true;
    }
    if (style === 'shower') {
        b(w, t, d);
        for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
            for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) b(t, h, t, x, h / 2, z);
        b(w, h, t, 0, h / 2, -d / 2 + t / 2, light);
        b(t, h, d, -w / 2 + t / 2, h / 2, 0, light);
        b(w, t, d, 0, h - t / 2);
        return true;
    }
    b(w, h, d);
    if (style === 'stove') {
        for (const x of [-w * 0.25, w * 0.25])
            for (const z of [-d * 0.23, d * 0.23]) {
                c(Math.min(w, d) * 0.16, t / 3, x, h + t / 6, z, dark);
                anchor(`burner-${x < 0 ? 'left' : 'right'}-${z < 0 ? 'back' : 'front'}`, 'surface', x, h + t / 3, z);
            }
        b(w * 0.75, h * 0.5, t, 0, h * 0.38, d / 2, dark);
        for (const x of [-w * 0.3, 0, w * 0.3]) disk(t, t, x, h * 0.78, d / 2 + t / 2, light);
        anchor('cooktop', 'surface', 0, h, 0);
    } else if (style === 'washer') {
        disk(w * 0.32, t, 0, h * 0.43, d / 2 + t / 2, light);
        disk(w * 0.25, t * 0.5, 0, h * 0.43, d / 2 + t, dark);
        disk(t, t, w * 0.3, h * 0.86, d / 2 + t);
    } else if (style === 'fridge') {
        b(w - t * 2, t * 0.35, t, 0, h * 0.68, d / 2, dark);
        b(t * 0.6, h * 0.2, t, w * 0.34, h * 0.46, d / 2 + t / 2, dark);
        b(t * 0.6, h * 0.12, t, w * 0.34, h * 0.83, d / 2 + t / 2, dark);
    } else if (style === 'vending') {
        b(w * 0.65, h * 0.65, t, -w * 0.1, h * 0.6, d / 2, dark);
        for (let row = 0; row < 4; row++)
            for (let col = 0; col < 3; col++)
                b(w * 0.14, h * 0.1, t, -w * 0.3 + col * w * 0.2, h * 0.35 + row * h * 0.14, d / 2 + t, light);
        b(w * 0.6, h * 0.1, t, 0, h * 0.14, d / 2, dark);
        for (let i = 0; i < 4; i++) disk(t * 0.6, t, w * 0.37, h * 0.48 + i * h * 0.065, d / 2 + t, light);
    }
    return true;
}

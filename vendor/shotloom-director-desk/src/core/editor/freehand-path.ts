import type { Vec3, Waypoint } from '../model.ts';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function segmentDistance(p: Vec3, a: Vec3, b: Vec3) {
    const length = distance(a, b) ** 2;
    const t = length
        ? Math.max(0, Math.min(1, p.reduce((sum, v, i) => sum + (v - a[i]) * (b[i] - a[i]), 0) / length))
        : 0;
    return Math.hypot(...p.map((v, i) => v - a[i] - (b[i] - a[i]) * t));
}

/** Simplify in three dimensions, including stair corners and closed loops. */
export function simplifyFreehand(points: readonly Vec3[], tolerance = 0.02): Vec3[] {
    if (!Number.isFinite(tolerance) || tolerance <= 0) throw Error('路线精度无效');
    const clean: Vec3[] = [];
    for (const p of points) {
        if (p.length !== 3 || !p.every(Number.isFinite)) throw Error('路线坐标无效');
        if (!clean.length || distance(p, clean.at(-1)!) > 1e-5) clean.push([...p]);
    }
    if (clean.length < 3) return clean;
    const keep = new Set([0, clean.length - 1]),
        stack = [[0, clean.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop()!;
        let farthest = -1,
            error = tolerance;
        for (let i = first + 1; i < last; i++) {
            const d = segmentDistance(clean[i], clean[first], clean[last]);
            if (d > error) {
                farthest = i;
                error = d;
            }
        }
        if (farthest >= 0) {
            keep.add(farthest);
            stack.push([first, farthest], [farthest, last]);
        }
    }
    return [...keep].sort((a, b) => a - b).map((i) => clean[i]);
}

/** Timing depends on distance, never pointer speed, event count or drawing pauses. */
export function timeFreehand(points: readonly Vec3[], start: number, duration: number): Waypoint[] {
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0)
        throw Error('路线时长无效');
    const clean = simplifyFreehand(points, 0.00001);
    if (clean.length < 2) return clean.map((position) => ({ time: start, position }));
    const lengths = clean.map((p, i) => (i ? distance(p, clean[i - 1]) : 0)),
        total = lengths.reduce((a, b) => a + b, 0);
    let passed = 0;
    return clean.map((position, i) => {
        passed += lengths[i];
        return { time: i === clean.length - 1 ? start + duration : start + (passed / total) * duration, position };
    });
}

import type { MotionPath } from '../model.ts';
import { eased } from './channels.ts';

export const headingDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Heading shares the position source clock, including split/retimed sections. */
export function sourcePathHeading(path: MotionPath, time: number): number | undefined {
    const points = path.points;
    if (!points.length || points[0].heading === undefined) return undefined;
    if (time <= points[0].time) return points[0].heading;
    if (time >= points.at(-1)!.time) return points.at(-1)!.heading;
    let lo = 0,
        hi = points.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (points[mid].time <= time) lo = mid;
        else hi = mid;
    }
    const a = points[lo],
        b = points[hi];
    const progress = eased((time - a.time) / (b.time - a.time), b.easing);
    return a.heading! + headingDelta(a.heading!, b.heading!) * progress;
}

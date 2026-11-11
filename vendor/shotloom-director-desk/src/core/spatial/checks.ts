import type { Box3, Object3D } from 'three';
import type { Entity, Project } from '../model.ts';

/**
 * Spatial continuity checks.
 *
 * Everything here answers one question a rendered frame cannot: at this moment, are two
 * characters standing in the same place, is one of them inside a wall, and is the camera
 * looking at the back of a prop that was supposed to be in front. The functions are pure so
 * the sampling loop in the panel never touches editor state, and so they can be unit-tested
 * against synthetic boxes.
 */

export interface SpatialBox {
    id: string;
    name: string;
    kind: Entity['kind'];
    /** Axis-aligned bounds in world space. */
    min: [number, number, number];
    max: [number, number, number];
    /** True for anything that occludes the camera: props, buildings, walls. */
    occluder: boolean;
}

export interface SpatialIssue {
    kind: 'overlap' | 'crowd' | 'outOfFrame' | 'occluded';
    time: number;
    /** Ids of the entities involved, so the UI can locate them. */
    ids: string[];
    message: string;
    severity: 'warning' | 'error';
}

export const overlapTolerance = 0.02;
/** Two characters closer than this are treated as crowding each other. */
export const crowdDistance = 0.42;

function intersects(a: SpatialBox, b: SpatialBox) {
    return (
        a.min[0] < b.max[0] - overlapTolerance &&
        a.max[0] > b.min[0] + overlapTolerance &&
        a.min[1] < b.max[1] - overlapTolerance &&
        a.max[1] > b.min[1] + overlapTolerance &&
        a.min[2] < b.max[2] - overlapTolerance &&
        a.max[2] > b.min[2] + overlapTolerance
    );
}

function center(box: SpatialBox): [number, number, number] {
    return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function horizontalDistance(a: SpatialBox, b: SpatialBox) {
    const pa = center(a),
        pb = center(b);
    return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
}

/** Overlapping bodies, and characters standing inside furniture or architecture. */
export function checkOverlaps(boxes: SpatialBox[], time: number): SpatialIssue[] {
    const issues: SpatialIssue[] = [];
    const characters = boxes.filter((box) => box.kind === 'actor' || box.kind === 'crowd');
    for (let i = 0; i < characters.length; i += 1) {
        for (let j = i + 1; j < characters.length; j += 1) {
            const a = characters[i],
                b = characters[j];
            if (!intersects(a, b)) continue;
            issues.push({
                kind: 'overlap',
                time,
                ids: [a.id, b.id],
                severity: 'error',
                message: `${a.name} 与 ${b.name} 身体重叠`,
            });
        }
        // Standing inside a prop or a wall reads as a modelling error on screen, not as a
        // deliberate contact, so furniture is checked with a slightly tighter tolerance.
        for (const solid of boxes) {
            if (!solid.occluder || solid.kind === 'camera') continue;
            const a = characters[i];
            if (intersects(a, solid)) {
                issues.push({
                    kind: 'overlap',
                    time,
                    ids: [a.id, solid.id],
                    severity: 'warning',
                    message: `${a.name} 与 ${solid.name} 相交`,
                });
            }
        }
    }
    return issues;
}

/** Characters closer than a conversational distance, which usually means a blocking mistake. */
export function checkCrowding(boxes: SpatialBox[], time: number): SpatialIssue[] {
    const issues: SpatialIssue[] = [];
    const characters = boxes.filter((box) => box.kind === 'actor' || box.kind === 'crowd');
    for (let i = 0; i < characters.length; i += 1) {
        for (let j = i + 1; j < characters.length; j += 1) {
            const a = characters[i],
                b = characters[j];
            // Overlap is reported by `checkOverlaps`; crowding is the "too close but legal" band.
            if (intersects(a, b)) continue;
            const gap = horizontalDistance(a, b);
            if (gap >= crowdDistance) continue;
            issues.push({
                kind: 'crowd',
                time,
                ids: [a.id, b.id],
                severity: 'warning',
                message: `${a.name} 与 ${b.name} 距离过近（${gap.toFixed(2)} m）`,
            });
        }
    }
    return issues;
}

/**
 * Whether an entity's centre projects inside the camera's frustum.
 *
 * Uses the camera's own projection matrix, so a focal-length change or an aspect change is
 * reflected without duplicating any framing maths.
 */
export function isInFrame(
    point: [number, number, number],
    camera: { projectionMatrix: { elements: ArrayLike<number> }; matrixWorldInverse: { elements: ArrayLike<number> } },
): boolean {
    const e = camera.projectionMatrix.elements,
        m = camera.matrixWorldInverse.elements;
    const [x, y, z] = point;
    // World → view first; the projection matrix expects view-space coordinates.
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    // A camera looks down -Z in view space, so anything with vz >= 0 is behind the lens. Testing
    // the clip-space w is not enough here: with a typical projection matrix w = -vz, so a point
    // directly behind the camera still yields w > 0 and would pass the frustum test.
    if (vz >= -1e-6) return false;
    const px = e[0] * vx + e[4] * vy + e[8] * vz + e[12];
    const py = e[1] * vx + e[5] * vy + e[9] * vz + e[13];
    const pz = e[2] * vx + e[6] * vy + e[10] * vz + e[14];
    const pw = e[3] * vx + e[7] * vy + e[11] * vz + e[15];
    if (pw <= 0) return false;
    return Math.abs(px / pw) <= 1 && Math.abs(py / pw) <= 1 && pz / pw >= -1 && pz / pw <= 1;
}

/** Build a comparable box from an entity's world bounds. */
export function toSpatialBox(
    id: string,
    name: string,
    kind: Entity['kind'],
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
    occluder: boolean,
): SpatialBox {
    return {
        id,
        name,
        kind,
        occluder,
        min: [bounds.min.x, bounds.min.y, bounds.min.z],
        max: [bounds.max.x, bounds.max.y, bounds.max.z],
    };
}

/** What the caller must supply for one sample: bounds and the camera matrix at that moment. */
export interface SampleContext {
    boxes: SpatialBox[];
    camera?: {
        projectionMatrix: { elements: ArrayLike<number> };
        matrixWorldInverse: { elements: ArrayLike<number> };
    };
    /** Entities that must be on screen for this shot to make sense. */
    requiredIds?: string[];
}

/** Run every check for a single sampled moment. */
export function checkSample(context: SampleContext, time: number): SpatialIssue[] {
    const issues = [...checkOverlaps(context.boxes, time), ...checkCrowding(context.boxes, time)];
    if (context.camera) {
        const wanted = new Set(context.requiredIds ?? []);
        for (const box of context.boxes) {
            if (box.kind !== 'actor' && box.kind !== 'crowd') continue;
            if (wanted.size && !wanted.has(box.id)) continue;
            if (!isInFrame(center(box), context.camera)) {
                issues.push({
                    kind: 'outOfFrame',
                    time,
                    ids: [box.id],
                    severity: 'warning',
                    message: `${box.name} 不在当前机位画面内`,
                });
            }
        }
    }
    return issues;
}

/** Group issues that repeat across consecutive samples into one row per continuous run. */
export function groupIssues(issues: SpatialIssue[], fps: number): SpatialIssue[] {
    const frame = 1 / Math.max(1, fps);
    const rows: Array<SpatialIssue & { end: number }> = [];
    // The same pair can misbehave, settle down and misbehave again; each run is its own row, so
    // the report reads as a list of moments rather than one row per pair.
    const open = new Map<string, (typeof rows)[number]>();
    for (const issue of [...issues].sort((a, b) => a.time - b.time)) {
        const key = `${issue.kind}:${[...issue.ids].sort().join(',')}`;
        const active = open.get(key);
        if (active && issue.time - active.end <= frame * 2.5) {
            active.end = issue.time;
            continue;
        }
        const row = { ...issue, end: issue.time };
        rows.push(row);
        open.set(key, row);
    }
    return rows.map(({ end: _end, ...issue }) => issue);
}

/** Compact machine-readable report for the host or a bug ticket. */
export function spatialReportJson(issues: SpatialIssue[], project: Project, range: { start: number; end: number }) {
    return JSON.stringify(
        {
            project: project.name,
            range,
            fps: project.fps,
            issues: issues.map((issue) => ({
                kind: issue.kind,
                severity: issue.severity,
                time: Number(issue.time.toFixed(3)),
                ids: issue.ids,
                message: issue.message,
            })),
        },
        null,
        2,
    );
}

/** Human-readable report; one line per issue, easy to paste into a note. */
export function spatialReportText(issues: SpatialIssue[], project: Project, range: { start: number; end: number }) {
    const header = `${project.name} · ${range.start.toFixed(2)}s—${range.end.toFixed(2)}s · ${project.fps} fps`;
    if (!issues.length) return `${header}\n未发现空间问题。`;
    return [
        header,
        `${issues.length} 项待确认：`,
        ...issues.map(
            (issue) => `[${issue.time.toFixed(2)}s] ${issue.severity === 'error' ? '错误' : '提示'} · ${issue.message}`,
        ),
    ].join('\n');
}

/** Bounds of a three.js object as the plain numbers the checks consume. */
export function boundsOf(object: Object3D, box: Box3) {
    object.updateWorldMatrix(true, true);
    box.setFromObject(object);
    return box;
}

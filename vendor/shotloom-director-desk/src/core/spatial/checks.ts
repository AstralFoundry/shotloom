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
    kind: 'overlap' | 'crowd' | 'outOfFrame' | 'occluded' | 'cameraInSolid' | 'unsupported';
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

/** Bounds closer than this count as resting on each other; boxes are approximate anyway. */
export const contactTolerance = 0.03;

function touches(a: SpatialBox, b: SpatialBox) {
    for (const axis of [0, 1, 2] as const) {
        if (a.min[axis] > b.max[axis] + contactTolerance || a.max[axis] < b.min[axis] - contactTolerance) return false;
    }
    return true;
}

/**
 * Standing props that rest on nothing.
 *
 * Every catalogue prop has its origin at the centre of its base, so `position.y` is where its
 * underside sits. Read as a centre instead, a wall floats by half its height — and so does the
 * whole building around it, which is why "touches something" cannot be the test: the floating
 * walls touch each other. Support therefore spreads only from the ground. Whatever rests on the
 * floor (or reaches below it) holds things up, so does anything touching a held-up piece, and a
 * subject that support never reaches is floating. Lintels between walls, lamps on tables and
 * hats on heads are all held up this way; a bird or a drone is not, and the message says so.
 */
export function checkUnsupported(
    boxes: SpatialBox[],
    subjects: ReadonlySet<string> | null,
    time: number,
): SpatialIssue[] {
    const held = new Set<string>();
    const queue = boxes.filter((box) => box.min[1] <= contactTolerance);
    for (const box of queue) held.add(box.id);
    for (let index = 0; index < queue.length; index += 1) {
        for (const box of boxes) {
            if (held.has(box.id) || !touches(queue[index], box)) continue;
            held.add(box.id);
            queue.push(box);
        }
    }
    return boxes
        .filter((box) => box.kind === 'prop' && !held.has(box.id) && (!subjects || subjects.has(box.id)))
        .map((box) => ({
            kind: 'unsupported' as const,
            time,
            ids: [box.id],
            severity: 'warning' as const,
            message: `「${box.name}」悬空：底面离地 ${box.min[1].toFixed(2)} 米，没有接触地面，也没有接触任何落地的物体`,
        }));
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

function containsPoint(box: SpatialBox, point: [number, number, number], slack = overlapTolerance) {
    return (
        point[0] > box.min[0] + slack &&
        point[0] < box.max[0] - slack &&
        point[1] > box.min[1] + slack &&
        point[1] < box.max[1] - slack &&
        point[2] > box.min[2] + slack &&
        point[2] < box.max[2] - slack
    );
}

/**
 * Solids that swallow the camera itself.
 *
 * A rendered frame cannot report this: when the near plane sits inside a wall, the wall renders
 * as one flat slab and the honest reading is "the preview is broken", not "the camera is inside
 * a wall". The first follow-cam attempt in the warehouse recreation failed exactly this way and
 * the sweep said nothing, because camera bodies never entered the box list.
 */
export function checkCameraInSolid(
    cameraPosition: [number, number, number] | undefined,
    boxes: SpatialBox[],
    time: number,
): SpatialIssue[] {
    if (!cameraPosition) return [];
    const issues: SpatialIssue[] = [];
    for (const solid of boxes) {
        if (!solid.occluder || solid.kind === 'camera') continue;
        if (!containsPoint(solid, cameraPosition)) continue;
        issues.push({
            kind: 'cameraInSolid',
            time,
            ids: [solid.id],
            severity: 'error',
            message: `机位在「${solid.name}」内部，整屏会被这个物体挡住`,
        });
    }
    return issues;
}

/**
 * Whether any solid sits between the camera and a subject it is supposed to show.
 *
 * Sampled as a segment against each occluder's bounds: the nearest solid that starts before the
 * subject is the one hiding it, which is what a person would say looking at the frame.
 */
export function checkOcclusion(
    cameraPosition: [number, number, number] | undefined,
    boxes: SpatialBox[],
    requiredIds: string[] | undefined,
    time: number,
): SpatialIssue[] {
    if (!cameraPosition) return [];
    const wanted = new Set(requiredIds ?? []);
    const subjects = boxes.filter(
        (box) => (box.kind === 'actor' || box.kind === 'crowd') && (!wanted.size || wanted.has(box.id)),
    );
    if (!subjects.length) return [];
    // A solid the camera sits inside is reported once as `cameraInSolid`; counting it again as an
    // occluder would bury the real cause under one "who blocks whom" row per subject.
    const solids = boxes.filter(
        (box) => box.occluder && box.kind !== 'camera' && !containsPoint(box, cameraPosition),
    );
    if (!solids.length) return [];
    const issues: SpatialIssue[] = [];
    for (const subject of subjects) {
        const hit = firstSolidAlong(cameraPosition, center(subject), solids, subject.id);
        if (!hit) continue;
        issues.push({
            kind: 'occluded',
            time,
            ids: [subject.id, hit.id],
            severity: 'warning',
            message: `${subject.name} 被「${hit.name}」挡住`,
        });
    }
    return issues;
}

/** Nearest occluder crossing the segment, ignoring hits that land behind the subject. */
function firstSolidAlong(
    from: [number, number, number],
    to: [number, number, number],
    solids: SpatialBox[],
    subjectId: string,
): SpatialBox | null {
    const direction: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    let nearest: { box: SpatialBox; entry: number } | null = null;
    for (const solid of solids) {
        if (solid.id === subjectId) continue;
        // Slab test against the unit segment [0,1]: entry is how far along the ray the solid starts.
        let entry = 0,
            exit = 1;
        let misses = false;
        for (const axis of [0, 1, 2] as const) {
            const delta = direction[axis];
            const low = solid.min[axis] - from[axis],
                high = solid.max[axis] - from[axis];
            if (Math.abs(delta) < 1e-9) {
                if (low > 0 || high < 0) {
                    misses = true;
                    break;
                }
                continue;
            }
            const a = Math.min(low / delta, high / delta),
                b = Math.max(low / delta, high / delta);
            entry = Math.max(entry, a);
            exit = Math.min(exit, b);
            if (entry > exit) {
                misses = true;
                break;
            }
        }
        // entry >= 1 means the solid only starts past the subject: it hides nothing.
        if (misses || entry >= 1) continue;
        if (!nearest || entry < nearest.entry) nearest = { box: solid, entry };
    }
    return nearest?.box ?? null;
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
    /** Camera eye in world space; enables the inside-a-solid and occlusion checks. */
    cameraPosition?: [number, number, number];
    /** Entities that must be on screen for this shot to make sense. */
    requiredIds?: string[];
    /** Standing props (no path, not hand-held) to judge for floating; omitted skips the check. */
    standingPropIds?: ReadonlySet<string>;
}

/** Run every check for a single sampled moment. */
export function checkSample(context: SampleContext, time: number): SpatialIssue[] {
    const issues = [
        ...checkOverlaps(context.boxes, time),
        ...checkCrowding(context.boxes, time),
        ...checkCameraInSolid(context.cameraPosition, context.boxes, time),
        ...(context.standingPropIds ? checkUnsupported(context.boxes, context.standingPropIds, time) : []),
    ];
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
        issues.push(...checkOcclusion(context.cameraPosition, context.boxes, context.requiredIds, time));
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

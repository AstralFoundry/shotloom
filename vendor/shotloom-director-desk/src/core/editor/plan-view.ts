/**
 * Top-down plan view: framing, metric grid and annotations.
 *
 * Layouts usually arrive as a top-down picture, but the shot cameras never show the set that way,
 * so a layout could only be re-derived from the picture, never compared with it. Re-deriving gave a
 * different coordinate mapping every time, which did not fit the walls already built, and the whole
 * set was demolished and rebuilt again and again. The framing maths lives here, free of three.js
 * and the DOM, so it can be tested on its own. The image is oriented like the editor's top view:
 * +x to the right, −z (north) up.
 */

export interface PlanArea {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface PlanFraming {
    centerX: number;
    centerZ: number;
    /** World size covered by the image, metres. */
    width: number;
    height: number;
    metersPerPixel: number;
    pixels: { width: number; height: number };
    /** Spacing of the labelled metric grid, metres. */
    gridStep: number;
    /** World rectangle the image covers. */
    shown: PlanArea;
}

export interface PlanAnnotations {
    /** Actor routes as world [x, z] polylines, start first. */
    paths: { name: string; points: [number, number][] }[];
    /** Characters where they stand at the rendered time. */
    actors: { name: string; x: number; z: number }[];
    cameras: { name: string; x: number; z: number }[];
}

const GRID_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** The finest round step that keeps the grid readable: at most 14 lines across `span`. */
export function planGridStep(span: number): number {
    return GRID_STEPS.find((step) => span / step <= 14) ?? GRID_STEPS[GRID_STEPS.length - 1];
}

/** Frame `area` with a margin so walls on the edge of the set do not touch the border. */
export function planFraming(area: PlanArea, longSide = 1024): PlanFraming {
    const spanX = Math.max(area.maxX - area.minX, 1);
    const spanZ = Math.max(area.maxZ - area.minZ, 1);
    const pad = Math.max(spanX, spanZ) * 0.05 + 0.5;
    const width = spanX + pad * 2;
    const height = spanZ + pad * 2;
    const metersPerPixel = Math.max(width, height) / longSide;
    const centerX = (area.minX + area.maxX) / 2;
    const centerZ = (area.minZ + area.maxZ) / 2;
    return {
        centerX,
        centerZ,
        width,
        height,
        metersPerPixel,
        pixels: {
            width: Math.max(1, Math.round(width / metersPerPixel)),
            height: Math.max(1, Math.round(height / metersPerPixel)),
        },
        gridStep: planGridStep(Math.max(width, height)),
        shown: { minX: centerX - width / 2, maxX: centerX + width / 2, minZ: centerZ - height / 2, maxZ: centerZ + height / 2 },
    };
}

/** Where a world point lands in the image: +x to the right, −z up. */
export function planToPixel(framing: PlanFraming, x: number, z: number): [number, number] {
    return [
        ((x - framing.shown.minX) / framing.width) * framing.pixels.width,
        ((z - framing.shown.minZ) / framing.height) * framing.pixels.height,
    ];
}

/** World coordinates of the grid lines inside the framed area. */
export function planGridLines(framing: PlanFraming): { x: number[]; z: number[] } {
    const lines = (min: number, max: number) => {
        const values: number[] = [];
        for (let value = Math.ceil(min / framing.gridStep) * framing.gridStep; value <= max + 1e-9; value += framing.gridStep)
            values.push(Number(value.toFixed(6)));
        return values;
    };
    return { x: lines(framing.shown.minX, framing.shown.maxX), z: lines(framing.shown.minZ, framing.shown.maxZ) };
}

/**
 * Draw the metric grid, actor routes and camera spots over a rendered plan.
 *
 * Coordinates are printed on the edges so positions can be read straight off the image and fed
 * back into `add_wall` / `set_entity` without guessing a pixel-to-metre scale.
 */
export function drawPlanOverlay(context: CanvasRenderingContext2D, framing: PlanFraming, notes: PlanAnnotations) {
    const { width, height } = framing.pixels;
    const grid = planGridLines(framing);
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(30, 60, 110, 0.28)';
    for (const x of grid.x) {
        const [px] = planToPixel(framing, x, 0);
        context.beginPath();
        context.moveTo(Math.round(px) + 0.5, 0);
        context.lineTo(Math.round(px) + 0.5, height);
        context.stroke();
    }
    for (const z of grid.z) {
        const [, py] = planToPixel(framing, 0, z);
        context.beginPath();
        context.moveTo(0, Math.round(py) + 0.5);
        context.lineTo(width, Math.round(py) + 0.5);
        context.stroke();
    }
    context.font = '600 12px sans-serif';
    context.textBaseline = 'middle';
    const tag = (text: string, x: number, y: number, fill = 'rgba(255, 255, 255, 0.88)', ink = '#1d2433') => {
        const w = Math.ceil(context.measureText(text).width) + 8;
        const left = Math.min(Math.max(x, 0), width - w);
        const top = Math.min(Math.max(y - 9, 0), height - 18);
        context.fillStyle = fill;
        context.fillRect(left, top, w, 18);
        context.fillStyle = ink;
        context.fillText(text, left + 4, top + 9);
    };
    for (const x of grid.x) tag(`x=${x}`, planToPixel(framing, x, 0)[0] + 2, 10);
    for (const z of grid.z) tag(`z=${z}`, 2, planToPixel(framing, 0, z)[1]);

    for (const path of notes.paths) {
        if (path.points.length < 2) continue;
        const pixels = path.points.map(([x, z]) => planToPixel(framing, x, z));
        context.strokeStyle = '#e8590c';
        context.lineWidth = 3;
        context.beginPath();
        pixels.forEach(([px, py], index) => (index ? context.lineTo(px, py) : context.moveTo(px, py)));
        context.stroke();
        const [sx, sy] = pixels[0];
        context.fillStyle = '#e8590c';
        context.beginPath();
        context.arc(sx, sy, 5, 0, Math.PI * 2);
        context.fill();
        // Arrowhead on the last segment shows which way the route runs.
        const [ax, ay] = pixels[pixels.length - 2];
        const [bx, by] = pixels[pixels.length - 1];
        const angle = Math.atan2(by - ay, bx - ax);
        context.beginPath();
        context.moveTo(bx, by);
        context.lineTo(bx - 12 * Math.cos(angle - 0.45), by - 12 * Math.sin(angle - 0.45));
        context.lineTo(bx - 12 * Math.cos(angle + 0.45), by - 12 * Math.sin(angle + 0.45));
        context.closePath();
        context.fill();
        tag(`${path.name} 起点`, sx + 8, sy, '#e8590c', '#fff');
    }
    for (const actor of notes.actors) {
        const [px, py] = planToPixel(framing, actor.x, actor.z);
        context.fillStyle = '#c92a2a';
        context.beginPath();
        context.arc(px, py, 4, 0, Math.PI * 2);
        context.fill();
        tag(actor.name, px + 7, py + 12, 'rgba(201, 42, 42, 0.92)', '#fff');
    }
    for (const camera of notes.cameras) {
        const [px, py] = planToPixel(framing, camera.x, camera.z);
        context.fillStyle = '#1c7ed6';
        context.fillRect(px - 4, py - 4, 8, 8);
        tag(camera.name, px + 7, py - 12, 'rgba(28, 126, 214, 0.92)', '#fff');
    }
    tag('上方 = −z（北）   右方 = +x   单位：米', width - 4, height - 12);
    context.restore();
}

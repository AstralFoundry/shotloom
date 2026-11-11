import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Line, LineBasicMaterial, LineDashedMaterial } from 'three';
import type { Vec3 } from '../model.ts';

interface FreehandInputOptions {
    canvas: HTMLCanvasElement;
    enabled(): boolean;
    start(): Vec3;
    hit(points: [number, number][]): (Vec3 | null)[];
    commit(points: Vec3[]): void;
    active(value: boolean): void;
    invalidate(): void;
}

/** Capture a stroke without touching the project or rebuilding inspector/helper meshes. */
export class FreehandPathInput {
    readonly line: Line;
    private readonly options: FreehandInputOptions;
    private readonly events = new AbortController();
    private readonly positions = new Float32Array(4096 * 3);
    private readonly distances = new Float32Array(4096);
    private readonly contrast: Line;
    private points: Vec3[] = [];
    private pointer: number | null = null;
    private previous?: [number, number];
    private pending?: [number, number];
    private frame = 0;
    private interrupted = false;
    private cursor = '';
    get active() {
        return this.pointer !== null;
    }
    constructor(options: FreehandInputOptions) {
        this.options = options;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
        geometry.setDrawRange(0, 0);
        geometry.setAttribute('lineDistance', new BufferAttribute(this.distances, 1).setUsage(DynamicDrawUsage));
        this.line = new Line(geometry, new LineBasicMaterial({ color: '#ffffff', depthTest: false }));
        this.line.layers.set(1);
        this.line.renderOrder = 4;
        this.line.frustumCulled = false;
        this.line.visible = false;
        this.contrast = new Line(
            geometry,
            new LineDashedMaterial({ color: '#111111', depthTest: false, dashSize: 0.12, gapSize: 0.12 }),
        );
        this.contrast.layers.set(1);
        this.contrast.renderOrder = 5;
        this.contrast.frustumCulled = false;
        this.line.add(this.contrast);
        const { canvas } = options,
            signal = this.events.signal;
        canvas.addEventListener(
            'pointerdown',
            (e) => {
                if (e.button !== 0 || !options.enabled() || this.active) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                canvas.focus({ preventScroll: true });
                this.pointer = e.pointerId;
                this.cursor = canvas.style.cursor;
                canvas.style.cursor = 'crosshair';
                options.active(true);
                canvas.setPointerCapture(e.pointerId);
                this.points = [];
                this.interrupted = false;
                this.previous = undefined;
                this.append(options.start());
                this.consume(e.clientX, e.clientY);
            },
            { capture: true, signal },
        );
        canvas.addEventListener(
            'pointermove',
            (e) => {
                if (e.pointerId !== this.pointer) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!(e.buttons & 1)) {
                    this.finish();
                    return;
                }
                this.pending = [e.clientX, e.clientY];
                if (!this.frame)
                    this.frame = requestAnimationFrame(() => {
                        this.frame = 0;
                        this.flush();
                    });
            },
            { capture: true, signal },
        );
        canvas.addEventListener(
            'pointerup',
            (e) => {
                if (e.pointerId !== this.pointer) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this.pending = [e.clientX, e.clientY];
                this.finish();
            },
            { capture: true, signal },
        );
        canvas.addEventListener(
            'pointercancel',
            (e) => {
                if (e.pointerId === this.pointer) {
                    e.stopImmediatePropagation();
                    this.cancel();
                }
            },
            { capture: true, signal },
        );
        canvas.addEventListener(
            'lostpointercapture',
            (e) => {
                if (e.pointerId === this.pointer) this.cancel();
            },
            { signal },
        );
        window.addEventListener('blur', () => this.cancel(), { signal });
        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.hidden) this.cancel();
            },
            { signal },
        );
    }
    private append(point: Vec3) {
        if (this.points.length >= 4096) {
            this.interrupted = true;
            return;
        }
        const last = this.points.at(-1);
        if (last && Math.hypot(...point.map((v, i) => v - last[i])) < 0.005) return;
        const index = this.points.length;
        this.points.push([...point]);
        this.positions.set([point[0], point[1] + 0.025, point[2]], index * 3);
        this.distances[index] = last ? this.distances[index - 1] + Math.hypot(...point.map((v, i) => v - last[i])) : 0;
        this.line.geometry.getAttribute('lineDistance').needsUpdate = true;
        this.line.geometry.getAttribute('position').needsUpdate = true;
        this.line.geometry.setDrawRange(0, this.points.length);
        this.line.visible = true;
        this.options.invalidate();
    }
    private consume(x: number, y: number) {
        if (this.interrupted) return;
        const rect = this.options.canvas.getBoundingClientRect(),
            before = this.previous ?? [x, y];
        const steps = Math.min(32, Math.max(1, Math.ceil(Math.hypot(x - before[0], y - before[1]) / 4)));
        const samples: [number, number][] = [];
        for (let i = 1; i <= steps; i++) {
            const px = before[0] + ((x - before[0]) * i) / steps,
                py = before[1] + ((y - before[1]) * i) / steps;
            if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) {
                this.interrupted = true;
                break;
            }
            samples.push([px, py]);
        }
        for (const hit of this.options.hit(samples)) {
            if (!hit) {
                this.interrupted = true;
                break;
            }
            this.append(hit);
        }
        this.previous = [x, y];
    }
    private flush() {
        if (this.pending) {
            const [x, y] = this.pending;
            this.pending = undefined;
            this.consume(x, y);
        }
    }
    finish() {
        if (!this.active) return;
        let points: Vec3[] = [];
        try {
            this.flush();
            points = this.points;
        } finally {
            this.reset();
        }
        if (points.length > 1) this.options.commit(points);
    }
    cancel() {
        if (this.active) this.reset();
    }
    private reset() {
        const pointer = this.pointer;
        this.pointer = null;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.pending = undefined;
        this.points = [];
        this.previous = undefined;
        this.line.visible = false;
        this.line.geometry.setDrawRange(0, 0);
        const { canvas } = this.options;
        if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        canvas.style.cursor = this.cursor;
        this.options.active(false);
        this.options.invalidate();
    }
    dispose() {
        this.cancel();
        this.events.abort();
        this.line.removeFromParent();
        this.line.geometry.dispose();
        (this.line.material as LineBasicMaterial).dispose();
        (this.contrast.material as LineDashedMaterial).dispose();
    }
}

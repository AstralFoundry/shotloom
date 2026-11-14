import { freezeCamera } from '@/core/editor/camera-editing.ts';
import { pathDrawingPosition } from '@/core/editor/path-drawing-position.ts';
import { simplifyFreehand, timeFreehand } from '@/core/editor/freehand-path.ts';
import { workingElevation } from '@/core/building/floors.ts';
import { clone, type Vec3 } from '@/core/model.ts';
import { entityPosition } from '@/core/timeline.ts';
import { notifyError } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Motion-path drawing, waypoint editing and the draft transaction. */
export class PathCommands {
    constructor(private readonly host: EditorCommandHost) {}

    setPathDrawMode(mode: 'points' | 'freehand'): void {
        const state = useEditorStore.getState();
        if (state.pathDraft || this.host.history.pending) return;
        if (this.host.engine) this.host.engine.pathDrawMode = mode;
        this.host.patch({ pathDrawMode: mode });
    }

    setPathSurfaceMode(mode: 'surface' | 'ground'): void {
        const state = useEditorStore.getState();
        if (state.pathDraft || this.host.history.pending) return;
        if (this.host.engine) this.host.engine.pathSurfaceMode = mode;
        this.host.patch({ pathSurfaceMode: mode });
    }

    setPathDrawDuration(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds < 1 / this.host.project.fps) {
            notifyError('路线时长不能少于一帧');
            return;
        }
        const state = useEditorStore.getState();
        if (state.pathDraft || this.host.history.pending) return;
        if (this.host.engine) this.host.engine.pathDrawDuration = seconds;
        this.host.patch({ pathDrawDuration: seconds });
    }

    startPath(): void {
        const state = useEditorStore.getState();
        const engine = this.host.engine;
        if (state.busy || state.pathDraft || this.host.history.pending || !engine) return;
        const e = this.host.current();
        if (!e || e.locked) return;
        if (e.handBinding) {
            notifyError('手持道具请先解除绑定，再绘制独立路径');
            return;
        }
        this.host.patch({ playing: false });
        this.host.history.begin(this.host.project);
        if (e.camera && e.camera.mode !== 'free') freezeCamera(engine, e);
        e.path = {
            smooth: state.pathDrawMode === 'points' && state.pathSurfaceMode === 'ground',
            points: [{ time: this.host.clock, position: entityPosition(e, this.host.clock).toArray() as Vec3 }],
        };
        engine.drawingPath = true;
        engine.gizmo.detach();
        this.host.patch({
            pathDraft: e.id,
            selectedPoint: 0,
            selectedClipId: null,
            selectedPathSection: null,
            inspectorTab: 'path',
        });
        // Paths are drawn on the stage; only the camera-only view has to leave it, so a
        // split or picture-in-picture layout survives starting a draft.
        if (state.view === 'shot') this.host.setView('stage');
        engine.refreshHelpers();
    }

    addGroundPoint(position: Vec3): void {
        const state = useEditorStore.getState();
        if (!state.pathDraft) return;
        const e = this.host.project.entities.find((entity) => entity.id === state.pathDraft);
        if (!e?.path) return;
        let point = pathDrawingPosition(position, e, workingElevation(this.host.project));
        if (state.pathSurfaceMode === 'ground' && this.host.engine) point = this.host.engine.snapPosition(point);
        e.path.points.push({ time: e.path.points.at(-1)!.time + 2, position: point });
        this.host.patch({ selectedPoint: e.path.points.length - 1, revision: state.revision + 1 });
        this.host.engine?.refreshHelpers();
    }

    addFreehandStroke(points: Vec3[]): void {
        const state = useEditorStore.getState();
        if (!state.pathDraft) return;
        const e = this.host.project.entities.find((entity) => entity.id === state.pathDraft);
        if (!e?.path) return;
        try {
            const stroke = simplifyFreehand(points);
            e.path.points = timeFreehand(
                [...e.path.points.map((point) => point.position), ...stroke.slice(1)],
                e.path.points[0].time,
                state.pathDrawDuration,
            );
            e.path.smooth = false;
            this.host.patch({ selectedPoint: e.path.points.length - 1, revision: state.revision + 1 });
            this.host.engine?.refreshHelpers();
        } catch (error) {
            notifyError((error as Error).message);
        }
    }

    finishPath(): void {
        const state = useEditorStore.getState();
        if (!state.pathDraft) return;
        const engine = this.host.engine;
        engine?.endPathStroke();
        const e = this.host.project.entities.find((entity) => entity.id === state.pathDraft);
        if (!e?.path || e.path.points.length < 2) {
            this.cancelPath();
            notifyError('至少添加一个终点，才能形成路线');
            return;
        }
        this.host.patch({ pathDraft: null, selectedPoint: -1 });
        if (engine) engine.drawingPath = false;
        this.host.extendDuration();
        this.host.history.commit(this.host.project);
        this.host.changed(false);
        engine?.select(useEditorStore.getState().selected);
    }

    cancelPath(): void {
        const state = useEditorStore.getState();
        if (!state.pathDraft) return;
        const engine = this.host.engine;
        engine?.endPathStroke(true);
        const restored = this.host.history.rollback();
        const selected = this.host.history.restoredSelection ?? state.selected;
        this.host.patch({ project: restored ?? this.host.project, selected, pathDraft: null, selectedPoint: -1 });
        if (engine) {
            engine.drawingPath = false;
            engine.selected = selected;
            engine.rebuild(this.host.project);
        }
        this.host.changed(true);
    }

    clearPath(): void {
        const e = this.host.current();
        if (!e?.path) return;
        this.host.change(() => {
            e.position = entityPosition(e, this.host.clock).toArray() as Vec3;
            e.path = null;
        }, false);
        this.host.patch({ selectedPoint: -1, selectedPathSection: null });
    }

    selectPathPoint(index: number): void {
        const e = this.host.current();
        if (!e?.path) return;
        const next = Math.max(0, Math.min(e.path.points.length - 1, index));
        this.host.engine?.select(e.id, next);
        this.host.patch({ selectedPoint: next });
    }

    setPathPointTime(index: number, seconds: number): void {
        const e = this.host.current();
        if (!e?.path || e.locked || !Number.isFinite(seconds)) return;
        const points = e.path.points;
        const point = points[index];
        if (!point) return;
        const previous = points[index - 1]?.time ?? -Infinity;
        const next = points[index + 1]?.time ?? Infinity;
        if (seconds <= previous || seconds >= next) {
            notifyError('途经点时间需要落在前后两个点之间');
            return;
        }
        this.host.change(() => {
            point.time = Math.round(seconds * this.host.project.fps) / this.host.project.fps;
        }, false);
    }

    setPathPointPosition(index: number, axis: 0 | 1 | 2, value: number): void {
        const e = this.host.current();
        if (!e?.path || e.locked || !Number.isFinite(value)) return;
        const point = e.path.points[index];
        if (!point) return;
        this.host.change(() => {
            point.position[axis] = value;
        }, false);
    }

    appendPathPoint(): void {
        const e = this.host.current();
        if (!e?.path) return;
        const last = e.path.points.at(-1)!;
        this.host.change(() => {
            e.path!.points.push({
                ...clone(last),
                time: last.time + 2,
                position: [last.position[0] + 0.5, last.position[1], last.position[2]],
            });
            this.host.extendDuration();
        }, false);
        this.host.patch({ selectedPoint: e.path.points.length - 1 });
    }

    removePathPoint(index: number): void {
        const e = this.host.current();
        if (!e?.path) return;
        this.host.change(() => {
            e.path!.points.splice(index, 1);
            if (e.path!.points.length < 1) e.path = null;
        }, false);
        this.host.patch({ selectedPoint: -1, selectedPathSection: null });
    }

    holdPathPoint(): void {
        const e = this.host.current();
        if (!e?.path) return;
        const index = useEditorStore.getState().selectedPoint;
        const at = index >= 0 ? index : e.path.points.length - 1;
        this.host.change(() => {
            const point = e.path!.points[at];
            for (let i = at + 1; i < e.path!.points.length; i++) e.path!.points[i].time += 1;
            e.path!.points.splice(at + 1, 0, { ...clone(point), time: point.time + 1, position: [...point.position] });
            this.host.extendDuration();
        }, false);
        this.host.patch({ selectedPoint: at + 1 });
    }
}

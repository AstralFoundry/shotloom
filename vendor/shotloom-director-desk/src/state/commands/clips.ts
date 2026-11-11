import {
    deleteClip,
    dragClipRange,
    nextFreeStart,
    pathSections,
    splitClip,
    type TimelineSelection,
} from '@/core/clip-editing.ts';
import { actionDuration } from '@/core/animation/action-timing.ts';
import { assertProject, clone, type Cut, type Entity, type MotionPath } from '@/core/model.ts';
import { notifyError } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Action clips: selection, editing, splitting and timeline drag transactions. */
export class ClipCommands {
    private dragSnapshot: {
        selection: TimelineSelection;
        resize: boolean;
        clips?: Entity['clips'];
        path?: MotionPath | null;
        cuts?: Cut[];
        duration: number;
    } | null = null;

    constructor(private readonly host: EditorCommandHost) {}

    get timelineDragging(): boolean {
        return this.dragSnapshot !== null;
    }

    /**
     * Start a horizontal timeline drag. Core's `dragClipRange` always applies a delta to
     * the original range, so each pointer move replays it from this snapshot.
     */
    beginTimelineDrag(selection: TimelineSelection, resize: boolean): boolean {
        const state = useEditorStore.getState();
        if (state.busy || state.pathDraft || this.host.history.pending) return false;
        let e: Entity | undefined;
        if (selection.kind !== 'cut') {
            e = this.host.project.entities.find((item) => item.id === selection.entityId);
            if (!e) return false;
        }
        this.host.patch({ playing: false });
        this.host.history.begin(this.host.project);
        this.dragSnapshot = {
            selection,
            resize,
            clips: e ? clone(e.clips) : undefined,
            path: e ? clone(e.path) : undefined,
            cuts: selection.kind === 'cut' ? clone(this.host.project.cuts) : undefined,
            duration: this.host.project.duration,
        };
        return true;
    }

    updateTimelineDrag(deltaSeconds: number): void {
        const snapshot = this.dragSnapshot;
        if (!snapshot) return;
        const project = this.host.project;
        const selection = snapshot.selection;
        let e: Entity | undefined;
        if (selection.kind !== 'cut') {
            e = project.entities.find((item) => item.id === selection.entityId);
            if (!e) return;
        }
        if (e) {
            if (snapshot.clips) e.clips = clone(snapshot.clips);
            if (snapshot.path !== undefined) e.path = clone(snapshot.path);
        }
        if (snapshot.cuts) project.cuts = clone(snapshot.cuts);
        project.duration = snapshot.duration;
        try {
            // Cut drags can reorder shots; keep following the dragged shot's new index.
            snapshot.selection = dragClipRange(project, snapshot.selection, deltaSeconds, snapshot.resize);
        } catch (error) {
            notifyError((error as Error).message);
            return;
        }
        const engine = this.host.engine;
        if (engine) {
            engine.project = project;
            engine.sample(this.host.clock);
            engine.refreshHelpers();
        }
        this.host.patch({ revision: useEditorStore.getState().revision + 1 });
    }

    endTimelineDrag(): void {
        if (!this.dragSnapshot) return;
        this.dragSnapshot = null;
        try {
            assertProject(this.host.project);
            this.host.history.commit(this.host.project);
            this.host.changed(false);
        } catch (error) {
            this.cancelTimelineDrag();
            notifyError((error as Error).message);
        }
    }

    cancelTimelineDrag(): void {
        const snapshot = this.dragSnapshot;
        if (!snapshot) return;
        this.dragSnapshot = null;
        const restored = this.host.history.rollback();
        if (restored)
            this.host.patch({
                project: restored,
                selected: this.host.history.restoredSelection ?? useEditorStore.getState().selected,
            });
        if (this.host.engine) {
            this.host.engine.selected = useEditorStore.getState().selected;
            this.host.engine.rebuild(this.host.project);
        }
        this.host.changed(true);
    }

    selectClip(id: string | null): void {
        this.host.patch({ selectedClipId: id, selectedPathSection: null });
    }

    selectPathSection(entityId: string, index: number): void {
        const entity = this.host.project.entities.find((item) => item.id === entityId);
        if (!entity?.path || !pathSections(entity.path)[index]) return;
        this.host.patch({ selectedClipId: null, selectedPathSection: { entityId, index } });
    }

    removeSelectedPathSection(): boolean {
        const { selected, selectedPathSection } = useEditorStore.getState();
        if (!selectedPathSection) return false;
        const entity = this.host.project.entities.find((item) => item.id === selectedPathSection.entityId);
        if (selected !== entity?.id || !entity.path || !pathSections(entity.path)[selectedPathSection.index]) {
            this.host.patch({ selectedPathSection: null });
            return false;
        }
        if (entity.locked) return false;
        const removed = this.host.change(() => {
            deleteClip(this.host.project, { kind: 'path', ...selectedPathSection });
            // Dolly-zoom presets animate focal length alongside their motion path.
            if (!entity.path && entity.camera?.focalKeys) delete entity.camera.focalKeys;
        }, false);
        if (removed) this.host.patch({ selectedPathSection: null, selectedPoint: -1 });
        return removed;
    }

    /** Append an action clip at the first free slot at/after the playhead. */
    addAction(action: string): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        const fps = this.host.project.fps;
        const duration = Math.ceil(actionDuration(action) * fps - 1e-8) / fps;
        let created: string | null = null;
        this.host.change(() => {
            const start = nextFreeStart(e.clips, this.host.clock, duration);
            const clip = {
                id: crypto.randomUUID(),
                action: action as Entity['clips'][number]['action'],
                start,
                end: start + duration,
                speed: 1,
            };
            created = clip.id;
            e.clips.push(clip);
            e.clips.sort((a, b) => a.start - b.start);
            this.host.extendDuration();
        }, false);
        if (created) this.selectClip(created);
    }

    setClipField(id: string, patch: Partial<Pick<Entity['clips'][number], 'start' | 'end' | 'speed'>>): void {
        const e = this.host.current();
        const clip = e?.clips.find((item) => item.id === id);
        if (!e || !clip || e.locked) return;
        const start = patch.start ?? clip.start;
        const end = patch.end ?? clip.end;
        const speed = patch.speed ?? clip.speed;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1 / this.host.project.fps) {
            notifyError('片段结束时间必须晚于开始时间');
            return;
        }
        if (start < 0) return;
        if (!Number.isFinite(speed) || speed < 0.1 || speed > 5) {
            notifyError('动作速度需在 0.1 — 5 之间');
            return;
        }
        this.host.change(() => {
            clip.start = start;
            clip.end = end;
            clip.speed = speed;
            e.clips.sort((a, b) => a.start - b.start);
            this.host.extendDuration();
        }, false);
    }

    removeClip(id: string): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            e.clips = e.clips.filter((clip) => clip.id !== id);
        }, false);
        if (useEditorStore.getState().selectedClipId === id) this.host.patch({ selectedClipId: null });
    }

    /** Split the selected clip at the playhead. */
    splitSelectedClip(): void {
        const e = this.host.current();
        const id = useEditorStore.getState().selectedClipId ?? e?.clips[0]?.id;
        const clip = e?.clips.find((item) => item.id === id);
        if (!e || !clip || e.locked) return;
        if (this.host.clock <= clip.start + 1e-6 || this.host.clock >= clip.end - 1e-6) {
            notifyError('播放头需要落在片段内部才能分割');
            return;
        }
        let rightId: string | null = null;
        this.host.change(() => {
            const right = splitClip(
                this.host.project,
                { kind: 'action', entityId: e.id, id: clip.id },
                this.host.clock,
            );
            if (right.kind === 'action') rightId = right.id;
        }, false);
        if (rightId) this.host.patch({ selectedClipId: rightId });
    }

    setFootContact(value: boolean): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            e.footContact = value;
        }, false);
    }

    setActionBlend(value: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(value)) return;
        this.host.change(() => {
            e.actionBlend = Math.max(0, Math.min(2, value));
        }, false);
    }
}

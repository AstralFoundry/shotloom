import * as THREE from 'three';
import { Engine } from '@/core/engine.ts';
import { SceneWorkspace } from '@/core/scenes/scene-workspace.ts';
import { assertProject, clone, type CameraConfig, type Entity, type Joint, type Project, type Vec3 } from '@/core/model.ts';
import { entityPosition, shiftPath } from '@/core/timeline.ts';
import type { DraggableTimelineSelection } from '@/core/clip-editing.ts';
import { selectedEntities, setSelectedEntities } from '@/core/editor/timeline-selection.ts';
import { assertLockedEntitiesUnchanged } from '@/core/editor/invariants.ts';
import { recordPositionKey } from '@/core/editor/position-keys.ts';
import { runSpatialCheck } from '@/core/spatial/run-check.ts';
import { RenderLease } from '@/core/editor/render-lease.ts';
import type { SpatialIssue } from '@/core/spatial/checks.ts';
import { editBoundTransform } from '@/core/animation/hand-binding.ts';
import { freezeCamera } from '@/core/editor/camera-editing.ts';
import { bindNavigation } from '@/core/editor/navigation.ts';
import { setJointRotation } from '@/core/editor/joint-editing.ts';
import { RecoveryAutosave } from '@/core/editor/recovery-autosave.ts';
import { autosave, recoverSession } from '@/core/storage.ts';
import { prepareDocumentModels } from '@/core/scenes/document-models.ts';
import { createStarterProject } from './starter-project.ts';
import { readSceneDocument } from '@/core/scenes/sequence-project.ts';
import { type LightConfig, type LightingConfig } from '@/core/lighting/model.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useStageOverlayStore } from './stage-overlay-store.ts';
import { inspectorTabsFor } from './inspector-tabs.ts';
import {
    useEditorStore,
    type EditorPatch,
    type InspectorTab,
    type TransformMode,
    type ViewMode,
} from './editor-store.ts';
import { ClipCommands } from './commands/clips.ts';
import { EntityCommands } from './commands/entity.ts';
import { PathCommands } from './commands/path.ts';
import { PoseCommands } from './commands/pose.ts';
import { SceneCommands } from './commands/scene.ts';
import type { CameraPlacementId } from '@/core/cinematography/camera-placements.ts';
import type { CameraPresetId } from '@/core/cinematography/camera-presets.ts';
import { setEditorTheme } from '@/core/editor/theme-state.ts';
import { editorPreferences } from '@/core/editor/preferences.ts';
import type { FramingName } from './commands/scene.ts';
import { TimelineCommands } from './commands/timeline.ts';
import type { EditorCommandHost } from './commands/host.ts';
import { applyBatchEdits, type BatchEdit } from './batch-edits.ts';
import { DirectorCommandError } from '@/core/errors.ts';
import { checkUnsupported, toSpatialBox, type SpatialBox } from '@/core/spatial/checks.ts';

/** How often the session republishes the playhead to React while playing (ms). */
const UI_TIME_STEP = 50;

/**
 * Owns everything that is not React: the project, undo history, the three.js engine and
 * the editor commands that connect them. React components read the store and call these
 * methods; they never mutate the project or touch the engine directly.
 */
export class EditorSession {
    readonly history: SceneWorkspace;
    private engineRef: Engine | null = null;
    /** Exclusive access to the renderer for viewers that borrow a different point in time. */
    private lease: RenderLease | null = null;
    private transformError: Error | undefined;
    private cameraViewDragId: string | null = null;
    /** True while a parameter slider holds one open history transaction for its whole drag. */
    private continuousEdit = false;
    private clock = 0;
    /** 最近一次整体导入失败的原因；host-bridge 把它随回执一起交给宿主。 */
    lastSceneLoadError: DirectorCommandError | null = null;
    private lastUiSync = 0;
    private lastOverlaySync = 0;
    private lastOverlaySignature = '';
    private recoveryStarted = false;
    private recoveryAbort: AbortController | null = null;
    private navigation: ReturnType<typeof bindNavigation> | null = null;
    private readonly host: EditorCommandHost;
    private readonly timeline: TimelineCommands;
    private readonly clips: ClipCommands;
    private readonly pose: PoseCommands;
    private readonly path: PathCommands;
    private readonly scene: SceneCommands;
    private readonly entity: EntityCommands;
    private readonly autosave: RecoveryAutosave;

    constructor() {
        const project = useEditorStore.getState().project;

        this.history = new SceneWorkspace(project, () => {
            const state = useEditorStore.getState();
            return { time: state.time, selected: state.selected, preview: state.preview };
        });

        const session = this;
        this.host = {
            get project() {
                return useEditorStore.getState().project;
            },
            get engine() {
                return session.engineRef;
            },
            get history() {
                return session.history;
            },
            get clock() {
                return session.clock;
            },
            setClock(seconds: number) {
                session.clock = seconds;
            },
            current: () => this.current(),
            patch: (partial) => this.apply(partial),
            change: (fn, rebuild) => this.change(fn, rebuild),
            changed: (rebuild) => this.changed(rebuild),
            extendDuration: () => this.extendDuration(),
            setView: (view) => this.setView(view),
            finishPath: () => this.finishPath(),
            cancelPath: () => this.cancelPath(),
            selectEntity: (id, preserve) => this.selectEntity(id, preserve),
            seek: (seconds, defer) => this.seek(seconds, defer),
        };
        this.timeline = new TimelineCommands(this.host);
        this.clips = new ClipCommands(this.host);
        this.pose = new PoseCommands(this.host);
        this.path = new PathCommands(this.host);
        this.scene = new SceneCommands(this.host);
        this.entity = new EntityCommands(this.host);

        this.autosave = new RecoveryAutosave(
            (force) =>
                autosave(
                    () => {
                        const state = useEditorStore.getState();
                        const blocked = this.history.pending || this.engineRef?.dragging || (state.busy && !force);
                        return blocked ? null : this.history.document();
                    },
                    () => ({ path: this.history.filePath, dirty: this.history.dirty }),
                ),
            () => this.apply({ dirty: false, status: '自动备份已保存' }),
            (error) => {
                this.apply({ status: '自动备份失败' });
                notifyError(`自动备份失败：${(error as Error).message}。请检查浏览器是否禁用了本地存储或空间不足。`);
            },
        );
    }

    /**
     * Restore the last automatic backup once the engine is mounted. Any edit made while the
     * read is in flight wins: recovery only applies when the revision is untouched.
     */
    async restoreRecovery(): Promise<void> {
        if (window.parent !== window) return;
        if (this.recoveryStarted || !this.engineRef) return;
        this.recoveryStarted = true;
        const engine = this.engineRef;
        const controller = new AbortController();
        this.recoveryAbort = controller;
        const startedAt = useEditorStore.getState().revision;
        try {
            const restored = await recoverSession();
            if (!restored) return;
            const state = useEditorStore.getState();
            if (state.revision !== startedAt || state.busy || this.history.pending || state.pathDraft) return;
            await prepareDocumentModels(engine.externalModels, restored.document, controller.signal);
            if (this.engineRef !== engine || controller.signal.aborted) return;
            const current = useEditorStore.getState();
            if (current.revision !== startedAt || this.history.pending) {
                engine.externalModels.retain([this.project, ...this.history.undoStack, ...this.history.redoStack]);
                return;
            }
            const project = this.history.reset(restored.document);
            const selected = this.history.restoredSelection ?? project.entities[0]?.id ?? '';
            this.history.setFile(restored.file.path, !restored.file.dirty);
            this.clock = 0;
            this.apply({
                project,
                selected,
                time: 0,
                preview: 'program',
                dirty: this.history.dirty,
                status: this.history.dirty ? '自动备份已保存' : '项目已保存',
            });
            engine.selected = selected;
            this.changed(true);
            notifySuccess('已恢复上次工作');
        } catch (error) {
            if (!controller.signal.aborted && this.engineRef === engine)
                notifyError('未能读取自动恢复或模型资源，可以继续使用当前场景');
        } finally {
            if (this.recoveryAbort === controller) this.recoveryAbort = null;
        }
    }

    get project(): Project {
        return useEditorStore.getState().project;
    }

    /** The engine exists only while the stage viewport is mounted. */
    get engine(): Engine {
        if (!this.engineRef) throw new Error('三维引擎尚未挂载');
        return this.engineRef;
    }

    entityBounds(id: string): { size: Vec3; min: Vec3; max: Vec3 } | null {
        const box = this.engineRef?.localBounds(id);
        const entity = this.project.entities.find((item) => item.id === id);
        if (!box || !entity) return null;
        const localSize = box.getSize(new THREE.Vector3()).toArray() as Vec3;
        const rootScale = this.engineRef?.models.get(id)?.scale;
        return {
            size: localSize.map((value, axis) => value * (rootScale?.getComponent(axis) ?? 1)) as Vec3,
            min: box.min.toArray() as Vec3,
            max: box.max.toArray() as Vec3,
        };
    }

    get engineOrNull(): Engine | null {
        return this.engineRef;
    }

    current(): Entity | undefined {
        const { project, selected } = useEditorStore.getState();
        return project.entities.find((e) => e.id === selected);
    }

    private apply(partial: EditorPatch): void {
        useEditorStore.getState().patch(partial);
    }

    /* ------------------------------------------------------------------ */
    /* Engine lifecycle                                                    */
    /* ------------------------------------------------------------------ */

    attachEngine(stage: HTMLElement, shot: HTMLElement): void {
        if (this.engineRef) return;
        const engine = new Engine(this.project, stage, shot, {
            selection: () => selectedEntities(),
            select: (id) => this.selectEntity(id),
            point: (index) => {
                engine.select(useEditorStore.getState().selected, index);
                this.apply({ inspectorTab: 'path' });
            },
            ground: (point) => this.addGroundPoint(point),
            stroke: (points) => this.addFreehandStroke(points),
            joint: () => this.apply({ inspectorTab: 'pose', selectedJoint: engine.selectedJoint }),
            transformStart: () => this.beginTransform(),
            transform: (position, rotation, scale) => this.applyTransform(position, rotation, scale),
            transformEnd: (cancel) => this.endTransform(cancel),
            cameraViewStart: (cameraId) => this.beginCameraViewDrag(cameraId),
            cameraViewChange: (rotation) => this.updateCameraViewDrag(rotation),
            cameraViewEnd: (cancel) => this.endCameraViewDrag(cancel),
        });
        this.engineRef = engine;
        this.lease = new RenderLease(engine);
        engine.jointNodesVisible = useEditorStore.getState().inspectorTab === 'pose';
        // Restore persisted editing preferences before the first frame so a reload does not
        // silently reset snapping or render quality.
        const preferences = editorPreferences.current;
        engine.setPlacementSnap(preferences.placementSnap);
        engine.setObjectSnap(preferences.objectSnap);
        engine.setPreviewQuality(preferences.previewQuality);
        this.navigation = bindNavigation({
            get engine() {
                return engine;
            },
            get mode() {
                return useEditorStore.getState().view;
            },
            get busy() {
                return useEditorStore.getState().busy;
            },
            blocked: () =>
                Boolean(document.querySelector('.ant-modal')) ||
                Boolean(useEditorStore.getState().pathDraft) ||
                Boolean(useEditorStore.getState().busy),
        });
        engine.previewId = useEditorStore.getState().preview;
        engine.pathDrawMode = useEditorStore.getState().pathDrawMode;
        engine.pathSurfaceMode = useEditorStore.getState().pathSurfaceMode;
        engine.pathDrawDuration = useEditorStore.getState().pathDrawDuration;
        engine.onFrame = () => this.publishOverlay();
        engine.select(useEditorStore.getState().selected);
        this.apply({ engineReady: true });
        this.publishOverlay(true);
        void this.restoreRecovery();
    }

    detachEngine(): void {
        // A recovery read started on the previous mount must not publish into the next one.
        this.recoveryAbort?.abort();
        this.recoveryAbort = null;
        this.recoveryStarted = false;
        this.navigation?.dispose();
        this.navigation = null;
        this.engineRef?.dispose();
        this.engineRef = null;
        this.lastOverlaySignature = '';
        useStageOverlayStore.getState().patch({ labels: [], selected: '' });
        this.apply({ engineReady: false });
    }

    /**
     * Push projected object labels into the viewport overlay. Throttled to ~30 Hz and
     * skipped when the projection is pixel-identical, so idle scenes cost nothing.
     */
    private publishOverlay(force = false): void {
        const engine = this.engineRef;
        if (!engine) return;
        const now = performance.now();
        if (!force && now - this.lastOverlaySync < 33) return;
        this.lastOverlaySync = now;

        const labels = engine.getProjectedLabels();
        const signature = `${engine.selected}|${labels
            .map(
                (label) =>
                    `${label.id}:${label.name}:${label.color}:${Math.round(label.x)},${Math.round(label.y)},${label.visible ? 1 : 0}`,
            )
            .join(';')}`;
        if (signature === this.lastOverlaySignature) return;
        this.lastOverlaySignature = signature;
        useStageOverlayStore.getState().patch({ labels, selected: engine.selected });
    }

    /* ------------------------------------------------------------------ */
    /* Timeline                                                            */
    /* ------------------------------------------------------------------ */

    /** Advance and draw one animation frame. Called by the editor page's rAF loop. */
    frame(deltaSeconds: number, now: number): void {
        const engine = this.engineRef;
        if (!engine) return;
        const state = useEditorStore.getState();
        if (state.busy || engine.exporting) {
            engine.render(false);
            return;
        }

        let playing = state.playing;
        if (playing) {
            this.clock += deltaSeconds;
            if (this.clock >= this.project.duration) {
                if (state.loop && this.project.duration > 0) this.clock %= this.project.duration;
                else {
                    this.clock = this.project.duration;
                    playing = false;
                    this.apply({ playing: false });
                }
            }
        }

        this.navigation?.update(deltaSeconds);
        if (playing || this.clock !== engine.time || this.history.pending || engine.dragging) engine.sample(this.clock);
        engine.render(false);

        if (now - this.lastUiSync >= UI_TIME_STEP) {
            this.lastUiSync = now;
            if (Math.abs(state.time - this.clock) > 1e-4) this.apply({ time: this.clock });
        }
    }

    /* ------------------------------------------------------------------ */
    /* Selection & view                                                    */
    /* ------------------------------------------------------------------ */

    selectEntity(id: string, preserveTimelineSelection = false): void {
        if (useEditorStore.getState().pathDraft) this.finishPath();
        const project = this.project;
        const entity = project.entities.find((e) => e.id === id);
        if (!entity) return;
        if (!preserveTimelineSelection) setSelectedEntities([id]);

        const current = useEditorStore.getState().inspectorTab;
        const available = inspectorTabsFor(entity);
        let tab: InspectorTab = current;
        if (entity.light) tab = 'light';
        else if (entity.kind === 'camera') tab = 'camera';
        else if (!available.includes(current)) tab = 'base';

        this.apply({
            selected: id,
            inspectorTab: tab,
            selectedJoint: '',
            selectedClipId: null,
            selectedPathSection: null,
        });
        this.engineRef?.select(id);
    }

    selectScene(): void {
        if (useEditorStore.getState().pathDraft) this.finishPath();
        setSelectedEntities([]);
        this.apply({
            selected: '',
            inspectorTab: 'environment',
            selectedJoint: '',
            selectedClipId: null,
            selectedPathSection: null,
        });
        this.engineRef?.select('');
    }

    setView(view: ViewMode): void {
        this.apply({ view });
        this.engineRef?.requestResize();
    }

    setPreview(cameraId: string): void {
        this.apply({ preview: cameraId });
        if (this.engineRef) this.engineRef.previewId = cameraId;
    }

    setTransformMode(mode: TransformMode): void {
        this.engineRef?.setTransformMode(mode);
        this.apply({ transformMode: mode });
    }

    setInspectorTab(tab: InspectorTab): void {
        this.apply({ inspectorTab: tab });
        const engine = this.engineRef;
        if (engine) {
            engine.jointNodesVisible = tab === 'pose';
            engine.render();
        }
    }

    /* ------------------------------------------------------------------ */
    /* Transactions                                                        */
    /* ------------------------------------------------------------------ */

    change(fn: () => void, rebuild = true, throwOnError = false): boolean {
        if (useEditorStore.getState().busy) return false;
        // A slider drag holds one open transaction: apply each step live and let
        // endContinuousEdit commit a single undo entry for the whole gesture.
        if (this.continuousEdit) {
            try {
                fn();
                const engine = this.engineRef;
                if (engine) {
                    engine.project = this.project;
                    engine.sample(this.clock);
                    engine.refreshHelpers();
                }
                this.apply({ revision: useEditorStore.getState().revision + 1 });
                return true;
            } catch (error) {
                notifyError((error as Error).message);
                if (throwOnError) throw error;
                return false;
            }
        }
        if (this.history.pending) {
            notifyError('请先完成或取消当前拖动操作');
            return false;
        }
        this.apply({ playing: false });
        const project = this.project;
        this.history.begin(project);
        try {
            fn();
            if (this.project === project) assertLockedEntitiesUnchanged(this.history.pending!, project);
            assertProject(this.project);
            this.engineRef?.externalModels.assertReady(this.project);
            this.history.commit(this.project);
            this.changed(rebuild);
            return true;
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) this.apply({ project: restored });
            const selected = this.history.restoredSelection ?? useEditorStore.getState().selected;
            this.apply({ selected });
            if (this.engineRef) {
                this.engineRef.selected = selected;
                this.engineRef.rebuild(this.project);
            }
            this.changed(true);
            notifyError((error as Error).message);
            if (throwOnError) throw error;
            return false;
        }
    }

    /** Open one history transaction for a parameter-slider drag; each step applies live. */
    beginContinuousEdit(): boolean {
        const state = useEditorStore.getState();
        if (state.busy || state.pathDraft || this.history.pending || this.continuousEdit) return false;
        this.apply({ playing: false });
        this.history.begin(this.project);
        this.continuousEdit = true;
        return true;
    }

    /** Commit the drag as a single undoable change (or roll back if the result is invalid). */
    endContinuousEdit(): void {
        if (!this.continuousEdit) return;
        this.continuousEdit = false;
        try {
            assertLockedEntitiesUnchanged(this.history.pending!, this.project);
            assertProject(this.project);
            this.engineRef?.externalModels.assertReady(this.project);
            this.history.commit(this.project);
            this.changed(false);
        } catch (error) {
            this.rollbackContinuousEdit();
            notifyError((error as Error).message);
        }
    }

    cancelContinuousEdit(): void {
        if (!this.continuousEdit) return;
        this.continuousEdit = false;
        this.rollbackContinuousEdit();
    }

    private rollbackContinuousEdit(): void {
        const restored = this.history.rollback();
        if (restored) this.apply({ project: restored });
        const selected = this.history.restoredSelection ?? useEditorStore.getState().selected;
        this.apply({ selected });
        if (this.engineRef) {
            this.engineRef.selected = selected;
            this.engineRef.rebuild(this.project);
        }
        this.changed(true);
    }

    /** Validate all edits against a copy, then commit them as one undoable project change. */
    /**
     * @param validateOnly 按提交时的规则预检、不写入。失败时指出首个问题，
     * 调用方修正后可再次预检。
     */
    applyBatch(edits: BatchEdit[], expectedRevision: number, validateOnly = false) {
        const revision = useEditorStore.getState().revision;
        // 回报当前 revision 供调用方识别冲突；必须重新检查受影响实体后才能决定是否重试。
        if (!Number.isInteger(expectedRevision) || expectedRevision !== revision)
            throw new DirectorCommandError(`场景已变化：期望 revision=${expectedRevision}，当前 revision=${revision}`, {
                code: 'REVISION_MISMATCH',
                hint: '重新读取 snapshot，检查受影响实体与片段的当前值，再决定是否调整或重新提交；不要仅替换 expectedRevision 后原样重放',
                facts: { currentRevision: revision, expectedRevision },
            });
        if (useEditorStore.getState().busy || this.history.pending)
            throw new DirectorCommandError('批量修改未执行：导演台正在执行其他任务或有未完成的拖动', {
                code: 'BUSY',
                hint: '等待当前任务结束后重试；整批未写入',
                facts: { currentRevision: revision },
            });
        const draft = clone(this.project);
        const receipts = applyBatchEdits(draft, edits);
        assertLockedEntitiesUnchanged(this.project, draft);
        assertProject(draft);
        this.engineRef?.externalModels.assertReady(draft);
        if (validateOnly) {
            return {
                applied: false, valid: true, validatedOnly: true,
                count: receipts.length, operations: receipts, revision,
            };
        }
        let committedReceipts: ReturnType<typeof applyBatchEdits> = [];
        const applied = this.change(() => { committedReceipts = applyBatchEdits(this.project, edits); }, true, true);
        if (!applied) throw new DirectorCommandError('批量修改未提交：导演台正在执行其他任务或有未完成的拖动', {
            code: 'BUSY',
            hint: '等待当前任务结束后重试；整批未写入，无需回滚',
            facts: { currentRevision: useEditorStore.getState().revision },
        });
        const warnings = this.groundingWarnings(committedReceipts.flatMap((receipt) => receipt.entityId ? [receipt.entityId] : []));
        return {
            applied: true, count: committedReceipts.length, operations: committedReceipts, revision: useEditorStore.getState().revision,
            ...(warnings.length ? { warnings } : {}),
        };
    }

    /**
     * Standing props that ended up resting on nothing, measured on the live scene.
     *
     * Runs right after a commit, so a floating wall is reported in the same reply that placed it
     * instead of being noticed frames later — or, as happened, by the user. `subjectIds` limits the
     * report to what the caller just touched; omitted, every standing prop is judged.
     */
    groundingWarnings(subjectIds?: Iterable<string>): string[] {
        const engine = this.engineRef;
        if (!engine) return [];
        const only = subjectIds ? new Set(subjectIds) : null;
        const boxes: SpatialBox[] = [];
        const standing = new Set<string>();
        for (const entity of this.project.entities) {
            if (!entity.visible || entity.kind === 'camera' || entity.light) continue;
            const bounds = engine.worldBounds(entity.id);
            if (!bounds) continue;
            boxes.push(toSpatialBox(entity.id, entity.name, entity.kind, bounds, entity.kind === 'prop'));
            if (entity.kind === 'prop' && !entity.path && !entity.handBinding && (!only || only.has(entity.id)))
                standing.add(entity.id);
        }
        if (!standing.size) return [];
        const floating = checkUnsupported(boxes, standing, this.clock).map((issue) => {
            const entity = this.project.entities.find((item) => item.id === issue.ids[0])!;
            return `${issue.message}（position.y=${Number(entity.position[1].toFixed(3))}）。素材原点在底面中心：要落地就把 position.y 设为 0，架在别的物体上就让底面贴住它的顶面；有意悬空（吊挂、飞行物）可忽略。`;
        });
        const shown = 12;
        return floating.length > shown
            ? [...floating.slice(0, shown), `另有 ${floating.length - shown} 个物体同样悬空，可用 spatial_check 查看完整列表。`]
            : floating;
    }

    /** Re-publish editor state after a project mutation (or a rebuilt engine scene). */
    changed(rebuild = true): void {
        const project = this.project;
        const state = useEditorStore.getState();
        let selected = state.selected;
        if (!project.entities.some((e) => e.id === selected))
            selected = project.entities.find((e) => e.kind === 'actor')?.id ?? project.entities[0]?.id ?? '';

        const dirty = this.history.dirty;
        this.apply({
            revision: state.revision + 1,
            dirty,
            selected,
            status: dirty ? '正在自动备份…' : '项目已保存',
        });

        const engine = this.engineRef;
        if (engine) {
            engine.selected = selected;
            engine.previewId = state.preview;
            engine.project = project;
            if (rebuild) engine.rebuild(project);
            else {
                engine.project = project;
                engine.sample(this.clock);
                engine.refreshHelpers();
            }
            engine.select(selected, engine.selectedPoint);
            engine.externalModels.retain([project, ...this.history.undoStack, ...this.history.redoStack]);
        }
        if (window.parent === window) this.autosave.request();
    }

    undo(): void {
        if (useEditorStore.getState().pathDraft) {
            this.cancelPath();
            return;
        }
        this.apply({ playing: false });
        const project = this.history.undo(this.project);
        if (!project) return;
        this.apply({ project, selected: this.history.restoredSelection ?? useEditorStore.getState().selected });
        if (this.history.restoredView) {
            this.clock = this.history.restoredView.time;
            this.apply({ time: this.clock, preview: this.history.restoredView.preview });
        }
        this.changed();
    }

    redo(): void {
        this.apply({ playing: false });
        const project = this.history.redo(this.project);
        if (!project) return;
        this.apply({ project, selected: this.history.restoredSelection ?? useEditorStore.getState().selected });
        if (this.history.restoredView) {
            this.clock = this.history.restoredView.time;
            this.apply({ time: this.clock, preview: this.history.restoredView.preview });
        }
        this.changed();
    }

    /** Long-running work (export) that must pause the editor without touching history. */
    beginBusy(): void {
        this.apply({ playing: false, busy: true });
    }

    endBusy(): void {
        this.apply({ busy: false });
        this.changed(false);
    }

    /**
     * Toggle the busy flag without publishing a project change. Used by flows that stage
     * engine resources (model import) where `changed()` would prune unprepared sources.
     */
    setBusy(busy: boolean): void {
        this.apply({ busy });
    }

    /**
     * Exclusive renderer access for features that need a frame at another time or camera.
     *
     * Null until the engine is mounted, so callers must check before borrowing.
     */
    get renderLease(): RenderLease | null {
        return this.lease;
    }

    extendDuration(): void {
        const project = this.project;
        for (const e of project.entities) {
            project.duration = Math.max(
                project.duration,
                ...e.clips.map((c) => c.end),
                ...(e.path?.sections?.map((s) => s.end) ?? e.path?.points.map((p) => p.time) ?? []),
                ...e.poseKeys.map((k) => k.time),
                ...(e.rotationAnimation?.keys.map((k) => k.time) ?? []),
                ...(e.camera?.targetPath?.points.map((p) => p.time) ?? []),
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /* Timeline dragging                                                   */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Action clips                                                        */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Pose & joints                                                       */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Path drawing                                                        */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Entity & scene commands                                             */
    /* ------------------------------------------------------------------ */

    /** Reset this document to its default scene; history keeps the prior document undoable. */
    resetProject(): boolean {
        const state = useEditorStore.getState();
        const engine = this.engineRef;
        if (!engine) return false;
        if (state.busy || this.history.pending || state.pathDraft || engine.exporting) {
            notifyError('请先完成当前编辑或导出');
            return false;
        }
        try {
            const document = readSceneDocument(createStarterProject());
            document.projectId = this.history.projectId;
            document.name = this.history.document().name;
            const project = this.history.replace(document, this.history.context, '重置项目', true);
            const selected =
                project.entities.find((entity) => entity.kind === 'actor')?.id ?? project.entities[0]?.id ?? '';
            this.clock = 0;
            this.apply({
                project,
                selected,
                time: 0,
                preview: 'program',
                playing: false,
                selectedClipId: null,
                selectedPathSection: null,
                selectedPoint: -1,
                selectedJoint: '',
                inspectorTab: 'base',
                sidebarTab: 'scene',
                query: '',
            });
            engine.selected = selected;
            this.changed(true);
            engine.viewHome();
            notifySuccess('项目已重置');
            return true;
        } catch (error) {
            notifyError((error as Error).message);
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Command facade                                                      */
    /* ------------------------------------------------------------------ */

    seek(seconds: number, deferSample = false): void {
        this.timeline.seek(seconds, deferSample);
    }

    togglePlay(): void {
        this.timeline.togglePlay();
    }

    stepFrame(direction: 1 | -1): void {
        this.timeline.stepFrame(direction);
    }

    setLoop(loop: boolean): void {
        this.timeline.setLoop(loop);
    }

    addCutAtPlayhead(): void {
        this.timeline.addCutAtPlayhead();
    }

    removeCut(index: number): void {
        this.timeline.removeCut(index);
    }

    setDuration(seconds: number): void {
        this.timeline.setDuration(seconds);
    }

    get timelineDragging(): boolean {
        return this.clips.timelineDragging;
    }

    beginTimelineDrag(selection: DraggableTimelineSelection, resize: boolean): boolean {
        return this.clips.beginTimelineDrag(selection, resize);
    }

    updateTimelineDrag(deltaSeconds: number): void {
        this.clips.updateTimelineDrag(deltaSeconds);
    }

    endTimelineDrag(): void {
        this.clips.endTimelineDrag();
    }

    cancelTimelineDrag(): void {
        this.clips.cancelTimelineDrag();
    }

    selectClip(id: string | null): void {
        this.clips.selectClip(id);
    }

    selectPathSection(entityId: string, index: number): void {
        this.clips.selectPathSection(entityId, index);
    }

    removeSelectedPathSection(): boolean {
        return this.clips.removeSelectedPathSection();
    }

    addAction(action: string): void {
        this.clips.addAction(action);
    }

    /**
     * 声明式写入一条运动路径。
     *
     * 编辑器里的 `start_path` → `add_path_point` → `finish_path` 依赖当前选区和播放头，
     * 点时间会按默认时长重排，Agent 无法声明"这段路在 0—24 秒走完"；这条命令把
     * 关键时点交给调用方，并通过同一套批量校验保证一次撤销。
     */
    setEntityPath(input: { entityId: string; points: { position: unknown; timeSec: unknown }[]; smooth?: boolean }) {
        const revision = useEditorStore.getState().revision;
        return this.applyBatch([{
            operation: 'set_path',
            entityId: input.entityId,
            points: input.points,
            ...(input.smooth === undefined ? {} : { smooth: input.smooth }),
        }], revision);
    }

    setClipField(id: string, patch: Partial<Pick<Entity['clips'][number], 'start' | 'end' | 'speed' | 'blendIn'>>): void {
        this.clips.setClipField(id, patch);
    }

    removeClip(id: string): void {
        this.clips.removeClip(id);
    }

    splitSelectedClip(): void {
        this.clips.splitSelectedClip();
    }

    setFootContact(value: boolean): void {
        this.clips.setFootContact(value);
    }

    setActionBlend(value: number): void {
        this.clips.setActionBlend(value);
    }

    selectJoint(joint: Joint | ''): void {
        this.pose.selectJoint(joint);
    }

    setJointNodesVisible(visible: boolean): void {
        this.pose.setJointNodesVisible(visible);
    }

    setJointAngle(joint: Joint, axis: 0 | 1 | 2, degrees: number): void {
        this.pose.setJointAngle(joint, axis, degrees);
    }

    resetPose(): void {
        this.pose.resetPose();
    }

    mirrorPose(): void {
        this.pose.mirrorPose();
    }

    recordPoseKey(): void {
        this.pose.recordPoseKey();
    }

    seekPoseKey(index: number): void {
        this.pose.seekPoseKey(index);
    }

    deletePoseKey(index: number): void {
        this.pose.deletePoseKey(index);
    }

    jointState(entity: Entity): { joints: Array<[string, string]>; angles: [number, number, number] } {
        return this.pose.jointState(entity);
    }

    setPathDrawMode(mode: 'points' | 'freehand'): void {
        this.path.setPathDrawMode(mode);
    }

    setPathSurfaceMode(mode: 'surface' | 'ground'): void {
        this.path.setPathSurfaceMode(mode);
    }

    setPathDrawDuration(seconds: number): void {
        this.path.setPathDrawDuration(seconds);
    }

    startPath(): void {
        this.path.startPath();
    }

    addGroundPoint(position: Vec3): void {
        this.path.addGroundPoint(position);
    }

    addFreehandStroke(points: Vec3[]): void {
        this.path.addFreehandStroke(points);
    }

    finishPath(): void {
        this.path.finishPath();
    }

    cancelPath(): void {
        this.path.cancelPath();
    }

    clearPath(): void {
        this.path.clearPath();
    }

    selectPathPoint(index: number): void {
        this.path.selectPathPoint(index);
    }

    setPathPointTime(index: number, seconds: number): void {
        this.path.setPathPointTime(index, seconds);
    }

    setPathPointPosition(index: number, axis: 0 | 1 | 2, value: number): void {
        this.path.setPathPointPosition(index, axis, value);
    }

    appendPathPoint(): void {
        this.path.appendPathPoint();
    }

    removePathPoint(index: number): void {
        this.path.removePathPoint(index);
    }

    /** Record the selected entity's current position as a waypoint key at the playhead. */
    recordPositionKeyAtPlayhead(): boolean {
        return this.entity.recordPositionKeyAtPlayhead();
    }

    recordRotationKeyAtPlayhead(): boolean {
        return this.entity.recordRotationKeyAtPlayhead();
    }

    setRotationKeyAxis(index: number, axis: 0 | 1 | 2, degrees: number): void {
        this.entity.setRotationKeyAxis(index, axis, degrees);
    }

    setRotationPivotAxis(axis: 0 | 1 | 2, value: number): void {
        this.entity.setRotationPivotAxis(axis, value);
    }

    removeRotationKey(index: number): void {
        this.entity.removeRotationKey(index);
    }

    clearRotationAnimation(): void {
        this.entity.clearRotationAnimation();
    }

    /** Record the selected camera's focal length at the playhead. */
    recordFocalKeyAtPlayhead(): boolean {
        return this.scene.recordFocalKeyAtPlayhead();
    }

    /** Remove one focal key; dropping to a single key restores a fixed lens. */
    removeFocalKey(index: number): boolean {
        return this.scene.removeFocalKey(index);
    }

    holdPathPoint(): void {
        this.path.holdPathPoint();
    }

    addAsset(assetId: string) {
        return this.scene.addAsset(assetId);
    }

    addCamera(fromView = false): void {
        this.scene.addCamera(fromView);
    }

    addCameraPlacement(presetId: CameraPlacementId): boolean {
        return this.scene.addCameraPlacement(presetId);
    }

    snapshot(size?: [number, number]): Promise<void> {
        return this.scene.snapshot(size);
    }

    renderPreview(input: { seconds?: number; cameraId?: string; size?: number }) {
        return this.scene.renderPreview(input);
    }

    renderPreviewSheet(input: { timesSec: number[]; cameraId?: string }) {
        return this.scene.renderPreviewSheet(input);
    }

    renderPlan(input: Parameters<SceneCommands['renderPlan']>[0]) {
        return this.scene.renderPlan(input);
    }

    compareReference(input: Parameters<SceneCommands['compareReference']>[0]) {
        return this.scene.compareReference(input);
    }

    applyCampath(source: string, options: Parameters<SceneCommands['applyCampath']>[1] = {}) {
        return this.scene.applyCampath(source, options);
    }

    inspectModel(input: { id?: string; views?: string[] }) {
        return this.scene.inspectModel(input);
    }

    exportShot(span: { index: number; cameraId: string; start: number; end: number }): Promise<void> {
        return this.scene.exportShot(span);
    }

    /**
     * Run the spatial check and return the findings as data.
     *
     * The panel renders a report for a person; the host Agent needs the same evidence as
     * structure so it can decide what to fix without parsing prose. Both go through the same
     * sampler, so they can never disagree about what is wrong.
     */
    async runSpatialCheck(
        input: {
            start?: number;
            end?: number;
            sampleRate?: number;
            subjectIds?: string[];
            cameraId?: string;
            includeObstacles?: boolean;
            includeFraming?: boolean;
        },
        signal?: AbortSignal,
        progress?: (fraction: number) => void,
    ): Promise<{ issues: SpatialIssue[]; truncated: boolean; samples: number; range: { start: number; end: number } }> {
        const engine = this.engineOrNull;
        const lease = this.lease;
        if (!engine || !lease) throw Error('导演台画布尚未准备好');
        if (useEditorStore.getState().busy || engine.exporting) throw Error('导演台正在执行其他任务，请稍后重试');
        const start = input.start === undefined ? 0 : input.start;
        const end = input.end === undefined ? this.project.duration : input.end;
        const controller = new AbortController();
        // A caller-supplied signal (the panel's Cancel button, or a host timeout) aborts this run
        // and nothing else; with no signal the sweep simply runs to completion.
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const result = await runSpatialCheck(
            engine,
            this.project,
            {
                start,
                end,
                subjectIds: input.subjectIds,
                sampleRate: input.sampleRate === undefined ? 4 : input.sampleRate,
                cameraId: input.cameraId ?? 'program',
                includeObstacles: input.includeObstacles !== false,
                includeFraming: input.includeFraming !== false,
            },
            controller.signal,
            progress ?? (() => undefined),
            lease,
        ).finally(() => signal?.removeEventListener('abort', onAbort));
        return { ...result, range: { start, end } };
    }

    updateProjectSettings(patch: { name?: string; aspect?: string; fps?: number }): boolean {
        return this.scene.updateProjectSettings(patch);
    }

    applyFraming(name: FramingName, cameraId?: string): boolean {
        return this.scene.applyFraming(name, cameraId);
    }

    updateRoom(patch: Partial<Project['room']>): boolean {
        return this.scene.updateRoom(patch);
    }

    setLightingField(patch: Partial<LightingConfig>): void {
        this.scene.setLightingField(patch);
    }

    setCameraField(patch: Partial<CameraConfig>): void {
        this.scene.setCameraField(patch);
    }

    applyCameraPreset(id: CameraPresetId, cameraId?: string, options: { subjectId?: string; foregroundId?: string } = {}): boolean {
        return this.scene.applyCameraPreset(id, cameraId, options);
    }

    toggleGrid(): void {
        this.scene.toggleGrid();
    }

    /**
     * Switch the desk theme.
     *
     * The 3D viewports read their colours from the theme tokens at build time, so a theme
     * change has to rebuild the helper geometry (floor, grid) and repaint the background.
     * The scene graph itself is untouched, so this stays cheap and keeps undo history intact.
     */
    setTheme(value: 'light' | 'dark', persist = true): void {
        setEditorTheme(value, persist);
        const engine = this.engineRef;
        if (engine) {
            engine.rebuild(this.project);
            // The light theme swaps the ground for a temporary floor that lives on the scene.
            // `rebuild` alone would leave the previous theme's floor in place, so the helpers are
            // rebuilt too — that is what creates and disposes the theme-specific floor.
            engine.refreshHelpers();
            engine.requestResize();
        }
    }

    /** Grid snap step in metres (0 disables it). Applies to the move gizmo and dragged props. */
    setPlacementSnap(step: number): void {
        editorPreferences.set('placementSnap', step);
        this.engineRef?.setPlacementSnap(step);
    }

    /** Snap a dragged prop to nearby object surfaces and boundaries. */
    setObjectSnap(enabled: boolean): void {
        editorPreferences.set('objectSnap', enabled);
        this.engineRef?.setObjectSnap(enabled);
    }

    /** Draft quality lowers the viewport pixel ratio; useful on integrated GPUs. */
    setPreviewQuality(value: 'full' | 'draft'): void {
        editorPreferences.set('previewQuality', value);
        const engine = this.engineRef;
        if (!engine) return;
        engine.setPreviewQuality(value);
        engine.requestResize();
    }

    /** Object label density over the stage. */
    setLabelMode(value: 'off' | 'selected' | 'all'): void {
        editorPreferences.set('labelMode', value);
        // Labels are projected during the frame loop; force one overlay refresh now so the
        // change is visible without waiting for the next pointer move.
        this.engineRef?.refreshHelpers();
        this.changed(false);
    }

    /**
     * Ask the host to detach the reference backdrop edge.
     *
     * The desk never owns canvas edges, so removal is a request: the host removes the edge and
     * pushes a fresh panorama (or a clear) back. Returns false when no host is connected, which
     * lets the caller still clear the local preview.
     */
    requestBackdropRemoval(edgeId: string): boolean {
        if (!this.backdropRemoval) return false;
        this.backdropRemoval(edgeId);
        return true;
    }

    /** Registered once by the host bridge; undefined when running standalone. */
    private backdropRemoval: ((edgeId: string) => void) | null = null;

    registerBackdropRemoval(handler: ((edgeId: string) => void) | null): void {
        this.backdropRemoval = handler;
    }

    /** Commit a whole-document scene change and project its active scene into the editor. */
    replaceSceneDocument(document: ReturnType<SceneWorkspace['document']>, label: string): boolean {
        const state = useEditorStore.getState();
        if (state.busy || this.history.pending || state.pathDraft || this.engineRef?.exporting) return false;
        this.history.replace(document, this.history.context, label);
        const project = this.history.project();
        const view = this.history.restoredView;
        this.clock = view?.time ?? 0;
        this.apply({
            project,
            time: this.clock,
            selected: view?.selected ?? project.entities[0]?.id ?? '',
            preview: view?.preview ?? 'program',
            playing: false,
            selectedClipId: null,
            selectedPathSection: null,
            selectedPoint: -1,
            selectedJoint: '',
        });
        this.changed(true);
        return true;
    }

    /**
     * The whole document, ready to hand to another desk instance.
     *
     * The workspace view and the canvas node each keep their own copy of a scene; without an
     * explicit hand-off a scene built in one is invisible in the other.
     */
    exportSceneDocument(): unknown {
        return this.history.document();
    }

    /**
     * Replace the whole document with one produced by `exportSceneDocument`.
     *
     * Refuses while an edit or an export is in flight: replacing the document mid-transaction
     * would strand the open history entry.
     */
    importSceneDocument(document: unknown, label = '载入外部场景'): boolean {
        const state = useEditorStore.getState();
        // "不能现在载入"有四种完全不同的原因，把它们都说成 false 会让调用方盲重试：
        // 之前有过因为路径草稿没结束，连续六次整体导入全部失败且没有任何线索。
        const blocked = state.busy ? '导演台正在执行其他任务'
            : this.history.pending ? '有未提交的拖动操作'
            : state.pathDraft ? '正在绘制路径'
            : this.engineRef?.exporting ? '正在导出' : '';
        if (blocked) {
            this.lastSceneLoadError = new DirectorCommandError(`无法载入场景：${blocked}`, {
                hint: state.pathDraft ? '先在界面上取消正在绘制的路径（cancel_path），再重新导入'
                    : '等待当前任务结束后重试；不要重复提交同一份文档',
            });
            notifyError(this.lastSceneLoadError.message);
            return false;
        }
        try {
            const project = this.history.reset(document);
            const selected = this.history.restoredSelection ?? project.entities[0]?.id ?? '';
            this.clock = 0;
            this.apply({
                project,
                selected,
                time: 0,
                preview: 'program',
                playing: false,
                selectedClipId: null,
                selectedPathSection: null,
                selectedPoint: -1,
                selectedJoint: '',
            });
            this.changed(true);
            this.lastSceneLoadError = null;
            notifySuccess(`${label}：${project.name}`);
            return true;
        } catch (error) {
            this.lastSceneLoadError = new DirectorCommandError(`无法载入场景：${(error as Error).message}`, {
                hint: '文档结构不合法；先用 export_scene 取当前工程的真实结构再对照修改',
            });
            notifyError(this.lastSceneLoadError.message);
            return false;
        }
    }

    /** Summary the host can show on a node card without opening the desk. */
    sceneSummary(): { actors: number; cameras: number; shots: number; duration: number } {
        const project = this.project;
        return {
            actors: project.entities.filter((entity) => entity.kind === 'actor' || entity.kind === 'crowd').length,
            cameras: project.entities.filter((entity) => entity.kind === 'camera').length,
            shots: Math.max(project.cuts.length, 1),
            duration: project.duration,
        };
    }

    viewHome(): void {
        this.scene.viewHome();
    }

    viewTop(): void {
        this.scene.viewTop();
    }

    focusSelected(): void {
        this.scene.focusSelected();
    }

    renameEntity(name: string): void {
        this.entity.renameEntity(name);
    }

    duplicateSelected(): void {
        this.entity.duplicateSelected();
    }

    deleteSelected(replacementCamera?: string): boolean {
        return this.entity.deleteSelected(replacementCamera);
    }

    groundSelected(): void {
        this.entity.groundSelected();
    }

    setEntityColor(color: string): void {
        this.entity.setEntityColor(color);
    }

    setEntityFlag(key: 'visible' | 'locked', value: boolean): void {
        this.entity.setEntityFlag(key, value);
    }

    setPositionAxis(axis: 0 | 1 | 2, value: number): void {
        this.entity.setPositionAxis(axis, value);
    }

    setRotationAxis(axis: 0 | 1 | 2, degrees: number): void {
        this.entity.setRotationAxis(axis, degrees);
    }

    setScaleAxis(axis: 0 | 1 | 2, value: number): void {
        this.entity.setScaleAxis(axis, value);
    }

    setDimensionAxis(axis: 0 | 1 | 2, metres: number): void {
        this.entity.setDimensionAxis(axis, metres);
    }

    setHeight(value: number): void {
        this.entity.setHeight(value);
    }

    setEntityOption(key: 'build' | 'gender', value: string): void {
        this.entity.setEntityOption(key, value);
    }

    setLightField(patch: Partial<LightConfig>): void {
        this.entity.setLightField(patch);
    }

    /* ------------------------------------------------------------------ */
    /* three.js transform bridge                                           */
    /* ------------------------------------------------------------------ */

    private beginCameraViewDrag(cameraId: string): boolean {
        const camera = this.project.entities.find((entity) => entity.id === cameraId && entity.kind === 'camera');
        const engine = this.engineRef;
        if (!camera?.camera || camera.locked || !engine || this.history.pending || useEditorStore.getState().busy)
            return false;
        this.apply({ playing: false });
        this.history.begin(this.project);
        if (camera.camera.mode !== 'free') freezeCamera(engine, camera);
        else {
            const live = engine.getShotCamera(cameraId);
            camera.rotation = [live.rotation.x, live.rotation.y, live.rotation.z];
            camera.camera.aim = 'manual';
        }
        this.cameraViewDragId = cameraId;
        this.selectEntity(cameraId);
        return true;
    }

    private updateCameraViewDrag(rotation: Vec3): void {
        if (!this.cameraViewDragId) return;
        const camera = this.project.entities.find((entity) => entity.id === this.cameraViewDragId);
        if (!camera?.camera) return;
        camera.rotation = rotation;
        this.engineRef?.sample(this.clock);
        this.engineRef?.refreshHelpers();
    }

    private endCameraViewDrag(cancel = false): void {
        if (!this.cameraViewDragId) return;
        this.cameraViewDragId = null;
        try {
            if (cancel) throw new Error('已取消机位调整');
            assertLockedEntitiesUnchanged(this.history.pending!, this.project);
            assertProject(this.project);
            this.history.commit(this.project);
            this.changed(false);
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) this.apply({ project: restored, selected: this.history.restoredSelection ?? '' });
            this.changed(true);
            if (!cancel) notifyError((error as Error).message);
        }
    }

    private beginTransform(): void {
        this.transformError = undefined;
        this.apply({ playing: false });
        this.history.begin(this.project);
        const e = this.current();
        if (e?.camera && e.camera.mode !== 'free') freezeCamera(this.engine, e);
    }

    private applyTransform(position: Vec3, rotation: Vec3, scale: Vec3): void {
        const engine = this.engineRef;
        const e = this.current();
        if (!engine || !e || this.transformError) return;

        if (engine.selectedJoint) {
            const angles = engine.jointRotation(rotation);
            if (angles) setJointRotation(e, engine.selectedJoint as Joint, angles, this.clock, this.project.fps);
            engine.sample(this.clock);
            return;
        }
        if (e.handBinding && engine.gizmo.getMode() !== 'scale') {
            editBoundTransform(
                e,
                engine.handFrame(e.handBinding),
                engine.gizmo.getMode() === 'translate' ? position : undefined,
                engine.gizmo.getMode() === 'rotate' ? rotation : undefined,
            );
        } else if (engine.positionKeying && engine.gizmo.getMode() === 'translate') {
            try {
                recordPositionKey(e, this.clock, position, this.project.fps);
                this.extendDuration();
            } catch (error) {
                this.transformError = error as Error;
                engine.syncProxy();
                return;
            }
            engine.proxy.position.fromArray(position);
        } else if (engine.selectedPoint >= 0 && e.path) e.path.points[engine.selectedPoint].position = position;
        else if (engine.gizmo.getMode() === 'translate') {
            const snapped = engine.snapObjectPosition(e.id, position, engine.gizmo.axis ?? 'XYZ');
            const origin = entityPosition(e, this.clock);
            shiftPath(e, new THREE.Vector3(...snapped).sub(origin));
            engine.proxy.position.fromArray(snapped);
        } else if (engine.gizmo.getMode() === 'rotate') e.rotation = rotation;
        else e.scale = scale.map((v) => Math.max(0.05, v)) as Vec3;

        engine.sample(this.clock);
        engine.refreshHelpers();
    }

    private endTransform(cancel = false): void {
        const engine = this.engineRef;
        try {
            if (cancel || this.transformError) throw this.transformError ?? new Error('已取消拖动');
            assertLockedEntitiesUnchanged(this.history.pending!, this.project);
            assertProject(this.project);
            this.history.commit(this.project);
            this.changed(false);
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) {
                this.apply({
                    project: restored,
                    selected: this.history.restoredSelection ?? useEditorStore.getState().selected,
                });
            }
            if (engine) {
                engine.selected = useEditorStore.getState().selected;
                engine.rebuild(this.project);
            }
            this.changed(true);
            if (!cancel) notifyError((error as Error).message);
        } finally {
            this.transformError = undefined;
        }
    }
}

/** Single session for the application shell. */
export const session = new EditorSession();

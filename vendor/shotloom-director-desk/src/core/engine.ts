import { SceneEffects } from './editor/scene-effects.ts';
import { editorPreferences as effectPreferences } from './editor/preferences.ts';
import { SceneLighting } from './lighting/runtime.ts';
import { DEFAULT_SHOT_BACKGROUND } from './lighting/model.ts';
import { installWallTransmission, isWallEntity } from './lighting/wall-transmission.ts';
import { fitFeetToSurface } from './editor/foot-contact.ts';
import { SceneRenderCache } from './editor/scene-render-cache.ts';
import { FreehandPathInput } from './editor/freehand-path-input.ts';
import { memberSample } from './navigation/member-paths.ts';
import { pathDrawingPosition } from './editor/path-drawing-position.ts';
import { cameraLookAt } from './animation/camera-look.ts';
import { applyEntityRotation } from './animation/entity-rotation.ts';
import { numberAt } from './animation/channels.ts';
import { InitialPoseRuntime } from './scenes/initial-pose-runtime.ts';
import { inheritedPoseAt } from './scenes/initial-pose.ts';
import { shotEntityVisible } from './scenes/camera-visibility.ts';
import { editorEntityVisible, workingElevation } from './building/floors.ts';
import { ContactMarker } from './editor/contact-marker.ts';
import { applyHandBinding, type HandBinding } from './animation/hand-binding.ts';
import { builtinHandFrame } from './animation/hand-frame.ts';
import { footSurfaceQuery } from './animation/contact-surfaces.ts';
import { transitionGroundingAt } from './animation/transition-plan.ts';
import { SceneModels } from './resources/scene-models.ts';
import { isExternalModel } from './resources/project-resources.ts';
import { makeCrowd } from './assets/crowd.ts';
import { makeEditorCamera } from './assets/editor-camera.ts';
import * as T from 'three';
import { localObjectBounds, objectBounds, findObjectSnap, surfaceDropPosition, type SnapBounds } from './editor/object-snapping.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Rig } from './assets.ts';
import { animateHuman, disposeTree, makeProp, makeRoom } from './assets.ts';
import { scaleHuman, colorHuman } from './assets/humanoid.ts';
import { makeActor, animateActor } from './assets/actors.ts';
import { applyHumanPose } from './assets/human-animation.ts';
import { crowdAnimationPhase } from './resources/retarget-animation.ts';
import type { Entity, Project, Vec3 } from './model.ts';
import { aspectNumber } from './model.ts';
import { activeCameraId, entityPosition, entityYaw, sampledAction, pathPosition } from './timeline.ts';
import { JointNodes, humanJointNode } from './editor/joint-nodes.ts';
import { jointAngles } from './assets/joint-schema.ts';
import type { Joint } from './model.ts';
import { samplePose } from './timeline.ts';
import { isAnimalAsset } from './asset-catalog.ts';
import { getEditorTheme, themeColor } from './editor/theme-state.ts';
import { editorPreferences } from './editor/preferences.ts';
import type { PlanFraming } from './editor/plan-view.ts';
export function configureCamera(camera: T.PerspectiveCamera, focal: number, aspect: number) {
    camera.aspect = aspect;
    camera.filmGauge = 36;
    camera.setFocalLength(focal);
    camera.near = 0.025;
    camera.far = 2000;
    camera.updateProjectionMatrix();
}
interface Callbacks {
    select: (id: string) => void;
    joint?: (joint: Joint) => void;
    selection?: () => string[];
    point: (index: number) => void;
    ground: (point: Vec3) => void;
    stroke?: (points: Vec3[]) => void;
    transformStart: () => void;
    transform: (position: Vec3, rotation: Vec3, scale: Vec3) => void;
    transformEnd: (cancel?: boolean) => void;
    cameraViewStart: (cameraId: string) => boolean;
    cameraViewChange: (rotation: Vec3) => void;
    cameraViewEnd: (cancel?: boolean) => void;
}
/** The viewport and exported shot use the same theme colours for the default scene. */
const vpToken = (name: string) => themeColor(name);

export class Engine {
    /** Backdrop pushed by the embedding host; shown only in the shot view. */
    private hostPanorama: T.Texture | null = null;

    setHostPanorama(texture: T.Texture | null) {
        this.hostPanorama = texture;
        this.render();
    }

    async prepareOutput(time: number, signal?: AbortSignal) {
        this.sample(time);
        signal?.throwIfAborted();
    }
    private lighting: SceneLighting;
    private renderCache = new SceneRenderCache();
    private roomKey = '';
    private initialPoses = new InitialPoseRuntime();
    externalModels = new SceneModels();
    scene = new T.Scene();
    editorCamera = new T.PerspectiveCamera(45, 1, 0.03, 2000);
    editorRenderer: T.WebGLRenderer;
    shotRenderer: T.WebGLRenderer;
    orbit: OrbitControls;
    gizmo: TransformControls;
    models = new Map<string, T.Group>();
    rigs = new Map<string, Rig>();
    cameras = new Map<string, T.PerspectiveCamera>();
    crowdRigs = new Map<string, Rig[]>();
    walls = new Map<string, T.Group>();
    roomGroup = new T.Group();
    helpers = new T.Group();
    pathHelpers = new T.Group();
    get selectionIds(): string[] {
        const ids = this.cb.selection?.() ?? [];
        if (ids.length < 2) return ids;
        const existing = new Set(this.project.entities.map((e) => e.id));
        return ids.filter((id) => existing.has(id));
    }
    cameraVisuals = new Map<string, T.Group>();
    proxy = new T.Group();
    selected = '';
    selectedPoint = -1;
    selectedJoint: Joint | '' = '';
    jointNodesVisible = false;
    readonly jointNodes = new JointNodes();
    private previousTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';
    private jointBase?: T.Quaternion;
    private jointOwner = '';
    drawingPath = false;
    pathDrawMode: 'points' | 'freehand' = 'points';
    pathDrawDuration = 5;
    private freehandInput: FreehandPathInput;
    get drawingStroke() {
        return this.freehandInput?.active ?? false;
    }
    endPathStroke(cancel = false) {
        if (cancel) this.freehandInput.cancel();
        else this.freehandInput.finish();
    }
    positionKeying = false;
    dragging = false;
    pickingEnabled = true;
    gridVisible = true;
    private cameraMarkerBounds = new T.Box3();
    private lightGroundPreview = false;
    private lightShotFloor: T.Mesh | null = null;
    placementSnap = 0;
    objectSnapEnabled = false;
    objectSnapTarget = '';
    pathSurfaceMode: 'surface' | 'ground' = 'surface';
    private snapTargets: SnapBounds[] | null = null;
    private contactMarker = new ContactMarker();
    showContactAnchor(entityId = '', anchorId = '') {
        this.needsRender = true;
        this.contactMarker.show(entityId, anchorId, this.helpers);
        this.contactMarker.update(this.project.entities, this.models);
    }
    handFrame(binding: Pick<HandBinding, 'actorId' | 'hand'>) {
        const actor = this.project.entities.find((e) => e.id === binding.actorId);
        if (!actor) throw Error('绑定人物已不存在');
        return actor.external
            ? this.externalModels.handFrame(actor, binding.hand)
            : builtinHandFrame(actor, this.rigs.get(actor.id)!, binding.hand);
    }
    project: Project;
    time = 0;
    previewId = 'program';
    onFrame = () => {};
    selectionBox: T.BoxHelper | null = null;
    disposed = false;
    exporting = false;
    monochrome = false;
    previewQuality: 'full' | 'draft' = 'full';
    setPreviewQuality(value: 'full' | 'draft') {
        this.previewQuality = value;
        this.resizeNeeded = true;
        this.sample(this.time);
        this.render();
    }
    private cb: Callbacks;
    private pointerDown = [0, 0];
    private stage: HTMLElement;
    private shot: HTMLElement;
    private resizeObserver: ResizeObserver;
    private resizeNeeded = true;
    private needsRender = true;
    private renderedView = '';
    private events = new AbortController();
    constructor(project: Project, stage: HTMLElement, shot: HTMLElement, callbacks: Callbacks) {
        this.project = project;
        this.stage = stage;
        this.shot = shot;
        this.cb = callbacks;
        this.scene.background = new T.Color(DEFAULT_SHOT_BACKGROUND);
        this.lighting = new SceneLighting(this.scene);
        this.editorRenderer = this.renderer();
        this.shotRenderer = this.renderer();
        stage.append(this.editorRenderer.domElement);
        shot.append(this.shotRenderer.domElement);
        this.editorRenderer.domElement.setAttribute('aria-label', '三维布景视图');
        this.shotRenderer.domElement.setAttribute('aria-label', '摄影机真实取景');
        this.editorCamera.position.set(7, 5.9, 7);
        this.editorCamera.layers.enable(1);
        this.orbit = new OrbitControls(this.editorCamera, this.editorRenderer.domElement);
        this.orbit.addEventListener('change', () => {
            this.needsRender = true;
        });
        this.orbit.target.set(0, 0.85, 0);
        this.orbit.enableDamping = true;
        this.orbit.minDistance = 0.3;
        this.orbit.maxDistance = 100;
        this.orbit.maxPolarAngle = Math.PI * 0.49;
        this.orbit.update();
        this.scene.add(this.helpers, this.pathHelpers, this.proxy, this.jointNodes.root);
        this.gizmo = new TransformControls(this.editorCamera, this.editorRenderer.domElement);
        this.gizmo.addEventListener('change', () => {
            this.needsRender = true;
        });
        this.gizmo.setSize(0.78);
        const helper = this.gizmo.getHelper();
        helper.traverse((o) => o.layers.set(1));
        this.gizmo.getRaycaster().layers.enable(1);
        this.scene.add(helper);
        this.gizmo.addEventListener('mouseDown', () => {
            this.captureJointBase();
            this.dragging = true;
            this.orbit.enabled = false;
            this.objectSnapTarget = '';
            this.snapTargets = null;
            this.cb.transformStart();
        });
        this.gizmo.addEventListener('objectChange', () => {
            if (this.dragging)
                this.cb.transform(
                    this.proxy.position.toArray() as Vec3,
                    [this.proxy.rotation.x, this.proxy.rotation.y, this.proxy.rotation.z],
                    this.proxy.scale.toArray() as Vec3,
                );
        });
        this.gizmo.addEventListener('mouseUp', () => this.finishTransform());
        const canvas = this.editorRenderer.domElement;
        const signal = this.events.signal;
        let orbitBefore = { enabled: true, damping: true };
        this.freehandInput = new FreehandPathInput({
            canvas,
            enabled: () =>
                this.drawingPath && this.pathDrawMode === 'freehand' && this.pickingEnabled && !!this.cb.stroke,
            start: () => [...this.project.entities.find((e) => e.id === this.selected)!.path!.points.at(-1)!.position],
            hit: (samples) => {
                if (!samples.length) return [];
                const rect = canvas.getBoundingClientRect(),
                    ray = new T.Raycaster();
                this.prepareView(true);
                try {
                    const surfaces = this.pathSurfaces();
                    const e = this.project.entities.find((e) => e.id === this.selected)!;
                    return samples.map(([x, y]) => {
                        ray.setFromCamera(
                            new T.Vector2(
                                ((x - rect.left) / rect.width) * 2 - 1,
                                (-(y - rect.top) / rect.height) * 2 + 1,
                            ),
                            this.editorCamera,
                        );
                        const hit = this.pathPointFromRay(ray, surfaces);
                        if (!hit) return null;
                        const point = pathDrawingPosition(hit, e, workingElevation(this.project));
                        return this.pathSurfaceMode === 'ground' ? this.snapPosition(point) : point;
                    });
                } finally {
                    this.prepareView(false);
                }
            },
            commit: (points) => this.cb.stroke?.(points),
            active: (value) => {
                if (value) {
                    orbitBefore = { enabled: this.orbit.enabled, damping: this.orbit.enableDamping };
                    this.orbit.enabled = false;
                    this.orbit.enableDamping = false;
                    this.orbit.update();
                } else {
                    this.orbit.enabled = orbitBefore.enabled;
                    this.orbit.enableDamping = orbitBefore.damping;
                }
            },
            invalidate: () => {
                this.needsRender = true;
            },
        });
        this.scene.add(this.freehandInput.line);
        canvas.addEventListener('pointercancel', () => this.finishTransform(true), { signal });
        window.addEventListener('blur', () => this.finishTransform(true), { signal });
        document.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Escape' && this.dragging) {
                    event.preventDefault();
                    this.finishTransform(true);
                }
            },
            { capture: true, signal },
        );
        canvas.addEventListener('pointerdown', (e) => (this.pointerDown = [e.clientX, e.clientY]), { signal });
        canvas.addEventListener('pointerup', (e) => this.pick(e), { signal });
        const shotCanvas = this.shotRenderer.domElement;
        let viewDrag: {
            pointerId: number;
            cameraId: string;
            x: number;
            y: number;
            rotation: Vec3;
            active: boolean;
        } | null = null;
        const finishViewDrag = (cancel = false) => {
            if (!viewDrag) return;
            if (viewDrag.active) this.cb.cameraViewEnd(cancel);
            if (shotCanvas.hasPointerCapture(viewDrag.pointerId)) shotCanvas.releasePointerCapture(viewDrag.pointerId);
            viewDrag = null;
            shotCanvas.style.cursor = '';
        };
        shotCanvas.addEventListener(
            'pointerdown',
            (event) => {
                if (event.button !== 0) return;
                const entity = this.cameraEntity();
                if (entity.locked) return;
                const camera = this.getShotCamera(entity.id);
                viewDrag = {
                    pointerId: event.pointerId,
                    cameraId: entity.id,
                    x: event.clientX,
                    y: event.clientY,
                    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
                    active: false,
                };
                shotCanvas.setPointerCapture(event.pointerId);
            },
            { signal },
        );
        shotCanvas.addEventListener(
            'pointermove',
            (event) => {
                const drag = viewDrag;
                if (!drag || event.pointerId !== drag.pointerId) return;
                const dx = event.clientX - drag.x;
                const dy = event.clientY - drag.y;
                if (!drag.active) {
                    if (Math.hypot(dx, dy) < 3) return;
                    if (!this.cb.cameraViewStart(drag.cameraId)) {
                        finishViewDrag();
                        return;
                    }
                    drag.active = true;
                    shotCanvas.style.cursor = 'grabbing';
                }
                this.cb.cameraViewChange([
                    Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, drag.rotation[0] - dy * 0.005)),
                    drag.rotation[1] - dx * 0.005,
                    drag.rotation[2],
                ]);
            },
            { signal },
        );
        shotCanvas.addEventListener(
            'pointerup',
            (event) => {
                if (viewDrag?.pointerId === event.pointerId) finishViewDrag();
            },
            { signal },
        );
        shotCanvas.addEventListener(
            'pointercancel',
            (event) => {
                if (viewDrag?.pointerId === event.pointerId) finishViewDrag(true);
            },
            { signal },
        );
        window.addEventListener('blur', () => finishViewDrag(true), { signal });
        canvas.addEventListener(
            'dblclick',
            () => {
                if (this.pickingEnabled && !this.drawingPath) this.focus(this.selected);
            },
            { signal },
        );
        this.resizeObserver = new ResizeObserver(() => (this.resizeNeeded = true));
        this.resizeObserver.observe(stage);
        this.resizeObserver.observe(shot);
        this.rebuild(project);
    }
    private renderer() {
        // Centimetre-scale close-ups and kilometre-scale stage views share these
        // renderers. Linear depth loses millimetre-separated floor surfaces when
        // the camera pulls back, producing moving stripes / mosaic patches.
        const r = new T.WebGLRenderer({
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            logarithmicDepthBuffer: true,
        });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        r.shadowMap.enabled = true;
        r.shadowMap.type = T.PCFSoftShadowMap;
        r.outputColorSpace = T.SRGBColorSpace;
        r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        return r;
    }
    rebuild(project: Project) {
        this.freehandInput?.cancel();
        this.externalModels.assertReady(project);
        this.gizmo.detach();
        const changes = this.renderCache.reconcile(project.entities, this.models.keys());
        for (const id of changes.removed) {
            const external = this.externalModels.removeInstance(
                id,
                this.crowdRigs.get(id)?.map((_, i) => `${id}:${i}`),
            );
            const root = this.models.get(id);
            if (root && !external) disposeTree(root);
            this.models.delete(id);
            this.rigs.delete(id);
            this.crowdRigs.delete(id);
            this.cameras.delete(id);
            this.cameraVisuals.delete(id);
            this.initialPoses.remove(id);
        }
        this.project = project;
        const roomKey = JSON.stringify(project.room);
        if (roomKey !== this.roomKey) {
            disposeTree(this.roomGroup);
            const room = makeRoom(project);
            this.roomGroup = room.group;
            this.walls = room.walls;
            this.walls.forEach((wall) => installWallTransmission(wall));
            this.scene.add(this.roomGroup);
            this.roomKey = roomKey;
        }
        try {
            for (const e of changes.added) {
                let root: T.Group;
                if (isExternalModel(e)) root = this.externalModels.create(e);
                else if (e.kind === 'actor') {
                    const r = makeActor(e);
                    root = r.root;
                    this.rigs.set(e.id, r);
                    this.externalModels.registerHuman(e, r);
                } else if (e.kind === 'crowd') {
                    const crowd = makeCrowd(e);
                    root = crowd.root;
                    crowd.rigs.forEach((rig, i) => this.externalModels.registerHuman(e, rig, `${e.id}:${i}`));
                    this.crowdRigs.set(e.id, crowd.rigs);
                } else if (e.kind === 'camera') {
                    root = makeEditorCamera();
                    const cam = new T.PerspectiveCamera();
                    this.cameras.set(e.id, cam);
                    this.cameraVisuals.set(e.id, root);
                } else root = makeProp(e);
                root.traverse((o) => (o.userData.entityId = e.id));
                if (isWallEntity(e)) installWallTransmission(root);
                this.models.set(e.id, root);
                this.initialPoses.register(e, root);
                this.scene.add(root);
            }
            changes.commit();
        } catch (error) {
            this.renderCache.invalidate();
            throw error;
        }
        this.select(this.selected, this.selectedPoint);
        this.sample(this.time);
        this.resizeNeeded = true;
    }
    private finishTransform(cancel = false) {
        if (!this.dragging) return;
        this.dragging = false;
        this.gizmo.dragging = false;
        this.orbit.enabled = true;
        this.snapTargets = null;
        this.cb.transformEnd(cancel);
    }
    sample(time: number) {
        this.needsRender = true;
        this.time = time;
        for (const e of this.project.entities) {
            const root = this.models.get(e.id)!;
            this.initialPoses.restore(e);
            root.visible = e.visible;
            root.position.copy(entityPosition(e, time));
            root.rotation.set(
                e.rotation[0],
                e.kind === 'actor' || e.kind === 'crowd' ? entityYaw(e, time, this.project) : e.rotation[1],
                e.rotation[2],
            );
            if (isExternalModel(e)) this.externalModels.sample(e, this.monochrome, time);
            else if (e.kind === 'actor') {
                const r = this.rigs.get(e.id)!;
                scaleHuman(r, e);
                if (this.externalModels.sampleHuman(e, time)) applyHumanPose(r, e, time);
                else animateActor(r, e, time);
                colorHuman(r, this.monochrome ? '#d9dcd7' : e.color);
            } else {
                root.scale.fromArray(e.scale);
                if (e.kind === 'crowd')
                    this.crowdRigs.get(e.id)?.forEach((r, i) => {
                        const phase = crowdAnimationPhase(e.seed, i);
                        if (this.externalModels.sampleHuman(e, time, `${e.id}:${i}`, phase)) applyHumanPose(r, e, time);
                        else animateHuman(r, e, time, phase);
                        colorHuman(r, this.monochrome ? '#d9dcd7' : e.color);
                        if (e.memberPaths || r.root.userData.navigation) {
                            const member = memberSample(e, i, time);
                            if (e.memberPaths && !member.moving) animateHuman(r, { ...e, clips: [] }, time, phase);
                            r.root.position.copy(member.position);
                            r.root.rotation.y = member.yaw;
                            r.root.userData.navigation = !!e.memberPaths;
                        }
                    });
            }
            if (!e.handBinding) applyEntityRotation(root, e, time);
        }
        this.scene.updateMatrixWorld(true);
        for (const e of this.project.entities)
            if (this.initialPoses.apply(e, time)) {
                const rig = this.rigs.get(e.id);
                if (rig) applyHumanPose(rig, e, time);
                this.crowdRigs.get(e.id)?.forEach((r) => applyHumanPose(r, e, time));
            }
        const grounded = this.project.entities.filter(
            (e) => e.visible && !inheritedPoseAt(e, time) && transitionGroundingAt(e, time),
        );
        if (grounded.length) {
            const surfaces = this.project.entities
                .filter((e) => e.kind === 'prop' && !e.light && e.visible && !e.handBinding)
                .map((e) => this.models.get(e.id)!);
            if (this.project.room.enabled) surfaces.push(this.roomGroup);
            const query = footSurfaceQuery(surfaces);
            for (const e of grounded) {
                const root = this.models.get(e.id)!;
                const samplePose =
                    (id: string, rig?: Rig, phase = 0) =>
                    (entity: Entity, at: number) => {
                        root.position.copy(entityPosition(entity, at));
                        root.rotation.set(entity.rotation[0], entityYaw(entity, at, this.project), entity.rotation[2]);
                        if (entity.external) this.externalModels.sample(entity, this.monochrome, at);
                        else if (rig) {
                            if (this.externalModels.sampleHuman(entity, at, id, phase)) applyHumanPose(rig, entity, at);
                            else animateHuman(rig, entity, at, phase);
                        }
                        applyEntityRotation(root, entity, at);
                        root.updateWorldMatrix(true, true);
                        root.updateMatrixWorld(true);
                    };
                if (e.kind === 'crowd')
                    this.crowdRigs.get(e.id)?.forEach((rig, i) => {
                        const id = `${e.id}:${i}`,
                            phase = crowdAnimationPhase(e.seed, i);
                        this.externalModels.groundHuman(e, time, query, id, samplePose(id, rig, phase), phase);
                    });
                else this.externalModels.groundHuman(e, time, query, e.id, samplePose(e.id, this.rigs.get(e.id)));
            }
        }
        const contactActors = this.project.entities.filter(
            (e) =>
                e.kind === 'actor' &&
                e.visible &&
                !inheritedPoseAt(e, time) &&
                (e.footContact === true ||
                    (e.footContact !== false && !e.external && !isAnimalAsset(e.asset) && sampledAction(e, time).action === 'run')) &&
                ['idle', 'walk', 'run', 'wave', 'point', 'turn'].includes(sampledAction(e, time).action),
        );
        if (contactActors.length) {
            const surfaces = this.project.entities
                .filter((e) => e.kind === 'prop' && !e.light && e.visible && !e.handBinding)
                .map((e) => this.models.get(e.id)!);
            if (this.project.room.enabled) surfaces.push(this.roomGroup);
            const ray = new T.Raycaster();
            ray.ray.direction.set(0, -1, 0);
            ray.far = 2;
            const surface = (x: number, y: number, z: number) => {
                ray.ray.origin.set(x, y, z);
                const hit = ray
                    .intersectObjects(surfaces, true)
                    .find((h) => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.5);
                return hit?.point.y ?? (y >= 0 && y <= 2 ? 0 : null);
            };
            contactActors.forEach((e) => fitFeetToSurface(this.rigs.get(e.id)!, surface));
        }
        this.scene.updateMatrixWorld(true);
        this.time = time;
        for (const e of this.project.entities)
            if (e.handBinding) {
                const root = this.models.get(e.id)!;
                applyHandBinding(root, e.handBinding, this.handFrame(e.handBinding));
                applyEntityRotation(root, e, time);
                root.updateWorldMatrix(true, true);
                root.visible =
                    e.visible && !!this.project.entities.find((a) => a.id === e.handBinding!.actorId)?.visible;
            }
        this.contactMarker.update(this.project.entities, this.models);
        this.lighting.sample(this.scene, this.project.lighting, this.project.entities, this.models, time, [
            this.editorRenderer,
            this.shotRenderer,
        ]);
        for (const e of this.project.entities.filter((x) => x.kind === 'camera')) {
            const c = e.camera!,
                camera = this.cameras.get(e.id)!;
            camera.position.copy(entityPosition(e, time));
            const target = c.targetId ? this.project.entities.find((x) => x.id === c.targetId) : null;
            if ((c.mode === 'follow' || c.mode === 'pov') && target) {
                const targetRoot = this.models.get(target.id)!;
                const offset = new T.Vector3(...c.offset);
                if (c.mode === 'pov') {
                    const rig = this.rigs.get(target.id);
                    if (rig && c.inheritRotation) {
                        offset.y -= rig.headRestHeight ?? 1.53;
                        camera.position.copy(rig.head.localToWorld(offset));
                        const q = rig.head.getWorldQuaternion(new T.Quaternion());
                        camera.lookAt(camera.position.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(q)));
                    } else {
                        camera.position.copy(targetRoot.localToWorld(offset));
                        const q = targetRoot.getWorldQuaternion(new T.Quaternion());
                        camera.lookAt(camera.position.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(q)));
                    }
                } else {
                    if (c.inheritRotation) offset.applyAxisAngle(new T.Vector3(0, 1, 0), targetRoot.rotation.y);
                    camera.position.copy(targetRoot.position).add(offset);
                    camera.lookAt(this.targetPosition(e));
                }
            } else if (c.aim === 'manual') camera.rotation.set(...e.rotation);
            else camera.lookAt(this.targetPosition(e));
            applyEntityRotation(camera, e, time);
            configureCamera(
                camera,
                c.focalKeys ? numberAt({ keys: c.focalKeys }, time) : c.focal,
                aspectNumber(this.project.aspect),
            );
            camera.updateMatrixWorld(true);
            const visual = this.cameraVisuals.get(e.id)!;
            visual.position.copy(camera.position);
            visual.quaternion.copy(camera.quaternion);
            visual.visible = e.visible;
        }
        if (!this.dragging) this.syncProxy();
        this.selectionBox?.update();
    }
    targetPosition(e: Entity) {
        const c = e.camera!;
        if (c.targetPath) return cameraLookAt(c.targetPath, this.time);
        const target = this.project.entities.find((x) => x.id === c.targetId);
        return target
            ? (this.models.get(target.id)?.position.clone() ?? entityPosition(target, this.time)).add(
                  new T.Vector3(0, c.targetHeight, 0),
              )
            : new T.Vector3(...c.target);
    }
    cameraEntity(id = this.previewId) {
        const realId = id === 'program' ? activeCameraId(this.project, this.time) : id;
        return (
            this.project.entities.find((e) => e.id === realId && e.kind === 'camera') ??
            this.project.entities.find((e) => e.kind === 'camera')!
        );
    }
    getShotCamera(id = this.previewId) {
        return this.cameras.get(this.cameraEntity(id).id)!;
    }
    /**
     * World-space bounds of one entity's model, or null when it has no geometry.
     *
     * Spatial checks run against the live scene rather than re-deriving poses from JSON, so
     * imported models, foot contact and action blending are all accounted for. The caller must
     * have sampled the requested time first.
     */
    worldBounds(id: string): T.Box3 | null {
        const model = this.models.get(id);
        if (!model) return null;
        model.updateWorldMatrix(true, true);
        const box = new T.Box3().setFromObject(model);
        return box.isEmpty() ? null : box;
    }
    localBounds(id: string): T.Box3 | null {
        const model = this.models.get(id);
        return model ? localObjectBounds(model) : null;
    }
    /** Camera currently rendering the shot view for `id`. */
    shotCameraFor(id = this.previewId) {
        return this.getShotCamera(id);
    }
    select(id: string, point = -1) {
        if (this.selectedJoint && (id !== this.jointOwner || point >= 0)) this.selectJoint('');
        this.selected = id;
        this.selectedPoint = point;
        this.setPlacementSnap(this.placementSnap);
        this.refreshHelpers();
        this.syncProxy();
        const e = this.project.entities.find((e) => e.id === id);
        if (e && !e.locked && !this.drawingPath && editorEntityVisible(this.project, e) && !this.jointEditingBlocked())
            this.gizmo.attach(this.proxy);
        else this.gizmo.detach();
    }
    private jointEditingBlocked() {
        return false;
    }
    selectJoint(joint: Joint | '') {
        const rig = this.rigs.get(this.selected),
            entity = this.project.entities.find((e) => e.id === this.selected);
        if (
            joint &&
            (!rig ||
                !entity ||
                entity.kind !== 'actor' ||
                entity.external ||
                isAnimalAsset(entity.asset) ||
                !humanJointNode(rig, joint))
        )
            return;
        if (!this.selectedJoint && joint) this.previousTransformMode = this.gizmo.getMode();
        this.selectedJoint = joint;
        this.jointOwner = joint ? this.selected : '';
        this.jointNodes.select(joint);
        this.gizmo.setMode(joint ? 'rotate' : this.previousTransformMode);
        this.gizmo.setSpace(joint ? 'local' : 'world');
        this.jointBase = undefined;
        this.syncProxy();
        this.needsRender = true;
        const e = this.project.entities.find((e) => e.id === this.selected);
        if (e && !e.locked && !this.jointEditingBlocked()) this.gizmo.attach(this.proxy);
        else this.gizmo.detach();
    }
    private captureJointBase() {
        const rig = this.rigs.get(this.selected),
            e = this.project.entities.find((e) => e.id === this.selected);
        if (!rig || !e || !this.selectedJoint) {
            this.jointBase = undefined;
            return;
        }
        const bone = humanJointNode(rig, this.selectedJoint);
        if (!bone) return;
        const angles = jointAngles(samplePose(e, this.time)[this.selectedJoint], this.selectedJoint).map(
            T.MathUtils.degToRad,
        );
        const base = new T.Euler().setFromQuaternion(bone.quaternion);
        base.x -= angles[0];
        base.y -= angles[1];
        base.z -= angles[2];
        this.jointBase = new T.Quaternion().setFromEuler(base);
    }
    jointRotation(worldRotation: Vec3): Vec3 | undefined {
        const rig = this.rigs.get(this.selected);
        if (!rig || !this.selectedJoint || !this.jointBase) return;
        const bone = humanJointNode(rig, this.selectedJoint),
            desired = new T.Quaternion().setFromEuler(new T.Euler(...worldRotation));
        if (bone.parent) desired.premultiply(bone.parent.getWorldQuaternion(new T.Quaternion()).invert());
        const current = new T.Euler().setFromQuaternion(desired),
            base = new T.Euler().setFromQuaternion(this.jointBase);
        return [current.x - base.x, current.y - base.y, current.z - base.z].map(T.MathUtils.radToDeg) as Vec3;
    }
    syncProxy() {
        if (this.dragging) return;
        const e = this.project.entities.find((x) => x.id === this.selected);
        if (!e) return;
        if (this.selectedJoint) {
            const rig = this.rigs.get(e.id),
                bone = rig && humanJointNode(rig, this.selectedJoint);
            if (!bone || e.kind !== 'actor' || e.external || isAnimalAsset(e.asset)) {
                this.selectJoint('');
                return;
            }
            if (e.locked || this.drawingPath || !editorEntityVisible(this.project, e) || this.jointEditingBlocked())
                this.gizmo.detach();
            else if (this.gizmo.object !== this.proxy) this.gizmo.attach(this.proxy);
            bone.getWorldPosition(this.proxy.position);
            bone.getWorldQuaternion(this.proxy.quaternion);
            this.proxy.scale.set(1, 1, 1);
            return;
        }
        const selection = this.selectionIds;
        if (selection.length > 1 && this.selectedPoint < 0) {
            const group = selection
                .map((id) => this.project.entities.find((e) => e.id === id))
                .filter(Boolean) as Entity[];
            const pivot = group
                .reduce((sum, e) => sum.add(new T.Vector3(...entityPosition(e, this.time))), new T.Vector3())
                .multiplyScalar(1 / Math.max(1, group.length));
            this.proxy.position.copy(pivot);
            this.proxy.rotation.set(0, 0, 0);
            this.proxy.scale.set(1, 1, 1);
            return;
        }
        const point = this.selectedPoint >= 0 ? e.path?.points[this.selectedPoint] : null;
        if (!point) this.selectedPoint = -1;
        this.proxy.position.copy(point ? new T.Vector3(...point.position) : entityPosition(e, this.time));
        this.proxy.rotation.fromArray([e.rotation[0], e.rotation[1], e.rotation[2], 'XYZ']);
        this.proxy.scale.fromArray(point ? [1, 1, 1] : e.scale);
        if (e.handBinding) {
            const root = this.models.get(e.id)!;
            this.proxy.position.copy(root.position);
            this.proxy.quaternion.copy(root.quaternion);
        }
        if (e.kind === 'camera' && !point) this.proxy.position.copy(this.cameras.get(e.id)!.position);
    }
    setTransformMode(mode: 'translate' | 'rotate' | 'scale') {
        if (this.selectedJoint) this.selectJoint('');
        this.previousTransformMode = mode;
        this.gizmo.setMode(mode);
        this.gizmo.showY = true;
        this.gizmo.showX = true;
        this.gizmo.showZ = true;
    }
    setPlacementSnap(step: number) {
        this.placementSnap = step;
        const prop = this.project.entities.find((e) => e.id === this.selected)?.kind === 'prop';
        this.gizmo.setTranslationSnap(this.objectSnapEnabled && prop && this.selectedPoint < 0 ? null : step || null);
        this.gizmo.setRotationSnap(step ? T.MathUtils.degToRad(15) : null);
    }
    setObjectSnap(enabled: boolean) {
        this.objectSnapEnabled = enabled;
        this.objectSnapTarget = '';
        this.snapTargets = null;
        this.setPlacementSnap(this.placementSnap);
    }
    snapPosition(position: Vec3): Vec3 {
        return this.placementSnap
            ? (position.map((v) => Math.round(v / this.placementSnap) * this.placementSnap) as Vec3)
            : [...position];
    }
    private collectSnapTargets(exclude: string) {
        const targets: SnapBounds[] = [];
        for (const entity of this.project.entities) {
            if (
                entity.id === exclude ||
                entity.kind !== 'prop' ||
                entity.light ||
                !editorEntityVisible(this.project, entity)
            )
                continue;
            const root = this.models.get(entity.id);
            const bounds = root ? objectBounds(root, entity.id, entity.name) : null;
            if (bounds) targets.push(bounds);
        }
        if (this.project.room.enabled) {
            const names: Record<string, string> = {
                north: '北墙',
                south: '南墙',
                east: '东墙',
                west: '西墙',
                ceiling: '天花板',
            };
            for (const [side, wall] of this.walls) {
                const bounds = objectBounds(wall, 'room-' + side, names[side]);
                if (bounds) targets.push(bounds);
            }
            const floor = this.roomGroup.children.find((o) => o instanceof T.Mesh);
            if (floor) {
                const bounds = objectBounds(floor, 'room-floor', '房间地面');
                if (bounds) targets.push(bounds);
            }
        }
        return targets;
    }
    snapObjectPosition(id: string, position: Vec3, axes = 'XYZ'): Vec3 {
        const entity = this.project.entities.find((e) => e.id === id),
            root = this.models.get(id);
        if (effectPreferences.current.surfaceDrop && entity && !entity.handBinding && ['prop', 'actor'].includes(entity.kind) && root && this.selectedPoint < 0 && /[XZ]/.test(axes)) {
            const targets = this.project.entities.filter(e => e.id !== id && e.kind === 'prop' && !e.light && editorEntityVisible(this.project, e)).flatMap(e => this.models.get(e.id) ?? []);
            const snapped = surfaceDropPosition(root, position, targets);
            if (snapped) return snapped;
        }
        if (!this.objectSnapEnabled || entity?.kind !== 'prop' || !root || this.selectedPoint >= 0) return position;
        const bounds = objectBounds(root, id, entity.name);
        if (!bounds) return position;
        const delta = new T.Vector3(...position).sub(root.position);
        bounds.corners.forEach((p) => p.add(delta));
        const targets = this.dragging
            ? (this.snapTargets ??= this.collectSnapTargets(id))
            : this.collectSnapTargets(id);
        const result = findObjectSnap(bounds, targets, axes);
        this.objectSnapTarget = result?.target.name ?? '';
        if (result && result.offset.lengthSq() > 1e-12)
            return new T.Vector3(...position).add(result.offset).toArray() as Vec3;
        // Nearby object boundaries win over the grid. Otherwise retain grid behavior on active axes only.
        const grid = new T.Vector3(
            ...position.map((v, i) =>
                axes.includes('XYZ'[i]) && this.placementSnap
                    ? Math.round(v / this.placementSnap) * this.placementSnap
                    : v,
            ),
        );
        if (result) {
            const correction = grid.sub(new T.Vector3(...position));
            const normal = result.normal.clone();
            ['X', 'Y', 'Z'].forEach((axis, i) => {
                if (!axes.includes(axis)) normal.setComponent(i, 0);
            });
            if (normal.lengthSq() > 1e-8)
                correction.addScaledVector(normal, -correction.dot(result.normal) / normal.lengthSq());
            return new T.Vector3(...position).add(correction).toArray() as Vec3;
        }
        return grid.toArray() as Vec3;
    }
    refreshHelpers() {
        this.needsRender = true;
        if (this.lightShotFloor) {
            disposeTree(this.lightShotFloor);
            this.lightShotFloor = null;
        }
        this.contactMarker.root?.removeFromParent();
        while (this.helpers.children.length) disposeTree(this.helpers.children[0]);
        while (this.pathHelpers.children.length) disposeTree(this.pathHelpers.children[0]);
        this.selectionBox = null;
        if (this.contactMarker.root) this.helpers.add(this.contactMarker.root);
        // Editor-only spatial reference. It is not a scene entity, so deleting a
        // placed ground prop never removes the floor/grid used for navigation.
        const workingY = workingElevation(this.project);
        const visibleGround = this.project.entities.filter(
            (entity) => entity.asset === 'ground' && editorEntityVisible(this.project, entity),
        );
        const groundTop = visibleGround.reduce<number | null>((highest, entity) => {
            const model = this.models.get(entity.id);
            if (!model) return highest;
            model.updateWorldMatrix(true, true);
            const top = new T.Box3().setFromObject(model).max.y;
            return highest === null ? top : Math.max(highest, top);
        }, null);
        // The starter ground is dark scene content. In the light editor, use a
        // temporary floor for the stage and the live shot preview.
        // `groundTop` is null until the ground models finish loading, so a ground entity that
        // exists but has no model yet must not count: `groundTop!` would otherwise place the
        // floor at NaN metres.
        this.lightGroundPreview =
            getEditorTheme() === 'light' &&
            groundTop !== null &&
            visibleGround.length > 0 &&
            visibleGround.every((entity) => entity.color.toLowerCase() === '#1d2127');
        if (groundTop === null || this.lightGroundPreview) {
            const floor = new T.Mesh(
                new T.PlaneGeometry(160, 160),
                new T.MeshBasicMaterial({ color: vpToken('vp-floor'), side: T.DoubleSide, depthWrite: false }),
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = this.lightGroundPreview ? groundTop! + 0.006 : workingY - 0.025;
            this.helpers.add(floor);
        }
        if (this.lightGroundPreview) {
            this.lightShotFloor = new T.Mesh(
                new T.PlaneGeometry(160, 160),
                new T.MeshBasicMaterial({ color: vpToken('vp-floor'), side: T.DoubleSide }),
            );
            this.lightShotFloor.rotation.x = -Math.PI / 2;
            this.lightShotFloor.position.y = groundTop! + 0.006;
            this.lightShotFloor.visible = false;
            this.scene.add(this.lightShotFloor);
        }
        const grid = new T.GridHelper(
            this.project.room.enabled ? 20 : 80,
            this.project.room.enabled ? 20 : 80,
            vpToken('vp-grid-major'),
            vpToken('vp-grid-minor'),
        );
        grid.position.y = (groundTop ?? workingY) + 0.012;
        grid.visible = this.gridVisible;
        grid.material.transparent = true;
        grid.material.opacity = 0.38;
        this.helpers.add(grid);
        const e = this.project.entities.find((x) => x.id === this.selected);
        if (e && editorEntityVisible(this.project, e)) {
            const root = this.models.get(e.id);
            if (root && e.kind !== 'camera') {
                this.selectionBox = new T.BoxHelper(root, vpToken('vp-selection'));
                this.helpers.add(this.selectionBox);
            }
            if (e.path) {
                const pts: T.Vector3[] = [];
                const first = e.path.points[0].time,
                    last = e.path.points.at(-1)!.time;
                for (let i = 0; i <= 100; i++)
                    pts.push(
                        pathPosition(
                            { smooth: e.path.smooth, interpolation: e.path.interpolation, points: e.path.points },
                            e.position,
                            first + ((last - first) * i) / 100,
                        ).add(new T.Vector3(0, 0.016, 0)),
                    );
                const line = new T.Line(
                    new T.BufferGeometry().setFromPoints(pts),
                    new T.LineBasicMaterial({ color: e.kind === 'camera' ? '#e3d7bd' : e.color }),
                );
                this.pathHelpers.add(line);
                e.path.points.forEach((p, i) => {
                    const point = new T.Mesh(
                        new T.SphereGeometry(0.055, 12, 8),
                        new T.MeshBasicMaterial({
                            color: i === this.selectedPoint ? '#ffffff' : '#87add9',
                            depthTest: false,
                        }),
                    );
                    point.position.fromArray(p.position);
                    point.position.y += 0.025;
                    point.userData.pointIndex = i;
                    point.userData.entityId = e.id;
                    point.renderOrder = 3;
                    this.pathHelpers.add(point);
                });
            }
            if (e.memberPaths && root) {
                root.updateWorldMatrix(true, false);
                for (const path of e.memberPaths) {
                    const points = path.points.map((p) =>
                        new T.Vector3(...p.position).applyMatrix4(root.matrixWorld).add(new T.Vector3(0, 0.025, 0)),
                    );
                    this.pathHelpers.add(
                        new T.Line(
                            new T.BufferGeometry().setFromPoints(points),
                            new T.LineBasicMaterial({ color: e.color, transparent: true, opacity: 0.6 }),
                        ),
                    );
                }
            }
            if (e.kind === 'camera') {
                const helper = new T.CameraHelper(this.cameras.get(e.id)!);
                const tint = new T.Color('#9eafc1');
                helper.setColors(tint, tint, tint, tint, tint);
                this.helpers.add(helper);
            }
        }
        this.helpers.traverse((o) => o.layers.set(1));
        this.pathHelpers.traverse((o) => o.layers.set(1));
    }
    private prepareView(editor: boolean, id = this.previewId) {
        const rig = this.rigs.get(this.selected),
            selected = this.project.entities.find((e) => e.id === this.selected);
        this.jointNodes.bind(
            rig && selected?.kind === 'actor' && !selected.external && !isAnimalAsset(selected.asset) ? rig : undefined,
        );
        this.jointNodes.root.visible =
            editor &&
            this.jointNodesVisible &&
            !!rig &&
            !!selected &&
            editorEntityVisible(this.project, selected) &&
            !this.drawingPath;
        if (editor && this.jointNodes.root.visible) this.jointNodes.update(this.editorCamera, this.stage.clientHeight);
        const cameraEntity = this.cameraEntity(id);
        for (const e of this.project.entities) {
            const root = this.models.get(e.id);
            if (!root) continue;
            root.visible = editor
                ? editorEntityVisible(this.project, e) && !(this.lightGroundPreview && e.asset === 'ground')
                : shotEntityVisible(this.project, e, cameraEntity.camera) &&
                  !(this.lightGroundPreview && e.asset === 'ground');
            // A camera captured from the current view surrounds the editor's eye.
            // Hide its solid marker only while the eye intersects it, otherwise its
            // body/lens occludes the whole stage. The shot camera remains available.
            if (editor && root.visible && e.kind === 'camera') {
                this.cameraMarkerBounds.setFromObject(root).expandByScalar(this.editorCamera.near);
                if (this.cameraMarkerBounds.containsPoint(this.editorCamera.position)) root.visible = false;
            }
        }
        if (this.lightShotFloor) this.lightShotFloor.visible = !editor;
        this.contactMarker.update(this.project.entities, this.models);
        const room = this.project.room;
        this.roomGroup.visible = room.enabled;
        for (const [side, wall] of this.walls) {
            wall.visible = editor
                ? side !== 'ceiling' &&
                  !(side === 'south' && this.editorCamera.position.z > room.depth / 2) &&
                  !(side === 'north' && this.editorCamera.position.z < -room.depth / 2) &&
                  !(side === 'east' && this.editorCamera.position.x > room.width / 2) &&
                  !(side === 'west' && this.editorCamera.position.x < -room.width / 2)
                : !cameraEntity.camera!.hideWalls.includes(side);
        }
        this.rigs.forEach((r) => (r.head.visible = true));
        if (!editor && cameraEntity.camera!.mode === 'pov') {
            const rig = this.rigs.get(cameraEntity.camera!.targetId);
            if (rig) rig.head.visible = false;
        }
        this.scene.background =
            !editor && this.hostPanorama
                ? this.hostPanorama
                : new T.Color(
                      editor
                          ? vpToken('vp-stage-bg')
                          : getEditorTheme() === 'light' &&
                              (this.project.lighting?.background ?? DEFAULT_SHOT_BACKGROUND) === DEFAULT_SHOT_BACKGROUND
                            ? vpToken('vp-shot-bg')
                            : (this.project.lighting?.background ?? DEFAULT_SHOT_BACKGROUND),
                  );
    }
    resize() {
        const ratio = Math.min(window.devicePixelRatio, 1.5) * (this.previewQuality === 'draft' ? 0.65 : 1);
        this.editorRenderer.setPixelRatio(ratio);
        this.shotRenderer.setPixelRatio(ratio);
        const sw = this.stage.clientWidth,
            sh = this.stage.clientHeight;
        if (sw && sh) {
            this.editorRenderer.setSize(sw, sh);
            this.editorCamera.aspect = sw / sh;
            this.editorCamera.updateProjectionMatrix();
        }
        const bw = this.shot.clientWidth,
            bh = this.shot.clientHeight,
            a = aspectNumber(this.project.aspect);
        if (bw && bh) {
            const w = Math.round(Math.min(bw, bh * a)),
                h = Math.round(w / a);
            this.shotRenderer.setSize(w, h);
        }
        this.resizeNeeded = false;
    }
    render(force = true) {
        if (this.exporting || this.disposed) return;
        this.orbit.update();
        const view = `${this.previewId}:${this.gridVisible}:${this.drawingPath}:${this.positionKeying}:${this.objectSnapEnabled}:${this.objectSnapTarget}`;
        if (!force && !this.needsRender && !this.resizeNeeded && view === this.renderedView) return;
        this.needsRender = false;
        this.renderedView = view;
        if (this.resizeNeeded) this.resize();
        this.helpers.traverse((o) => {
            if (o instanceof T.CameraHelper) o.update();
        });
        this.prepareView(true);
        if (this.stage.clientWidth) this.renderScene(this.editorRenderer, this.editorCamera);
        this.prepareView(false);
        if (this.shot.clientWidth) {
            this.renderShot(this.previewId);
        }
        this.onFrame();
    }
    renderOutput(time: number, width: number, height: number, cameraId = 'program') {
        this.sample(time);
        this.shotRenderer.setPixelRatio(1);
        this.shotRenderer.setSize(width, height, false);
        // Match the live shot, including its default background and floor treatment.
        this.prepareView(false, cameraId);
        const camera = this.getShotCamera(cameraId);
        configureCamera(camera, camera.getFocalLength(), width / height);
        this.renderShot(cameraId);
        return this.shotRenderer.domElement;
    }
    /**
     * Straight-down orthographic view of the set, cut horizontally like an architectural plan.
     *
     * Everything above `cutHeight` is clipped so ceiling slabs, beams and lintels do not hide the
     * rooms and doorways show as gaps. A clipped wall is open on top, which single-sided materials
     * would render as nothing, so materials are double-sided for this one frame and restored after.
     * The camera keeps the default layer, so editor helpers (layer 1) stay out, as in a shot.
     */
    renderPlan(time: number, framing: PlanFraming, cutHeight: number) {
        this.sample(time);
        this.shotRenderer.setPixelRatio(1);
        this.shotRenderer.setSize(framing.pixels.width, framing.pixels.height, false);
        this.prepareView(false);
        const top = cutHeight + 50;
        const camera = new T.OrthographicCamera(
            -framing.width / 2, framing.width / 2, framing.height / 2, -framing.height / 2, 0.1, top + 500,
        );
        camera.position.set(framing.centerX, top, framing.centerZ);
        camera.up.set(0, 0, -1);
        camera.lookAt(framing.centerX, 0, framing.centerZ);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        const sides: Array<[T.Material, T.Side]> = [];
        this.scene.traverse((object) => {
            const mesh = object as T.Mesh;
            if (!mesh.isMesh) return;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                if (material.side === T.DoubleSide) continue;
                sides.push([material, material.side]);
                material.side = T.DoubleSide;
                material.needsUpdate = true;
            }
        });
        const clipping = this.shotRenderer.clippingPlanes;
        this.shotRenderer.clippingPlanes = [new T.Plane(new T.Vector3(0, -1, 0), cutHeight)];
        try {
            this.renderScene(this.shotRenderer, camera);
        } finally {
            this.shotRenderer.clippingPlanes = clipping;
            for (const [material, side] of sides) {
                material.side = side;
                material.needsUpdate = true;
            }
        }
        return this.shotRenderer.domElement;
    }
    restorePreview(time: number) {
        this.exporting = false;
        this.sample(time);
        this.shotRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.resizeNeeded = true;
        this.render();
    }
    requestResize() {
        this.resizeNeeded = true;
    }
    viewTop() {
        const y = workingElevation(this.project);
        this.editorCamera.position.set(0, y + 10, 0.001);
        this.orbit.target.set(0, y, 0);
        this.orbit.update();
    }
    viewHome() {
        const distance = this.project.room.enabled ? 7 : 18,
            y = workingElevation(this.project);
        this.editorCamera.position.set(distance, distance * 0.84 + y, distance);
        this.orbit.target.set(0, y + 0.85, 0);
        this.orbit.update();
    }
    focus(id: string) {
        const target = this.models.get(id);
        if (!target) return;
        this.focusBounds(new T.Box3().setFromObject(target));
    }
    private effects = new Map<T.WebGLRenderer, SceneEffects>();
    private renderScene(renderer: T.WebGLRenderer, camera: T.Camera) {
        const preferences = effectPreferences.current;
        if (!preferences.ambientOcclusion && !preferences.outline) { renderer.render(this.scene, camera); return; }
        let effects = this.effects.get(renderer);
        if (!effects) { effects = new SceneEffects(renderer, this.scene, camera); this.effects.set(renderer, effects); }
        effects.render(this.scene, camera, preferences.ambientOcclusion, preferences.outline);
    }
    private renderShot(id: string) {
        const camera = this.getShotCamera(id);
        this.renderScene(this.shotRenderer, camera);
    }
    focusBounds(bounds: T.Box3) {
        if (bounds.isEmpty()) return;
        const size = bounds.getSize(new T.Vector3());
        bounds.getCenter(this.orbit.target);
        const distance = Math.max(
            1.5,
            size.length() /
                (2 * Math.tan(T.MathUtils.degToRad(this.editorCamera.fov / 2))) /
                Math.min(1, this.editorCamera.aspect),
        );
        const direction = this.editorCamera.position.clone().sub(this.orbit.target).normalize();
        if (direction.lengthSq() < 0.01) direction.set(1, 0.7, 1).normalize();
        this.editorCamera.position.copy(this.orbit.target).addScaledVector(direction, distance * 1.2);
        this.orbit.update();
    }
    private pathSurfaces(): T.Object3D[] {
        if (this.pathSurfaceMode !== 'surface') return [];
        const surfaces = this.project.entities
            .filter((item) => item.kind === 'prop' && !item.light && item.visible && item.id !== this.selected)
            .flatMap((item) => {
                const root = this.models.get(item.id);
                return root ? [root] : [];
            });
        if (this.project.room.enabled) surfaces.push(this.roomGroup);
        return surfaces;
    }
    private pathPointFromRay(ray: T.Raycaster, surfaces = this.pathSurfaces()): Vec3 | null {
        if (this.pathSurfaceMode === 'surface') {
            const surface = ray.intersectObjects(surfaces, true).find((hit) => {
                let node: T.Object3D | null = hit.object;
                while (node) {
                    if (!node.visible) return false;
                    node = node.parent;
                }
                return true;
            });
            if (surface) return surface.point.toArray() as Vec3;
        }
        const out = new T.Vector3();
        return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -workingElevation(this.project)), out)
            ? (out.toArray() as Vec3)
            : null;
    }
    private entityFromRay(ray: T.Raycaster): string | undefined {
        const hit = ray.intersectObjects([...this.models.values()], true).find((x) => {
            let node: T.Object3D | null = x.object;
            while (node) {
                if (!node.visible) return false;
                node = node.parent;
            }
            return true;
        });
        return hit?.object.userData.entityId;
    }
    entityAt(clientX: number, clientY: number): string | undefined {
        const rect = this.editorRenderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height || !this.pickingEnabled) return;
        const ray = new T.Raycaster();
        ray.layers.enable(1);
        ray.setFromCamera(
            new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, (-(clientY - rect.top) / rect.height) * 2 + 1),
            this.editorCamera,
        );
        this.prepareView(true);
        try {
            return this.entityFromRay(ray);
        } finally {
            this.prepareView(false);
        }
    }
    pick(e: PointerEvent) {
        if (this.drawingPath && this.pathDrawMode === 'freehand') return;
        if (
            !this.pickingEnabled ||
            e.button !== 0 ||
            this.dragging ||
            this.gizmo.axis ||
            Math.hypot(e.clientX - this.pointerDown[0], e.clientY - this.pointerDown[1]) > 5
        )
            return;
        const rect = this.editorRenderer.domElement.getBoundingClientRect();
        const mouse = new T.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const ray = new T.Raycaster();
        ray.layers.enable(1);
        ray.setFromCamera(mouse, this.editorCamera);
        this.prepareView(true);
        try {
            if (this.drawingPath) {
                const point = this.pathPointFromRay(ray);
                if (point) this.cb.ground(point);
                return;
            }
            const joint = this.jointNodes.pick(ray);
            if (joint) {
                this.selectJoint(joint);
                this.cb.joint?.(joint);
                return;
            }
            const points = ray
                .intersectObjects(this.pathHelpers.children, false)
                .find((x) => x.object.userData.pointIndex !== undefined);
            if (points) {
                this.cb.point(points.object.userData.pointIndex);
                return;
            }
            const id = this.entityFromRay(ray);
            if (id) this.cb.select(id);
        } finally {
            this.prepareView(false);
        }
    }
    getProjectedLabels() {
        const w = this.stage.clientWidth,
            h = this.stage.clientHeight;
        const mode = editorPreferences.current.labelMode;
        if (mode === 'off') return [];
        return this.project.entities
            .filter((e) => {
                if (!editorEntityVisible(this.project, e)) return false;
                // Labels were limited to actors and cameras, which left props and lights with no
                // marker in the viewport at all. The preference decides the density instead.
                if (mode === 'selected') return e.id === this.selected;
                return true;
            })
            .map((e) => {
                const model = this.models.get(e.id);
                if (!model) return null;
                const labelHeight = e.kind === 'actor' || e.kind === 'crowd' ? e.height + 0.16 : 0.25;
                const p = model.position.clone().add(new T.Vector3(0, labelHeight, 0));
                p.project(this.editorCamera);
                return {
                    id: e.id,
                    name: e.name.split(' · ')[0],
                    color: e.color,
                    kind: e.kind,
                    light: Boolean(e.light),
                    x: (p.x * 0.5 + 0.5) * w,
                    y: (-0.5 * p.y + 0.5) * h,
                    visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
                };
            })
            .filter((label): label is NonNullable<typeof label> => label !== null);
    }
    projectionSignature(id = this.previewId) {
        const c = this.getShotCamera(id);
        return {
            cameraId: this.cameraEntity(id).id,
            time: this.time,
            world: c.matrixWorld.toArray(),
            projection: c.projectionMatrix.toArray(),
        };
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.events.abort();
        this.resizeObserver.disconnect();
        this.freehandInput.dispose();
        this.jointNodes.dispose();
        this.gizmo.detach();
        this.gizmo.dispose();
        this.orbit.dispose();
        this.lighting.dispose();
        for (const [id, root] of this.models) {
            if (
                !this.externalModels.removeInstance(
                    id,
                    this.crowdRigs.get(id)?.map((_, i) => `${id}:${i}`),
                )
            )
                disposeTree(root);
        }
        this.externalModels.dispose();
        this.models.clear();
        this.cameras.clear();
        this.rigs.clear();
        this.crowdRigs.clear();
        this.cameraVisuals.clear();
        disposeTree(this.roomGroup);
        disposeTree(this.helpers);
        disposeTree(this.pathHelpers);
        // The light-theme floor lives on the scene, not in `helpers`, so nothing above releases
        // it; `scene.clear()` only detaches, leaving its geometry and material on the GPU.
        if (this.lightShotFloor) {
            disposeTree(this.lightShotFloor);
            this.lightShotFloor = null;
        }
        this.selectionBox?.dispose();
        this.scene.clear();
        this.effects.forEach(effect => effect.dispose());
        this.effects.clear();
        for (const renderer of [this.editorRenderer, this.shotRenderer]) {
            renderer.dispose();
            renderer.domElement.remove();
        }
    }
}

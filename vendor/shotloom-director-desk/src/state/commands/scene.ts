import { numberAt } from '@/core/animation/channels.ts';
import * as THREE from 'three';
import { findAsset } from '@/core/asset-catalog.ts';
import { cameraPresetPath, type CameraPresetId } from '@/core/cinematography/camera-presets.ts';
import { libraryPreferences } from '@/core/assets/library-preferences.ts';
import { workingElevation } from '@/core/building/floors.ts';
import { entityPosition } from '@/core/timeline.ts';
import { ASPECTS, FRAME_RATES, COLORS, clip, entity, outputSize, type Project, type Vec3 } from '@/core/model.ts';
import type { CameraConfig } from '@/core/model.ts';
import { defaultLighting, type LightingConfig } from '@/core/lighting/model.ts';
import { deliverMedia } from '@/core/host-delivery.ts';
import { assetParameters, validateAssetParameters } from '@/core/assets/parameters.ts';
import { captureModelViews, inspectModel, MODEL_INSPECTION_VIEWS, type ModelInspectionView } from '@/core/editor/model-inspection.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Standard shot sizes used by the quick framing presets. */
export type FramingName = '全景' | '中景' | '近景' | '特写';

/** Catalogue surface: the exact names `apply_framing` accepts, so callers never guess. */
export const FRAMING_NAMES: FramingName[] = ['全景', '中景', '近景', '特写'];

const FRAMING_HEIGHTS: Record<FramingName, number> = { 全景: 2.2, 中景: 1.15, 近景: 0.65, 特写: 0.3 };

/** Scene-level commands: catalogue assets, cameras, still export and environment. */
export class SceneCommands {
    constructor(private readonly host: EditorCommandHost) {}

    /** Place a catalogue asset on the ground under the orbit target. */
    addAsset(assetId: string): boolean {
        const asset = findAsset(assetId);
        const engine = this.host.engine;
        if (!asset || !engine) return false;
        const target = engine.orbit.target;
        const elevation = workingElevation(this.host.project);
        const added = this.host.change(() => {
            const e = entity(asset.kind, asset.id, asset.name, engine.snapPosition([target.x, elevation, target.z]));
            e.position[1] = elevation;
            if (e.light) {
                e.position[1] += 3;
                e.rotation[0] = -Math.PI / 4;
            }
            if (asset.kind === 'actor' || asset.kind === 'crowd') {
                const actors = this.host.project.entities.filter((entity) => entity.kind === 'actor').length;
                e.color = COLORS[actors % COLORS.length];
                e.clips = [clip('idle', 0, this.host.project.duration)];
            }
            this.host.project.entities.push(e);
            this.host.patch({ selected: e.id, inspectorTab: e.light ? 'light' : 'base' });
        });
        if (added) {
            libraryPreferences.used(assetId);
            engine.select(useEditorStore.getState().selected);
        }
        return added;
    }

    addCamera(fromView = false): void {
        const engine = this.host.engine;
        this.host.change(() => {
            const project = this.host.project;
            const cameras = project.entities.filter((e) => e.kind === 'camera');
            const position = (
                fromView && engine
                    ? engine.editorCamera.position.clone()
                    : new THREE.Vector3(1.8, 1.5 + workingElevation(project), 1.8)
            ).toArray() as Vec3;
            const camera = entity('camera', 'camera', String.fromCharCode(65 + cameras.length) + ' · 新机位', position);
            if (fromView && engine) {
                camera.camera!.target = engine.orbit.target.toArray() as Vec3;
                const reference = engine.editorCamera.clone();
                reference.filmGauge = 36;
                camera.camera!.focal = THREE.MathUtils.clamp(reference.getFocalLength(), 8, 300);
            }
            project.entities.push(camera);
            if (engine) engine.previewId = camera.id;
            this.host.patch({ selected: camera.id, inspectorTab: 'camera', preview: camera.id });
        });
        this.host.engine?.select(useEditorStore.getState().selected);
    }

    async snapshot(): Promise<void> {
        const engine = this.host.engine;
        if (!engine || useEditorStore.getState().busy) return;
        const at = useEditorStore.getState().time;
        this.host.patch({ playing: false, busy: true });
        engine.exporting = true;
        try {
            const [width, height] = outputSize(this.host.project.aspect, 1920);
            await engine.prepareOutput(at);
            const canvas = engine.renderOutput(at, width, height, useEditorStore.getState().preview);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('未能生成截图');
            await deliverMedia(blob, `${this.host.project.name}-${at.toFixed(2)}s.png`, 'image');
            notifySuccess('已导出当前画面');
        } catch (error) {
            notifyError((error as Error).message);
        } finally {
            this.host.patch({ busy: false });
            engine.restorePreview(at);
        }
    }

    /**
     * Render one frame and hand the pixels back to the caller instead of downloading it.
     *
     * The host Agent cannot judge composition, occlusion, lighting or clipping from scene
     * JSON alone, so it needs the same evidence a person gets from the viewport. Unlike
     * `snapshot`, this writes no file, and it renders at a modest size because the frame is
     * only an inspection aid.
     */
    async renderPreview(input: {
        seconds?: number;
        cameraId?: string;
        size?: number;
    }): Promise<{ dataUrl: string; seconds: number; cameraId: string; width: number; height: number }> {
        const engine = this.host.engine;
        if (!engine) throw new Error('导演台画布尚未准备好');
        if (useEditorStore.getState().busy || engine.exporting) throw new Error('导演台正在执行其他任务，请稍后重试');
        const state = useEditorStore.getState();
        const seconds = input.seconds === undefined ? state.time : input.seconds;
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > this.host.project.duration)
            throw new Error('截图时间超出场景时长');
        const cameraId = input.cameraId === undefined ? state.preview : input.cameraId;
        const size = input.size === undefined ? 640 : input.size;
        if (![640, 1280].includes(size)) throw new Error('size 只能是 640 或 1280');
        const at = this.host.clock;
        this.host.patch({ playing: false, busy: true });
        engine.exporting = true;
        try {
            const [width, height] = outputSize(this.host.project.aspect, size);
            await engine.prepareOutput(seconds);
            const canvas = engine.renderOutput(seconds, width, height, cameraId);
            return { dataUrl: canvas.toDataURL('image/png'), seconds, cameraId, width, height };
        } finally {
            this.host.patch({ busy: false });
            engine.restorePreview(at);
        }
    }

    /** Inspect several real timeline frames as one labeled image without exporting media. */
    async renderPreviewSheet(input: { timesSec: number[]; cameraId?: string }) {
        const engine = this.host.engine;
        if (!engine) throw new Error('导演台画布尚未准备好');
        if (useEditorStore.getState().busy || engine.exporting) throw new Error('导演台正在执行其他任务，请稍后重试');
        if (!Array.isArray(input.timesSec) || input.timesSec.length < 1 || input.timesSec.length > 8 ||
            input.timesSec.some(seconds => !Number.isFinite(seconds) || seconds < 0 || seconds > this.host.project.duration)) {
            throw new Error('timesSec 需要 1 至 8 个场景时长内的秒数');
        }
        const timesSec = [...input.timesSec].sort((a, b) => a - b);
        const cameraId = input.cameraId ?? useEditorStore.getState().preview;
        const [frameWidth, frameHeight] = outputSize(this.host.project.aspect, 640);
        const cellWidth = 320;
        const cellHeight = Math.round(cellWidth * frameHeight / frameWidth);
        const columns = Math.min(4, timesSec.length);
        const rows = Math.ceil(timesSec.length / columns);
        const gap = 6;
        const sheet = document.createElement('canvas');
        sheet.width = columns * cellWidth + (columns + 1) * gap;
        sheet.height = rows * cellHeight + (rows + 1) * gap;
        const context = sheet.getContext('2d');
        if (!context) throw new Error('无法创建导演台预览拼图');
        context.fillStyle = '#17191d';
        context.fillRect(0, 0, sheet.width, sheet.height);
        const at = this.host.clock;
        this.host.patch({ playing: false, busy: true });
        engine.exporting = true;
        try {
            for (const [index, seconds] of timesSec.entries()) {
                await engine.prepareOutput(seconds);
                const frame = engine.renderOutput(seconds, frameWidth, frameHeight, cameraId);
                const x = gap + index % columns * (cellWidth + gap);
                const y = gap + Math.floor(index / columns) * (cellHeight + gap);
                context.drawImage(frame, x, y, cellWidth, cellHeight);
                const label = `${Number(seconds.toFixed(3))}s`;
                context.font = '600 13px sans-serif';
                const badgeWidth = Math.ceil(context.measureText(label).width) + 14;
                context.fillStyle = 'rgba(0, 0, 0, 0.78)';
                context.fillRect(x, y + cellHeight - 24, badgeWidth, 24);
                context.fillStyle = '#fff';
                context.textBaseline = 'middle';
                context.fillText(label, x + 7, y + cellHeight - 12);
            }
            return { dataUrl: sheet.toDataURL('image/jpeg', 0.88), timesSec, cameraId,
                width: sheet.width, height: sheet.height, columns, rows };
        } finally {
            this.host.patch({ busy: false });
            engine.restorePreview(at);
        }
    }

    /** Inspect the current sampled prop in neutral studio views without changing the project or viewport. */
    inspectModel(input: { id?: string; views?: string[] }) {
        const engine = this.host.engine;
        if (!engine) throw new Error('导演台画布尚未准备好');
        if (useEditorStore.getState().busy || engine.exporting) throw new Error('导演台正在执行其他任务，请稍后重试');
        const id = input.id || useEditorStore.getState().selected;
        const entity = this.host.project.entities.find(item => item.id === id);
        if (!entity) throw new Error('请提供场景中真实存在的对象 ID，或先选中一个道具');
        if (entity.kind !== 'prop') throw new Error('多视角模型核验目前支持建筑和道具；人物请使用场景预览');
        const views = input.views ?? ['front', 'left', 'top', 'three_quarter'];
        if (!Array.isArray(views) || views.length < 1 || views.length > 6 ||
            views.some(view => !MODEL_INSPECTION_VIEWS.includes(view as ModelInspectionView))) {
            throw new Error(`views 需要 1 至 6 个视角：${MODEL_INSPECTION_VIEWS.join('、')}`);
        }
        const root = engine.models.get(id);
        if (!root) throw new Error('模型尚未加载到导演台场景');
        this.host.patch({ busy: true });
        try {
            const inspected = inspectModel(root, views as ModelInspectionView[]);
            const image = captureModelViews(inspected.model, inspected.box, views as ModelInspectionView[]);
            const world = engine.worldBounds(id);
            const { model: _model, box: _box, ...geometry } = inspected;
            root.updateWorldMatrix(true, true);
            const worldPosition = new THREE.Vector3();
            const worldRotation = new THREE.Quaternion();
            root.matrixWorld.decompose(worldPosition, worldRotation, new THREE.Vector3());
            const worldFromScaledLocal = new THREE.Matrix4().compose(worldPosition, worldRotation, new THREE.Vector3(1, 1, 1));
            let assetValidation: { ok: true } | { ok: false; error: string } | null = entity.external ? null : { ok: true };
            if (!entity.external) {
                try { validateAssetParameters(entity); }
                catch (error) { assetValidation = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
            }
            const source = entity.external
                ? this.host.project.resources?.find(item => item.id === entity.external?.resourceId)
                : undefined;
            const sourceInspection = source ? engine.externalModels.inspection(source) : null;
            return {
                ...geometry,
                parts: inspected.parts.map(part => ({
                    ...part,
                    worldCenter: new THREE.Vector3(...part.center).applyMatrix4(worldFromScaledLocal).toArray(),
                })),
                ...image,
                entityId: id,
                name: entity.name,
                assetId: entity.asset,
                visible: entity.visible,
                timeSec: engine.time,
                coordinates: 'bounds 和 parts 为对象朝向归零后的局部米制坐标，包含当前缩放；parts.worldCenter 和 worldBounds 为场景世界坐标',
                worldBounds: world ? {
                    min: world.min.toArray(), max: world.max.toArray(),
                    size: world.getSize(new THREE.Vector3()).toArray(),
                } : null,
                assetParameters: entity.external ? null : assetParameters(entity),
                assetValidation,
                sourceModel: sourceInspection ? {
                    meshes: sourceInspection.meshes,
                    triangles: sourceInspection.triangles,
                    nodes: sourceInspection.nodes.length,
                    warnings: sourceInspection.warnings,
                } : null,
                hint: '逐格查看正面、侧面、顶部等视角；参数与包围盒只证明几何事实，建筑组合、遮挡和视觉效果仍要用场景预览核验。',
            };
        } finally {
            this.host.patch({ busy: false });
        }
    }

    /**
     * Export one shot as a still.
     *
     * The shot list needs a per-shot deliverable, and a still at the shot's midpoint is what
     * feeds the next canvas node: it is the frame a video model would be conditioned on.
     */
    async exportShot(span: { index: number; cameraId: string; start: number; end: number }): Promise<void> {
        const engine = this.host.engine;
        if (!engine || useEditorStore.getState().busy || engine.exporting) return;
        const at = span.start + Math.max(0, span.end - span.start) / 2;
        const originalTime = engine.time;
        this.host.patch({ playing: false, busy: true });
        engine.exporting = true;
        try {
            const [width, height] = outputSize(this.host.project.aspect, 1920);
            await engine.prepareOutput(at);
            const canvas = engine.renderOutput(at, width, height, span.cameraId || 'program');
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('未能生成画面');
            const cameraName = this.host.project.entities.find((entity) => entity.id === span.cameraId)?.name ?? '';
            await deliverMedia(blob, `${this.host.project.name}-镜头${span.index + 1}${cameraName ? '-' + cameraName : ''}.png`, 'image');
            notifySuccess('已导出镜头画面');
        } catch (error) {
            notifyError((error as Error).message);
        } finally {
            this.host.patch({ busy: false });
            engine.restorePreview(originalTime);
        }
    }

    /** Record the selected camera's focal length at the playhead. */
    recordFocalKeyAtPlayhead(): boolean {
        const camera = this.host.current()?.camera;
        if (!camera) return false;
        const time = Math.round(this.host.clock * this.host.project.fps) / this.host.project.fps;
        return this.host.change(() => {
            const keys = camera.focalKeys ? [...camera.focalKeys] : [];
            const current = numberAt({ keys }, time);
            const existing = keys.findIndex((key) => Math.abs(key.time - time) < 1e-7);
            if (existing >= 0) keys[existing] = { ...keys[existing], value: current };
            else keys.push({ time, value: current });
            keys.sort((a, b) => a.time - b.time);
            // A single key would silently freeze the lens everywhere, so keep the plain value
            // until there are at least two keys to interpolate between.
            camera.focalKeys = keys.length > 1 ? keys : undefined;
            camera.focal = current;
        });
    }

    /** Remove one focal key; dropping to a single key restores a fixed lens. */
    removeFocalKey(index: number): boolean {
        const camera = this.host.current()?.camera;
        if (!camera?.focalKeys) return false;
        const removed = camera.focalKeys[index];
        return this.host.change(() => {
            const keys = camera.focalKeys!.filter((_, position) => position !== index);
            camera.focalKeys = keys.length > 1 ? keys : undefined;
            if (!camera.focalKeys) camera.focal = removed.value;
        });
    }

    /** Frame the target with a standard shot size, then preview that camera. */
    applyFraming(name: FramingName): boolean {
        const camera = this.host.current();
        if (camera?.kind !== 'camera' || !camera.camera) return false;
        const project = this.host.project;
        const target =
            project.entities.find((entity) => entity.id === camera.camera!.targetId) ??
            project.entities.find((entity) => entity.kind === 'actor');
        if (!target) {
            notifyError('先选择一个构图目标或添加人物');
            return false;
        }
        const engine = this.host.engine;
        if (!engine) return false;
        const applied = this.host.change(() => {
            const config = camera.camera!;
            config.targetPath = null;
            config.aim = 'target';
            config.targetId = target.id;
            const height = FRAMING_HEIGHTS[name];
            config.targetHeight =
                name === '全景' ? target.height * 0.5 : name === '中景' ? target.height * 0.67 : target.height * 0.88;
            config.mode = 'free';
            config.focal = name === '特写' ? 70 : 35;
            delete config.focalKeys;
            const shotCamera = engine.getShotCamera(camera.id);
            const aspect = project.aspect.split(':').map(Number);
            const filmHeight = 36 / Math.max(aspect[0] / aspect[1], 1);
            const distance = (height * config.focal) / filmHeight;
            const targetPosition = entityPosition(target, this.host.clock).add(
                new THREE.Vector3(0, config.targetHeight, 0),
            );
            const direction = shotCamera.position.clone().sub(targetPosition).normalize();
            camera.position = targetPosition.addScaledVector(direction, distance).toArray() as Vec3;
            camera.path = null;
        }, false);
        if (!applied) return false;
        this.host.patch({ preview: camera.id });
        notifySuccess('已调整机位与焦距；请检查室内墙体遮挡');
        return true;
    }

    updateProjectSettings(patch: { name?: string; aspect?: string; fps?: number }): boolean {
        const name = patch.name?.trim();
        if (patch.name !== undefined && !name) {
            notifyError('项目名称不能为空');
            return false;
        }
        if (patch.aspect !== undefined && !ASPECTS.includes(patch.aspect)) return false;
        if (patch.fps !== undefined && !FRAME_RATES.includes(patch.fps)) return false;
        return this.host.change(() => {
            const project = this.host.project;
            if (name) project.name = name.slice(0, 80);
            if (patch.aspect) project.aspect = patch.aspect;
            if (patch.fps) project.fps = patch.fps;
        });
    }

    updateRoom(patch: Partial<Project['room']>): boolean {
        const next = { ...this.host.project.room, ...patch };
        if (![next.width, next.depth, next.height].every((value) => Number.isFinite(value) && value >= 2.3)) {
            notifyError('房间尺寸至少 2.3 米');
            return false;
        }
        return this.host.change(() => {
            this.host.project.room = next;
        });
    }

    setLightingField(patch: Partial<LightingConfig>): void {
        this.host.change(() => {
            this.host.project.lighting = { ...(this.host.project.lighting ?? defaultLighting()), ...patch };
        });
    }

    setCameraField(patch: Partial<CameraConfig>): void {
        const e = this.host.current();
        if (!e?.camera) return;
        this.host.change(() => {
            e.camera = { ...e.camera!, ...patch };
            if (patch.focal !== undefined && patch.focalKeys === undefined) delete e.camera.focalKeys;
        });
    }

    applyCameraPreset(id: CameraPresetId): boolean {
        const camera = this.host.current();
        const engine = this.host.engine;
        if (!camera?.camera || camera.locked || !engine) return false;
        const from = this.host.clock;
        const duration = 4;
        const liveCamera = engine.getShotCamera(camera.id);
        const start = liveCamera.position.toArray() as Vec3;
        const target = engine.targetPosition(camera).toArray() as Vec3;
        const focal = liveCamera.getFocalLength();
        const motion = cameraPresetPath(id, start, target, from, duration, focal);
        const applied = this.host.change(() => {
            camera.position = [...start];
            camera.path = motion.path;
            camera.camera!.mode = 'free';
            camera.camera!.aim = 'target';
            camera.camera!.targetId = '';
            camera.camera!.target = [...target];
            camera.camera!.targetPath = null;
            camera.camera!.focal = focal;
            if (motion.focalKeys) camera.camera!.focalKeys = motion.focalKeys;
            else delete camera.camera!.focalKeys;
            this.host.project.duration = Math.max(this.host.project.duration, from + duration);
        }, false);
        if (applied) {
            engine.previewId = camera.id;
            this.host.patch({ preview: camera.id, inspectorTab: 'camera' });
        }
        return applied;
    }

    toggleGrid(): void {
        const engine = this.host.engine;
        if (!engine) return;
        engine.gridVisible = !engine.gridVisible;
        engine.refreshHelpers();
        this.host.patch({ gridVisible: engine.gridVisible });
    }

    viewHome(): void {
        this.host.engine?.viewHome();
    }

    viewTop(): void {
        this.host.engine?.viewTop();
    }

    focusSelected(): void {
        const e = this.host.current();
        if (e) this.host.engine?.focus(e.id);
    }
}

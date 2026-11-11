import * as THREE from 'three';
import { detachHandBinding } from '@/core/animation/hand-binding.ts';
import { freezeCamera } from '@/core/editor/camera-editing.ts';
import { recordPositionKey } from '@/core/editor/position-keys.ts';
import { removeCameraVisibilityReference } from '@/core/scenes/camera-visibility.ts';
import { clone, uid, type Entity, type Vec3 } from '@/core/model.ts';
import { entityPosition, shiftPath } from '@/core/timeline.ts';
import type { LightConfig } from '@/core/lighting/model.ts';
import { notifyError } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Entity-level edits: duplicate/delete/ground, transform fields and light settings. */
export class EntityCommands {
    constructor(private readonly host: EditorCommandHost) {}

    /**
     * Record the selected entity's current position as a waypoint key at the playhead.
     *
     * Position keys reuse the motion-path waypoints on purpose: a second animation system
     * would drift from the path the user already sees drawn in the viewport.
     */
    recordPositionKeyAtPlayhead(): boolean {
        const e = this.host.current();
        if (!e || e.locked) return false;
        const time = this.host.clock;
        return this.host.change(() => {
            recordPositionKey(e, time, entityPosition(e, time).toArray() as Vec3, this.host.project.fps);
        });
    }

    renameEntity(name: string): void {
        const e = this.host.current();
        const next = name.trim();
        if (!e || e.locked || !next || next === e.name) return;
        this.host.change(() => {
            e.name = next;
        });
    }

    /** Copy the selected entity offset by 0.4 m so it stays visible next to the original. */
    duplicateSelected(): void {
        const source = this.host.current();
        if (!source) return;
        const added = this.host.change(() => {
            const copy = clone(source);
            copy.id = uid();
            copy.locked = false;
            copy.name = `${source.name} 副本`;
            copy.clips.forEach((clip) => (clip.id = uid()));
            if (copy.handBinding) copy.handBinding.offset[0] += 0.1;
            else shiftPath(copy, new THREE.Vector3(0.4, 0, 0.4));
            this.host.project.entities.push(copy);
            this.host.patch({ selected: copy.id });
        });
        if (added) this.host.engine?.select(useEditorStore.getState().selected);
    }

    /**
     * Remove the selected entity and every reference to it. Cameras that cuts point at are
     * repointed to another camera, or the delete is refused when there is no replacement.
     */
    deleteSelected(replacementCamera?: string): boolean {
        const target = this.host.current();
        if (!target) return false;
        const project = this.host.project;
        const otherCamera = project.entities.find((entity) => entity.kind === 'camera' && entity.id !== target.id)?.id;
        const cutsUseTarget = project.cuts.some((cut) => cut.cameraId === target.id);
        const replacement = replacementCamera ?? otherCamera;
        if (cutsUseTarget && !replacement) {
            notifyError('该机位仍被切镜引用，请先添加另一个机位');
            return false;
        }
        const removed = this.host.change(() => {
            for (const prop of project.entities) {
                if (prop.handBinding?.actorId === target.id) {
                    const model = this.host.engine?.models.get(prop.id);
                    if (model) detachHandBinding(prop, model);
                    else prop.handBinding = null;
                }
            }
            removeCameraVisibilityReference(project, target.id);
            project.entities = project.entities.filter((entity) => entity.id !== target.id);
            if (cutsUseTarget) {
                for (const cut of project.cuts) if (cut.cameraId === target.id) cut.cameraId = replacement!;
            }
            for (const entity of project.entities) {
                if (entity.camera?.targetId === target.id) {
                    if (this.host.engine) freezeCamera(this.host.engine, entity);
                    entity.camera.targetId = '';
                    entity.camera.mode = 'free';
                }
                if (entity.faceTarget === target.id) {
                    entity.faceTarget = '';
                    entity.face = 'fixed';
                }
            }
            const next =
                project.entities.find((entity) => entity.kind === 'actor')?.id ?? project.entities[0]?.id ?? '';
            this.host.patch({ selected: next, preview: 'program' });
        });
        return removed;
    }

    /** Drop the selected object onto the ground plane without moving it horizontally. */
    groundSelected(): void {
        const target = this.host.current();
        const engine = this.host.engine;
        if (!target || !engine) return;
        if (target.handBinding) {
            notifyError('手持道具请先解除绑定，再对齐地面');
            return;
        }
        if (target.kind === 'camera' || target.asset === 'ground' || target.asset === 'road') return;
        this.host.change(() => {
            const model = engine.models.get(target.id);
            if (!model) return;
            const bounds = new THREE.Box3().setFromObject(model);
            if (!bounds.isEmpty()) shiftPath(target, new THREE.Vector3(0, -bounds.min.y, 0));
        }, false);
    }

    setEntityColor(color: string): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            e.color = color;
        });
    }

    setEntityFlag(key: 'visible' | 'locked', value: boolean): void {
        const e = this.host.current();
        if (!e) return;
        if (e.locked && key === 'visible') return;
        this.host.change(() => {
            if (key === 'visible') e.visible = value;
            else e.locked = value;
        });
    }

    setPositionAxis(axis: 0 | 1 | 2, value: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(value)) return;
        const engine = this.host.engine;
        this.host.change(() => {
            if (e.camera && e.camera.mode !== 'free' && engine) freezeCamera(engine, e);
            const time = useEditorStore.getState().time;
            const delta = new THREE.Vector3();
            delta.setComponent(axis, value - entityPosition(e, time).getComponent(axis));
            if (engine?.positionKeying) {
                recordPositionKey(e, time, entityPosition(e, time).add(delta).toArray() as Vec3, this.host.project.fps);
            } else shiftPath(e, delta);
            this.host.extendDuration();
        });
    }

    setRotationAxis(axis: 0 | 1 | 2, degrees: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(degrees)) return;
        const engine = this.host.engine;
        this.host.change(() => {
            if (e.camera) {
                if (e.camera.mode !== 'free' && engine) {
                    freezeCamera(engine, e);
                    const rotation = engine.cameras.get(e.id)!.rotation;
                    e.rotation = [rotation.x, rotation.y, rotation.z];
                }
                e.camera.aim = 'manual';
                e.camera.mode = 'free';
            }
            e.rotation[axis] = THREE.MathUtils.degToRad(degrees);
        });
    }

    setScaleAxis(axis: 0 | 1 | 2, value: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(value)) return;
        this.host.change(() => {
            e.scale[axis] = Math.max(0.05, value);
        });
    }

    setHeight(value: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(value)) return;
        this.host.change(() => {
            e.height = Math.max(0.2, value);
        });
    }

    setEntityOption(key: 'build' | 'gender', value: string): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            if (key === 'build') e.build = value as Entity['build'];
            else e.gender = value as Entity['gender'];
        });
    }

    setLightField(patch: Partial<LightConfig>): void {
        const e = this.host.current();
        if (!e?.light || e.locked) return;
        this.host.change(() => {
            e.light = { ...e.light!, ...patch };
        });
    }
}

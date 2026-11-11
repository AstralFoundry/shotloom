import { assetJoints, isAnimalAsset } from '@/core/asset-catalog.ts';
import { jointAngles, mirrorPose } from '@/core/assets/joint-schema.ts';
import { setJointAxis } from '@/core/editor/joint-editing.ts';
import { clone, type Entity, type Joint } from '@/core/model.ts';
import { samplePose } from '@/core/timeline.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Joint selection, angle editing and pose keys. */
export class PoseCommands {
    constructor(private readonly host: EditorCommandHost) {}

    selectJoint(joint: Joint | ''): void {
        this.host.engine?.selectJoint(joint);
        this.host.patch({ selectedJoint: joint });
    }

    setJointNodesVisible(visible: boolean): void {
        const engine = this.host.engine;
        if (!engine) return;
        engine.jointNodesVisible = visible;
        if (!visible) this.selectJoint('');
        engine.render();
    }

    setJointAngle(joint: Joint, axis: 0 | 1 | 2, degrees: number): void {
        const e = this.host.current();
        if (!e || e.locked || !Number.isFinite(degrees)) return;
        this.host.change(() => {
            setJointAxis(e, joint, axis, degrees, this.host.clock, this.host.project.fps);
        }, false);
    }

    resetPose(): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            e.pose = {};
            if (!e.poseKeys.length) return;
            const at = Math.round(this.host.clock * this.host.project.fps) / this.host.project.fps;
            const key = e.poseKeys.find((item) => Math.abs(item.time - at) < 1e-6);
            if (key) key.pose = {};
            else e.poseKeys.push({ time: at, pose: {} });
            e.poseKeys.sort((a, b) => a.time - b.time);
        }, false);
    }

    mirrorPose(): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            const mirrored = mirrorPose(samplePose(e, this.host.clock), isAnimalAsset(e.asset));
            if (!e.poseKeys.length) {
                e.pose = mirrored;
                return;
            }
            const at = Math.round(this.host.clock * this.host.project.fps) / this.host.project.fps;
            const key = e.poseKeys.find((item) => Math.abs(item.time - at) < 1e-6);
            if (key) key.pose = mirrored;
            else e.poseKeys.push({ time: at, pose: mirrored });
            e.poseKeys.sort((a, b) => a.time - b.time);
        }, false);
    }

    recordPoseKey(): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            const at = Math.round(this.host.clock * this.host.project.fps) / this.host.project.fps;
            const pose = clone(samplePose(e, this.host.clock));
            const existing = e.poseKeys.find((item) => Math.abs(item.time - at) < 1e-6);
            if (existing) existing.pose = pose;
            else e.poseKeys.push({ time: at, pose });
            e.poseKeys.sort((a, b) => a.time - b.time);
        }, false);
    }

    seekPoseKey(index: number): void {
        const e = this.host.current();
        const key = e?.poseKeys[index];
        if (key) this.host.seek(key.time);
    }

    deletePoseKey(index: number): void {
        const e = this.host.current();
        if (!e || e.locked) return;
        this.host.change(() => {
            e.poseKeys.splice(index, 1);
        }, false);
    }

    /** Joint list and current XYZ angles for the pose panel. */
    jointState(entity: Entity): { joints: Array<[string, string]>; angles: [number, number, number] } {
        const joints = Object.entries(assetJoints(entity.asset));
        const joint = (useEditorStore.getState().selectedJoint || (joints[0]?.[0] as Joint) || 'head') as Joint;
        return { joints, angles: jointAngles(samplePose(entity, this.host.clock)[joint], joint) };
    }
}

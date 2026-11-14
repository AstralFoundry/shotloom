import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { entity, type Entity, type Vec3 } from '../model.ts';

/** Static shot placements, separate from the animated camera-move presets. */
export const CAMERA_PLACEMENTS = [
    { id: 'current', label: '当前视角', offset: [0, 0, 0], focal: 35 },
    { id: 'front-medium', label: '正面中景', offset: [0, 0.2, 4.5], focal: 50 },
    { id: 'front-close', label: '正面特写', offset: [0, 0.25, 2.1], focal: 70 },
    { id: 'front-wide', label: '正面全景', offset: [0, 1.2, 9], focal: 28 },
    { id: 'side-follow', label: '侧面跟拍', offset: [4.5, 0.2, -1.3], focal: 50 },
    { id: 'side-close', label: '侧面近景', offset: [2.2, 0.2, -0.3], focal: 70 },
    { id: 'back-medium', label: '背面中景', offset: [0, 0.2, -4.5], focal: 50 },
    { id: 'top-wide', label: '俯拍全景', offset: [0, 8, 3], focal: 28 },
    { id: 'top-45', label: '45° 俯拍', offset: [0, 5, 5], focal: 35 },
    { id: 'low-up', label: '低角度仰拍', offset: [0, -0.7, 3.3], focal: 50 },
    { id: 'low-wide', label: '低角度广角', offset: [0, -0.6, 5], focal: 24 },
    { id: 'shoulder-left', label: '过肩镜头', offset: [-0.9, 0.1, -1.3], focal: 50 },
    { id: 'shoulder-right', label: '过肩镜头（右）', offset: [0.9, 0.1, -1.3], focal: 50 },
    { id: 'bird-eye', label: '鸟瞰', offset: [0, 12, 0.05], focal: 28 },
    { id: 'dutch', label: '荷兰角', offset: [0, 0.2, 4.5], focal: 50 },
] as const;
export type CameraPlacementId = (typeof CAMERA_PLACEMENTS)[number]['id'];

export function createPlacedCamera(input: {
    presetId: CameraPlacementId;
    name: string;
    target: Vec3;
    subject?: { id: string; position: Vec3; yaw: number; targetHeight: number };
    currentView: { position: Vec3; rotation: Vec3; focal: number };
}): Entity {
    const preset = CAMERA_PLACEMENTS.find((item) => item.id === input.presetId);
    if (!preset) throw Error('机位预设不存在');
    const camera = entity('camera', 'camera', input.name);
    const config = camera.camera!;
    if (preset.id === 'current') {
        camera.position = [...input.currentView.position];
        camera.rotation = [...input.currentView.rotation];
        config.aim = 'manual';
        config.focal = input.currentView.focal;
        config.target = new Vector3(0, 0, -5)
            .applyEuler(new Euler(...camera.rotation)).add(new Vector3(...camera.position)).toArray() as Vec3;
        return camera;
    }
    const offset = new Vector3(...preset.offset).applyAxisAngle(new Vector3(0, 1, 0), input.subject?.yaw ?? 0);
    camera.position = new Vector3(...input.target).add(offset).toArray() as Vec3;
    config.target = [...input.target];
    config.focal = preset.focal;
    if (input.subject) {
        config.targetId = input.subject.id;
        config.targetHeight = input.subject.targetHeight;
    }
    if (preset.id === 'side-follow' && input.subject) {
        config.mode = 'follow';
        config.offset = new Vector3(...camera.position).sub(new Vector3(...input.subject.position)).toArray() as Vec3;
        config.inheritRotation = false;
    }
    if (preset.id === 'dutch') {
        const reference = new PerspectiveCamera();
        reference.position.set(...camera.position);
        reference.lookAt(new Vector3(...input.target));
        reference.rotateZ(Math.PI / 8);
        camera.rotation = [reference.rotation.x, reference.rotation.y, reference.rotation.z];
        config.aim = 'manual';
    }
    return camera;
}

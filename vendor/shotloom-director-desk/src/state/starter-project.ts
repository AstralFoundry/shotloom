import { entity, type Project } from '@/core/model.ts';
import { createScene } from '@/core/scene-templates.ts';

/**
 * Starter project used when there is no recoverable session: one dark stage with a
 * mannequin, a camera and a single cut. Mirrors the legacy `createMiniStage` bootstrap.
 */
export function createStarterProject(): Project {
    const project = createScene('blank');
    project.name = '未命名场景';
    project.lighting = {
        defaultLights: true,
        ambient: 0.75,
        exposure: 1.05,
        background: '#0b0d10',
        groundColor: '#1a1e24',
        quality: 'medium',
        sunColor: '#dfe8ff',
        sunIntensity: 1.4,
        sunDirection: [-4, 6, 3],
    };
    project.room = { enabled: false, width: 8, depth: 6, height: 2.8 };
    project.entities = [];
    project.cuts = [];

    const ground = entity('prop', 'ground', '地面', [0, 0, 0]);
    ground.scale = [20, 1, 20];
    ground.color = '#1d2127';
    project.entities.push(ground);

    const actor = entity('actor', 'person', '角色 A', [0, 0, 0]);
    actor.color = '#5b86c9';
    actor.clips = [{ id: crypto.randomUUID(), action: 'idle', start: 0, end: 15, speed: 1 }];
    project.entities.push(actor);

    const camera = entity('camera', 'camera', '机位 1', [2.5, 1.85, 3.6]);
    camera.camera!.focal = 40;
    camera.camera!.target = [0, 1, 0];
    project.entities.push(camera);

    project.cuts = [{ time: 0, cameraId: camera.id }];
    return project;
}

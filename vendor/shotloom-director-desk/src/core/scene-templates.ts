import { demoProject, entity, type Project } from './model.ts';
/** The lite editor starts from one dark stage with a mannequin and a camera. */
export function createScene(): Project {
    const p = demoProject();
    p.name = '空白场地';
    p.entities = [];
    p.references = [];
    p.room = { enabled: false, width: 8, depth: 6, height: 2.8 };
    const ground = entity('prop', 'ground', '地面', [0, 0, 0]);
    ground.scale = [20, 1, 20];
    ground.color = '#1d2127';
    p.entities.push(ground);
    const camera = entity('camera', 'camera', 'A · 主机位', [8, 3, 10]);
    camera.camera!.target = [0, 1, 0];
    camera.camera!.focal = 28;
    p.entities.push(camera);
    p.cuts = [{ time: 0, cameraId: camera.id }];
    return p;
}

import { clone, type Project } from './model.ts';
import { activeCameraId, entityPosition, entityYaw } from './timeline.ts';

/** Export-time engineering facts. No inferred shot labels or generated prose. */
export function directorContext(project: Project, start: number, end = start, cameraId = 'program') {
    const times = [...new Set([start, ...project.cuts.filter(c => c.time > start && c.time < end).map(c => c.time), end])];
    return clone({ version: 1, source: 'director-desk', provenance: 'project-facts', projectName: project.name,
        range: { start, end }, aspect: project.aspect, fps: project.fps, lighting: project.lighting,
        shots: times.filter((_, i) => i < times.length - 1 || times.length === 1).map((time, index) => {
            const id = cameraId === 'program' ? activeCameraId(project, time) : cameraId;
            const camera = project.entities.find(e => e.id === id);
            return { start: time, end: times[index + 1] ?? time, cameraId: id,
                camera: camera ? { name: camera.name, authoredPosition: entityPosition(camera, time).toArray(), authoredRotation: camera.rotation, config: camera.camera, path: camera.path, rotationAnimation: camera.rotationAnimation } : null,
                subjects: project.entities.filter(e => e.visible && (e.kind === 'actor' || e.kind === 'crowd')).map(e => ({ id: e.id, name: e.name, asset: e.asset, color: e.color, position: entityPosition(e, time).toArray(), yaw: entityYaw(e, time, project), path: e.path, clips: e.clips })),
            };
        }),
    });
}

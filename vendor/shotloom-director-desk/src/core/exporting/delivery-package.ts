import { zipSync, strToU8 } from 'fflate';
import type { Project } from '../model.ts';
import type { ExportArtifacts } from './artifacts.ts';

export function shotTable(project: Project) {
    return project.cuts.map((cut, index) => ({
        index, name: cut.name ?? `Shot ${index + 1}`, startSec: cut.time,
        endSec: project.cuts[index + 1]?.time ?? project.duration,
        cameraId: cut.cameraId, cameraName: project.entities.find(e => e.id === cut.cameraId)?.name ?? '',
        subjectIds: cut.subjectIds, camera: project.entities.find(e => e.id === cut.cameraId)?.camera,
    }));
}
/** Keep source timecodes and add output-relative timecodes for partial/camera-specific exports. */
export function deliveryShots(project: Project, options: { start?: number; end?: number; cameraId?: string } = {}) {
    const start = options.start ?? 0, end = options.end ?? project.duration;
    const override = options.cameraId && options.cameraId !== 'program' ? options.cameraId : undefined;
    const camera = project.entities.find(e => e.id === override);
    const shots = override ? [{ index: 0, name: camera?.name ?? override, startSec: start, endSec: end, cameraId: override, cameraName: camera?.name ?? '', subjectIds: undefined, camera: camera?.camera }] : shotTable(project);
    return shots.filter(s => s.startSec < end && s.endSec > start).map(s => ({ ...s,
        startSec: Math.max(start, s.startSec), endSec: Math.min(end, s.endSec),
        videoStartSec: Math.max(start, s.startSec) - start, videoEndSec: Math.min(end, s.endSec) - start,
    }));
}
export async function packageDelivery(input: {
    artifacts: ExportArtifacts; owner: string; videoArtifactId: string;
    document: unknown; project: Project; filename: string;
    previews: Array<{ filename: string; blob: Blob; timesSec: number[] }>;
}) {
    const { artifacts, owner, project, document, videoArtifactId, previews } = input;
    const video = await artifacts.read(owner, videoArtifactId);
    if (video.kind !== 'video') throw Error('videoArtifactId 必须引用视频');
    const shots = deliveryShots(project, video.metadata.options as { start?: number; end?: number; cameraId?: string } | undefined);
    const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const files: Record<string, Uint8Array> = {
        'scene.director.json': strToU8(JSON.stringify(document, null, 2)),
        'shots.json': strToU8(JSON.stringify(shots, null, 2)),
        'shots.csv': strToU8('\ufeff' + [['name','startSec','endSec','videoStartSec','videoEndSec','cameraId','cameraName'], ...shots.map(s => [s.name,s.startSec,s.endSec,s.videoStartSec,s.videoEndSec,s.cameraId,s.cameraName])].map(row => row.map(csv).join(',')).join('\n')),
        [`video/${video.filename}`]: new Uint8Array(await (await artifacts.blob(owner, videoArtifactId)).arrayBuffer()),
    };
    for (const p of previews) files[`previews/${p.filename}`] = new Uint8Array(await p.blob.arrayBuffer());
    files['manifest.json'] = strToU8(JSON.stringify({ version: 1, video, shots, previews: previews.map(({ filename, timesSec }) => ({ filename, timesSec })), files: Object.keys(files) }, null, 2));
    const bytes = zipSync(files, { level: 0 });
    return artifacts.retain(owner, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), input.filename, 'bundle', { videoArtifactId, files: [...Object.keys(files), 'manifest.json'] });
}

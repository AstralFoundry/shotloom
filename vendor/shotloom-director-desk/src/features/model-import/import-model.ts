import { clone, entity, type Vec3 } from '@/core/model.ts';
import { workingElevation } from '@/core/building/floors.ts';
import type { ModelResource } from '@/core/resources/project-resources.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';

export function pruneImportedModels() {
    session.engineOrNull?.externalModels.retain([session.project, ...session.history.undoStack, ...session.history.redoStack]);
}
export async function addDownloadedModelToScene(resource: ModelResource, signal?: AbortSignal) {
    if (useEditorStore.getState().busy) throw Error('导演台正在执行其他任务');
    try {
        session.setBusy(true);
        try {
            await inspectImportedModel(resource, signal);
            signal?.throwIfAborted();
        } finally {
            session.setBusy(false);
        }
        return placeImportedModel(resource);
    } finally {
        pruneImportedModels();
    }
}
export async function inspectImportedModel(resource: ModelResource, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const engine = session.engineOrNull;
    if (!engine) throw Error('导演台画布尚未准备好');
    const original = session.project, revision = useEditorStore.getState().revision;
    const project = { ...original, version: 2 as const, resources: [...(original.resources ?? []).filter(item => item.id !== resource.id), resource] };
    await engine.externalModels.prepare(project, signal);
    signal?.throwIfAborted();
    if (session.project !== original || useEditorStore.getState().revision !== revision)
        throw Error('读取期间工程已变化，请重新导入');
    const inspection = engine.externalModels.inspection(resource);
    if (!inspection.meshes) throw Error('这是独立动作文件，不能作为场景模型放置');
    resource.copyright ||= inspection.copyright;
    return { inspection, size: engine.externalModels.measure(resource, 1, [0, 0, 0]) };
}
export function placeImportedModel(resource: ModelResource, options: {
    name?: string; kind?: 'prop' | 'actor'; appearance?: 'original' | 'white' | 'color';
    unitScale?: number; orientation?: Vec3; position?: Vec3;
} = {}) {
    const engine = session.engineOrNull;
    if (!engine) throw Error('导演台画布尚未准备好');
    const inspection = engine.externalModels.inspection(resource);
    const kind = options.kind ?? (inspection.skins ? 'actor' : 'prop');
    const rotation = options.orientation ?? [0, 0, 0];
    const unitScale = options.unitScale ?? 1;
    const measured = engine.externalModels.measure(resource, unitScale, rotation);
    const target = engine.orbit.target, elevation = workingElevation(session.project);
    const position = options.position ?? engine.snapPosition([target.x, elevation, target.z]);
    const model = entity(kind, 'external-model', options.name?.trim() || resource.name, position);
    if (!options.position) model.position[1] = elevation;
    model.external = { resourceId: resource.id, appearance: options.appearance ?? 'original', unitScale, orientation: rotation };
    if (kind === 'actor') model.height = measured[1];
    const placed = session.change(() => {
        session.project.version = 2;
        session.project.resources ??= [];
        const existing = session.project.resources.findIndex(item => item.id === resource.id);
        if (existing < 0) session.project.resources.push(clone(resource));
        else session.project.resources[existing] = clone(resource);
        session.project.entities.push(model);
        useEditorStore.getState().patch({ selected: model.id, inspectorTab: 'base', sidebarTab: 'scene' });
    }, true, true);
    if (!placed) throw Error('未能放入场景，请完成当前编辑后重试');
    engine.focus(model.id);
    return { applied: true, entityId: model.id, resourceId: resource.id, position: model.position, size: measured, copyright: resource.copyright, license: resource.license, source: resource.source };
}

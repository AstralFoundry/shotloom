import { useEditorStore } from './editor-store.ts';
import type { Entity, Project } from '@/core/model.ts';

/**
 * Project data is mutated in place; `revision` is the explicit render signal.
 * These selectors subscribe to it so panels stay correct without immutable updates.
 */
export function useRevision(): number {
    return useEditorStore((state) => state.revision);
}

export function useProject(): Project {
    useRevision();
    return useEditorStore((state) => state.project);
}

export function useSelectedEntity(): Entity | undefined {
    const project = useProject();
    const selected = useEditorStore((state) => state.selected);
    return project.entities.find((entity) => entity.id === selected);
}

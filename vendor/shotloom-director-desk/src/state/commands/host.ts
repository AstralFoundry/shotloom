import type { Engine } from '@/core/engine.ts';
import type { Entity, Project } from '@/core/model.ts';
import type { SceneWorkspace } from '@/core/scenes/scene-workspace.ts';
import type { EditorPatch, ViewMode } from '../editor-store.ts';

/**
 * Narrow surface that command groups may use. Commands never touch the engine's private
 * fields or the zustand store directly; the session implements all of this in one place.
 */
export interface EditorCommandHost {
    readonly project: Project;
    readonly engine: Engine | null;
    readonly history: SceneWorkspace;
    /** Exact playhead in seconds (the store value is throttled while playing). */
    readonly clock: number;
    setClock(seconds: number): void;
    current(): Entity | undefined;
    patch(partial: EditorPatch): void;
    change(fn: () => void, rebuild?: boolean): boolean;
    changed(rebuild?: boolean): void;
    extendDuration(): void;
    setView(view: ViewMode): void;
    finishPath(): void;
    cancelPath(): void;
    selectEntity(id: string, preserveTimelineSelection?: boolean): void;
    seek(seconds: number, deferSample?: boolean): void;
}

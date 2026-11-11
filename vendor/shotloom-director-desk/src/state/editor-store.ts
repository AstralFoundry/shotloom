import { create } from 'zustand';
import type { Joint, Project } from '@/core/model.ts';
import { createStarterProject } from './starter-project.ts';

export type ViewMode = 'stage' | 'split' | 'shot';

export type SidebarTab = 'scene' | 'assets' | 'shots';

export type InspectorTab =
    'base' | 'camera' | 'light' | 'actions' | 'pose' | 'path' | 'environment' | 'spatial' | 'keys';

export type TransformMode = 'translate' | 'rotate' | 'scale';

/**
 * The editor keeps one mutable project object (history snapshots it) and a handful of
 * UI-only fields. `revision` is the render signal: anything that mutates the project in
 * place bumps it, so React panels can stay cheap while the domain model stays imperative.
 */
export interface EditorState {
    project: Project;
    selected: string;
    time: number;
    playing: boolean;
    loop: boolean;
    view: ViewMode;
    preview: string;
    inspectorTab: InspectorTab;
    sidebarTab: SidebarTab;
    query: string;
    assetFilter: string;
    transformMode: TransformMode;
    /** Entity whose path is being drawn, if any. */
    pathDraft: string | null;
    pathDrawMode: 'points' | 'freehand';
    pathSurfaceMode: 'surface' | 'ground';
    pathDrawDuration: number;
    selectedPoint: number;
    /** Action clip selected in the inspector/timeline. */
    selectedClipId: string | null;
    /** Motion-path section selected on the timeline. */
    selectedPathSection: { entityId: string; index: number } | null;
    /** Joint being edited in the pose panel, '' when none. */
    selectedJoint: Joint | '';
    revision: number;
    dirty: boolean;
    busy: boolean;
    status: string;
    engineReady: boolean;
    gridVisible: boolean;
    patch: (partial: EditorPatch) => void;
}

export type EditorPatch = Partial<Omit<EditorState, 'patch'>>;

const starter = createStarterProject();

export const useEditorStore = create<EditorState>()((set) => ({
    project: starter,
    selected: starter.entities.find((entity) => entity.kind === 'actor')?.id ?? starter.entities[0]?.id ?? '',
    time: 0,
    playing: false,
    loop: false,
    view: 'stage',
    preview: 'program',
    inspectorTab: 'base',
    sidebarTab: 'scene',
    query: '',
    assetFilter: '全部',
    transformMode: 'translate',
    pathDraft: null,
    pathDrawMode: 'points',
    pathSurfaceMode: 'surface',
    pathDrawDuration: 5,
    selectedPoint: -1,
    selectedClipId: null,
    selectedPathSection: null,
    selectedJoint: '',
    revision: 0,
    dirty: false,
    busy: false,
    status: '',
    engineReady: false,
    gridVisible: true,
    patch: (partial) => set(partial),
}));

export const patchEditor = (partial: EditorPatch) => useEditorStore.getState().patch(partial);

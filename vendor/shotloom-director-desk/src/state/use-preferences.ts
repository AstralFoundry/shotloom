import { useSyncExternalStore } from 'react';
import { editorPreferences, type EditorPreferences } from '@/core/editor/preferences.ts';

/**
 * Subscribe to editor preferences.
 *
 * Preferences live outside React (they are written by the engine's navigation binding and by
 * the settings panel), so the panel and the viewport toolbar read them through this hook
 * instead of duplicating state.
 */
export function usePreferences(): Readonly<EditorPreferences> {
    // The preferences object is mutated in place; snapshot the version so React sees a change.
    useSyncExternalStore(
        (listener) => editorPreferences.subscribe(listener),
        () => editorPreferences.version,
        () => editorPreferences.version,
    );
    return editorPreferences.current;
}

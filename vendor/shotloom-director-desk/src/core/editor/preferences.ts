export const preferenceDefaults = {
    navigationSpeed: 3,
    navigationBoost: 3.333333,
    rotationSpeed: 1,
    zoomSpeed: 1,
    panSpeed: 1,
    viewDamping: true,
    gizmoSize: 0.78,
    showNavigationHint: true,
    /** Grid snapping step in metres; 0 turns grid snapping off. */
    placementSnap: 0,
    /** Snap to nearby object faces/boundaries while dragging a prop. */
    objectSnap: false,
    /** `draft` halves the render resolution while navigating on weak machines. */
    previewQuality: 'full' as 'full' | 'draft',
    /** Framing guides drawn over the camera view. */
    showThirds: true,
    showSafeArea: false,
    showCenterCross: false,
    /** Overlay the previous shot's last frame as a composition reference. */
    showPreviousShot: false,
    /** Object name tags over the stage: off, selected object only, or every object. */
    labelMode: 'selected' as 'off' | 'selected' | 'all',
    /** Panel geometry, in pixels. `null` means "use the responsive default". */
    sidebarWidth: null as number | null,
    inspectorWidth: null as number | null,
    timelineHeight: null as number | null,
};
export type EditorPreferences = typeof preferenceDefaults;
export type PreferenceKey = keyof EditorPreferences;
export const preferenceRanges: Partial<Record<PreferenceKey, [number, number]>> = {
    navigationSpeed: [0.2, 30],
    navigationBoost: [1, 10],
    rotationSpeed: [0.1, 3],
    zoomSpeed: [0.1, 3],
    panSpeed: [0.1, 3],
    gizmoSize: [0.3, 2],
    placementSnap: [0, 1],
    sidebarWidth: [200, 520],
    inspectorWidth: [240, 560],
    timelineHeight: [140, 720],
};
/** Keys whose value may be `null` (meaning "responsive default"). */
const nullableKeys: ReadonlySet<PreferenceKey> = new Set(['sidebarWidth', 'inspectorWidth', 'timelineHeight']);
/** Keys constrained to a closed set of strings. */
const enumKeys: Partial<Record<PreferenceKey, readonly string[]>> = {
    previewQuality: ['full', 'draft'],
    labelMode: ['off', 'selected', 'all'],
};
const storageKey = 'director-editor-preferences-v1';
const values = { ...preferenceDefaults };
const listeners = new Set<() => void>();
function valid(key: PreferenceKey, value: unknown) {
    if (nullableKeys.has(key) && value === null) return true;
    const allowed = enumKeys[key];
    if (allowed) return typeof value === 'string' && allowed.includes(value);
    if (typeof preferenceDefaults[key] === 'boolean') return typeof value === 'boolean';
    const range = preferenceRanges[key]!;
    return typeof value === 'number' && Number.isFinite(value) && value >= range[0] && value <= range[1];
}
try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? '{}');
    for (const key of Object.keys(preferenceDefaults) as PreferenceKey[])
        if (valid(key, saved?.[key])) Object.assign(values, { [key]: saved[key] });
} catch {
    /* Missing or invalid local preferences retain defaults. */
}
function publish() {
    try {
        globalThis.localStorage?.setItem(storageKey, JSON.stringify(values));
    } catch {
        /* Current-session preferences still apply. */
    }
    listeners.forEach((listener) => listener());
}
export const editorPreferences = {
    get current(): Readonly<EditorPreferences> {
        return values;
    },
    set(key: PreferenceKey, value: unknown) {
        if (!Object.hasOwn(preferenceDefaults, key) || !valid(key, value)) return false;
        Object.assign(values, { [key]: value });
        publish();
        return true;
    },
    patch(patch: Record<string, unknown>) {
        for (const [key, value] of Object.entries(patch))
            if (!Object.hasOwn(preferenceDefaults, key) || !valid(key as PreferenceKey, value))
                throw Error('编辑器设置无效：' + key);
        Object.assign(values, patch);
        publish();
    },
    reset() {
        Object.assign(values, preferenceDefaults);
        publish();
    },
    /** Reset only the panel geometry, leaving behavioural preferences alone. */
    resetLayout() {
        Object.assign(values, {
            sidebarWidth: preferenceDefaults.sidebarWidth,
            inspectorWidth: preferenceDefaults.inspectorWidth,
            timelineHeight: preferenceDefaults.timelineHeight,
        });
        publish();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

import { editorThemeTokens, type EditorTheme } from '../../shared/styles/theme-tokens.ts';

/**
 * Theme state without framework dependencies.
 *
 * The three.js engine reads viewport colours and the React shell reads antd configuration, so
 * the current theme has to live below both. Keeping it here (instead of in the antd provider)
 * means `core/` never imports a UI library and the engine stays testable under plain Node.
 */
const storageKey = 'director-editor-theme';
const listeners = new Set<() => void>();

function resolveInitialTheme(): EditorTheme {
    // Precedence is URL → stored → dark. The URL wins because the host shell decides how the
    // desk is embedded: a light product embeds a light desk, whatever this browser chose the
    // last time the desk ran standalone.
    try {
        if (typeof window !== 'undefined') {
            const requested = new URLSearchParams(window.location.search).get('theme');
            if (requested === 'light' || requested === 'dark') return requested;
        }
    } catch {
        /* Non-browser context; fall through to the stored value. */
    }
    try {
        const stored = globalThis.localStorage?.getItem(storageKey);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        /* Session-only preference. */
    }
    return 'dark';
}

let current: EditorTheme = resolveInitialTheme();

function applyDocumentTheme(value: EditorTheme) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.editorTheme = value;
    document.documentElement.style.colorScheme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', editorThemeTokens[value]['app-bg']);
}

export const getEditorTheme = (): EditorTheme => current;

/**
 * Switch the desk theme.
 *
 * `persist` is false when the host pushed the theme through the session handshake: the host
 * owns that choice, and a later standalone run should not inherit it.
 */
export function setEditorTheme(value: EditorTheme, persist = true) {
    if (value !== 'light' && value !== 'dark') return;
    if (value === current) return;
    current = value;
    applyDocumentTheme(value);
    if (persist) {
        try {
            globalThis.localStorage?.setItem(storageKey, value);
        } catch {
            /* Keep the session choice. */
        }
    }
    listeners.forEach((listener) => listener());
}

export function onEditorThemeChange(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Apply the resolved theme to the document; called once at boot. */
export function initializeEditorTheme() {
    applyDocumentTheme(current);
}

/** Colour of one theme token, for three.js materials. */
export function themeColor(name: string): string {
    return editorThemeTokens[current][name] ?? '#000000';
}

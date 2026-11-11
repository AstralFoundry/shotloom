/**
 * Editor colour tokens.
 *
 * The desk ships two themes: `dark` (the original studio look) and `light` (for embedding in
 * a light product shell). Every colour literal in the editor CSS lives here, so switching
 * themes is one `data-theme` attribute rather than a second stylesheet.
 *
 * The director viewport follows the desk theme. Shot previews still use the project's saved
 * lighting, so switching the editor theme never changes rendered video or scene data.
 *
 * Alpha-based tokens use a fixed scale (line-*, wash-*, text-*, clip-*) so a literal maps to
 * the nearest step instead of growing a token per value. Differences of 0.02 alpha are not
 * visible; keeping the scale short is what makes the light theme maintainable.
 */
export type EditorTheme = 'dark' | 'light';

export const editorThemeTokens: Record<EditorTheme, Record<string, string>> = {
    dark: {
        /* Surfaces ------------------------------------------------------ */
        'app-bg': '#000000',
        'gp-surface': '#171717',
        'gp-surface-raised': '#1f1f1f',
        'gp-surface-sunken': '#101010',
        'gp-timeline': '#191919',
        'gp-card': '#222222',
        'gp-card-hover': '#292929',
        'gp-field': '#242424',
        'gp-field-hover': '#2c2c2c',
        'gp-selected': '#303030',
        'gp-dialog': '#1a1a1a',
        'gp-popover': '#242424',
        'gp-clip': '#2b2b2b',
        'gp-clip-remove-hover': '#454545',

        /* Text ---------------------------------------------------------- */
        'text-strong': '#fafafa',
        'text-bright': '#f4f4f4',
        'text-primary': '#ededed',
        'text-inverse': '#0a0a0a',
        'text-on-accent': '#ffffff',
        'text-a75': 'rgba(250, 250, 250, 0.75)',
        'text-a62': 'rgba(250, 250, 250, 0.62)',
        'text-a50': 'rgba(250, 250, 250, 0.5)',
        'text-a42': 'rgba(250, 250, 250, 0.42)',
        'text-a35': 'rgba(250, 250, 250, 0.35)',
        'text-a26': 'rgba(250, 250, 250, 0.26)',

        /* Lines --------------------------------------------------------- */
        'line-faint': 'rgba(255, 255, 255, 0.06)',
        'line-soft': 'rgba(255, 255, 255, 0.08)',
        line: 'rgba(255, 255, 255, 0.1)',
        'line-mid': 'rgba(255, 255, 255, 0.12)',
        'line-strong': 'rgba(255, 255, 255, 0.14)',
        'line-stronger': 'rgba(255, 255, 255, 0.16)',
        'line-strongest': 'rgba(255, 255, 255, 0.18)',

        /* Interaction washes ------------------------------------------- */
        'wash-1': 'rgba(255, 255, 255, 0.05)',
        'wash-2': 'rgba(255, 255, 255, 0.07)',
        'wash-3': 'rgba(255, 255, 255, 0.1)',
        'wash-4': 'rgba(255, 255, 255, 0.14)',
        'wash-5': 'rgba(255, 255, 255, 0.18)',
        'wash-6': 'rgba(255, 255, 255, 0.22)',

        /* State --------------------------------------------------------- */
        accent: '#8b8aff',
        'accent-soft': 'rgba(139, 138, 255, 0.13)',
        'accent-ring': 'rgba(139, 138, 255, 0.14)',
        focus: '#aee8dc',
        danger: '#bd4d4d',
        'danger-hover': '#d45c5c',
        'danger-text': '#ec7777',
        'danger-soft': 'rgba(223, 79, 79, 0.14)',
        warning: '#d9b26a',
        playhead: '#ffffff',

        /* Floats above the viewport --------------------------------------- */
        'overlay-bg': 'rgba(10, 10, 10, 0.72)',
        'overlay-bg-soft': 'rgba(12, 12, 12, 0.72)',
        'toolbar-bg': 'rgba(21, 21, 21, 0.94)',
        'toolbar-btn': 'rgba(250, 250, 250, 0.68)',
        'toolbar-active-bg': 'rgba(255, 255, 255, 0.14)',
        'toolbar-active-border': 'rgba(255, 255, 255, 0.16)',
        'label-bg': 'rgba(26, 26, 26, 0.9)',
        'label-selected-bg': 'rgba(48, 48, 48, 0.95)',
        'label-selected-border': '#b9b9b9',
        shadow: 'rgba(0, 0, 0, 0.42)',
        'shadow-mid': 'rgba(0, 0, 0, 0.5)',
        'shadow-strong': 'rgba(0, 0, 0, 0.55)',
        'shadow-hard': 'rgba(0, 0, 0, 0.9)',
        scrollbar: 'rgba(255, 255, 255, 0.14)',
        'scrollbar-hover': 'rgba(255, 255, 255, 0.26)',
        'logo-bg': '#fafafa',
        'logo-text': '#0a0a0a',

        /* Director viewport ---------------------------------------------- */
        'vp-stage': '#000000',
        'vp-shot-bg': '#08090a',
        'vp-stage-bg': '#080808',
        'vp-floor': '#11151b',
        'vp-grid-major': '#355262',
        'vp-grid-minor': '#253844',
        'vp-selection': '#5a9bb8',
        'vp-path-point': '#87add9',
        'vp-text-a62': 'rgba(255, 255, 255, 0.62)',
        'vp-text-a50': 'rgba(255, 255, 255, 0.5)',

        /* Timeline accents --------------------------------------------- */
        'mix-base': '#1b1b1b',
        'mix-line': '#242424',
        'clip-path-accent': '#6daac4',
        'clip-cut-accent': '#d6a178',
        'track-accent-default': '#aa8be8',
        'resize-handle-active': '#a48ad8',
        'lane-end': '#4a4a4a',
        'track-selected-bg': '#222026',
        'clip-remove': '#8f8f8f',
        'muted-glyph': '#b8b8b8',
        'zoom-label': '#a5a5a5',
    },
    light: {
        /* Surfaces ------------------------------------------------------ */
        'app-bg': '#f4f4f5',
        'gp-surface': '#ffffff',
        'gp-surface-raised': '#ffffff',
        'gp-surface-sunken': '#fafafa',
        'gp-timeline': '#ffffff',
        'gp-card': '#f6f6f7',
        'gp-card-hover': '#ececee',
        'gp-field': '#ffffff',
        'gp-field-hover': '#f7f7f8',
        'gp-selected': '#e8e8ec',
        'gp-dialog': '#ffffff',
        'gp-popover': '#ffffff',
        'gp-clip': '#f1f1f3',
        'gp-clip-remove-hover': '#e3e3e6',

        /* Text ---------------------------------------------------------- */
        'text-strong': '#0a0a0b',
        'text-bright': '#111114',
        'text-primary': '#1f1f22',
        'text-inverse': '#ffffff',
        'text-on-accent': '#ffffff',
        'text-a75': 'rgba(24, 24, 27, 0.75)',
        'text-a62': 'rgba(24, 24, 27, 0.62)',
        'text-a50': 'rgba(24, 24, 27, 0.5)',
        'text-a42': 'rgba(24, 24, 27, 0.42)',
        'text-a35': 'rgba(24, 24, 27, 0.35)',
        'text-a26': 'rgba(24, 24, 27, 0.26)',

        /* Lines --------------------------------------------------------- */
        'line-faint': 'rgba(24, 24, 27, 0.06)',
        'line-soft': 'rgba(24, 24, 27, 0.08)',
        line: 'rgba(24, 24, 27, 0.1)',
        'line-mid': 'rgba(24, 24, 27, 0.12)',
        'line-strong': 'rgba(24, 24, 27, 0.14)',
        'line-stronger': 'rgba(24, 24, 27, 0.16)',
        'line-strongest': 'rgba(24, 24, 27, 0.18)',

        /* Interaction washes ------------------------------------------- */
        'wash-1': 'rgba(24, 24, 27, 0.04)',
        'wash-2': 'rgba(24, 24, 27, 0.06)',
        'wash-3': 'rgba(24, 24, 27, 0.08)',
        'wash-4': 'rgba(24, 24, 27, 0.11)',
        'wash-5': 'rgba(24, 24, 27, 0.14)',
        'wash-6': 'rgba(24, 24, 27, 0.18)',

        /* State --------------------------------------------------------- */
        accent: '#5b57e8',
        'accent-soft': 'rgba(91, 87, 232, 0.1)',
        'accent-ring': 'rgba(91, 87, 232, 0.16)',
        focus: '#0f8f7d',
        danger: '#c0392b',
        'danger-hover': '#d14836',
        'danger-text': '#b3352a',
        'danger-soft': 'rgba(192, 57, 43, 0.1)',
        warning: '#a86a10',
        playhead: '#1f1f22',

        /* Floats above the viewport --------------------------------------- */
        'overlay-bg': 'rgba(255, 255, 255, 0.9)',
        'overlay-bg-soft': 'rgba(255, 255, 255, 0.9)',
        'toolbar-bg': 'rgba(255, 255, 255, 0.96)',
        'toolbar-btn': 'rgba(24, 24, 27, 0.64)',
        'toolbar-active-bg': '#111114',
        'toolbar-active-border': '#111114',
        'label-bg': 'rgba(255, 255, 255, 0.94)',
        'label-selected-bg': 'rgba(255, 255, 255, 0.98)',
        'label-selected-border': '#aeb8c4',
        shadow: 'rgba(24, 24, 27, 0.12)',
        'shadow-mid': 'rgba(24, 24, 27, 0.16)',
        'shadow-strong': 'rgba(24, 24, 27, 0.2)',
        'shadow-hard': 'rgba(24, 24, 27, 0.4)',
        scrollbar: 'rgba(24, 24, 27, 0.16)',
        'scrollbar-hover': 'rgba(24, 24, 27, 0.3)',
        'logo-bg': '#1f1f22',
        'logo-text': '#ffffff',

        /* Director viewport ---------------------------------------------- */
        'vp-stage': '#fafafa',
        'vp-shot-bg': '#f3f4f6',
        'vp-stage-bg': '#fafafa',
        'vp-floor': '#f3f4f6',
        'vp-grid-major': '#aeb9c7',
        'vp-grid-minor': '#cbd2da',
        'vp-selection': '#5b83aa',
        'vp-path-point': '#4776a5',
        'vp-text-a62': 'rgba(24, 24, 27, 0.62)',
        'vp-text-a50': 'rgba(24, 24, 27, 0.5)',

        /* Timeline accents --------------------------------------------- */
        'mix-base': '#ffffff',
        'mix-line': '#e4e4e7',
        'clip-path-accent': '#3f8bab',
        'clip-cut-accent': '#b8794a',
        'track-accent-default': '#7c5cd6',
        'resize-handle-active': '#7c5cd6',
        'lane-end': '#b8b8bd',
        'track-selected-bg': '#eeeef3',
        'clip-remove': 'rgba(24, 24, 27, 0.42)',
        'muted-glyph': 'rgba(24, 24, 27, 0.55)',
        'zoom-label': 'rgba(24, 24, 27, 0.55)',
    },
};

/** Serialise one theme as a CSS rule body of custom properties. */
export function themeCssVariables(theme: EditorTheme): string {
    return Object.entries(editorThemeTokens[theme])
        .map(([name, value]) => `    --ed-${name}: ${value};`)
        .join('\n');
}

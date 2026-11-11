import { useCallback, useRef, useState } from 'react';
import { editorPreferences } from '@/core/editor/preferences.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';

type Edge = 'left' | 'right';

/**
 * Drag handle for a side panel.
 *
 * Widths are stored in preferences rather than component state: the editor grid reads them as
 * CSS variables, so a drag has to republish until the whole shell re-lays out. Double-click and
 * Home restore the responsive default, matching the timeline's existing resize handle.
 */
export function PanelResize({
    side,
    preferenceKey,
    label,
    min = 200,
    max = 560,
    invert = false,
}: {
    side: Edge;
    preferenceKey: 'sidebarWidth' | 'inspectorWidth';
    label: string;
    min?: number;
    max?: number;
    /**
     * True when dragging right should shrink the panel. The right-hand inspector grows as the
     * pointer moves left, so its delta is inverted.
     */
    invert?: boolean;
}) {
    const t = useTranslation();
    const [active, setActive] = useState(false);
    const drag = useRef<{ x: number; width: number } | null>(null);

    const width = () => {
        const stored = editorPreferences.current[preferenceKey];
        if (stored !== null) return stored;
        // No stored width yet: measure the live panel so the first drag starts where the
        // pointer is, not at the responsive fallback.
        const panel = document.querySelector<HTMLElement>(side === 'right' ? '.editor .sidebar' : '.editor .inspector');
        return panel?.getBoundingClientRect().width ?? min;
    };

    const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));

    const start = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0) return;
            drag.current = { x: event.clientX, width: width() };
            setActive(true);
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        [min],
    );

    const move = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            const state = drag.current;
            if (!state) return;
            const delta = event.clientX - state.x;
            editorPreferences.set(preferenceKey, clamp(state.width + (invert ? -delta : delta)));
        },
        [invert, max, min, preferenceKey],
    );

    const end = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        drag.current = null;
        setActive(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
    }, []);

    const reset = () => editorPreferences.set(preferenceKey, null);

    return (
        <button
            type="button"
            className={`panel-resize panel-resize--${side} ${active ? 'is-active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            title={t('拖动调整宽度，双击恢复')}
            tabIndex={0}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={reset}
            onKeyDown={(event) => {
                const step = event.shiftKey ? 32 : 8;
                const current = width();
                if (event.key === 'Home') {
                    event.preventDefault();
                    reset();
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    const direction = event.key === 'ArrowRight' ? 1 : -1;
                    editorPreferences.set(preferenceKey, clamp(current + direction * step * (invert ? -1 : 1)));
                }
            }}
        />
    );
}

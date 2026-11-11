import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/state/use-preferences.ts';

/**
 * Framing guides drawn over the camera view.
 *
 * These are pure overlay chrome in aspect-percentage units, so they follow the letterboxed
 * picture whatever the panel size — no per-frame work in the render loop. The shot canvas
 * letterboxes to the project aspect, so the guides are positioned against the picture box
 * rather than the panel: `frame` is that box's rect relative to the container.
 */
export function FramingGuides({ aspect }: { aspect: string }) {
    const preferences = usePreferences();
    const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const hostRef = useRef<HTMLSpanElement>(null);

    // Mirror the letterboxed picture box of the shot canvas. A ResizeObserver keeps it correct
    // when the panel is resized or the inspector is dragged wider.
    useEffect(() => {
        const host = hostRef.current?.parentElement;
        if (!host) return;
        const [aw, ah] = aspect.split(':').map(Number);
        const ratio = aw > 0 && ah > 0 ? aw / ah : 16 / 9;
        const measure = () => {
            const rect = host.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const width = Math.min(rect.width, rect.height * ratio);
            const height = width / ratio;
            setFrame({
                left: (rect.width - width) / 2,
                top: (rect.height - height) / 2,
                width,
                height,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        return () => observer.disconnect();
    }, [aspect]);

    const showAnything = preferences.showThirds || preferences.showSafeArea || preferences.showCenterCross;
    if (!showAnything || !frame) return <span ref={hostRef} hidden />;

    const style = {
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
    } as React.CSSProperties;

    return (
        <span ref={hostRef} className="framing-guides" style={style} aria-hidden="true">
            {preferences.showThirds ? (
                <>
                    <i className="framing-guides__line framing-guides__line--v" style={{ left: '33.333%' }} />
                    <i className="framing-guides__line framing-guides__line--v" style={{ left: '66.666%' }} />
                    <i className="framing-guides__line framing-guides__line--h" style={{ top: '33.333%' }} />
                    <i className="framing-guides__line framing-guides__line--h" style={{ top: '66.666%' }} />
                </>
            ) : null}
            {preferences.showSafeArea ? <i className="framing-guides__safe" /> : null}
            {preferences.showCenterCross ? (
                <>
                    <i className="framing-guides__cross framing-guides__cross--v" />
                    <i className="framing-guides__cross framing-guides__cross--h" />
                </>
            ) : null}
        </span>
    );
}

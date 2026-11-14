import type { CaptureAspect } from '@/core/editor/viewport-capture.ts';
import { captureRect } from '@/core/editor/viewport-capture.ts';

/** Proportional frames share the rounded stroke of the toolbar icons. */
export function AspectIcon({ aspect, size = 36 }: { aspect: CaptureAspect; size?: number }) {
    const frame = captureRect(28, 24, aspect);
    return (
        <svg className="aspect-icon" width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={size < 24 ? 3 : 1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {aspect === 'auto' ? (
                <>
                    <path d="M15 8H11a3 3 0 0 0-3 3v4m17-7h4a3 3 0 0 1 3 3v4M8 25v4a3 3 0 0 0 3 3h4m17-7v4a3 3 0 0 1-3 3h-4" />
                    <rect x="14" y="14" width="12" height="12" rx="1.5" />
                </>
            ) : (
                <rect x={(40 - frame.width) / 2} y={(40 - frame.height) / 2} width={frame.width} height={frame.height} rx="1.75" />
            )}
        </svg>
    );
}

import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/state/editor-store.ts';
import { session } from '@/state/editor-session.ts';
import { useProject } from '@/state/use-editor.ts';

/**
 * The last frame of the shot before the one under the playhead, used as a composition
 * reference: matching eyeline, headroom and screen direction across a cut is the job this
 * tool exists for, and comparing two frames is far easier than holding one in memory.
 *
 * Rendering reuses the export path (`renderOutput`) at thumbnail size, so what you see is the
 * real camera and the real scene. It runs only when the preference is on and the shot or time
 * actually changes — never per frame.
 */
export function PreviousShotOverlay({ cameraId }: { cameraId: string }) {
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const playing = useEditorStore((state) => state.playing);
    const [url, setUrl] = useState('');
    const [label, setLabel] = useState('');
    const request = useRef(0);

    // The previous cut is the last one strictly before the playhead.
    const cutIndex = project.cuts.reduce((found, cut, index) => (cut.time <= time ? index : found), -1);
    const previous = cutIndex > 0 ? project.cuts[cutIndex - 1] : undefined;
    const previousCamera = previous ? project.entities.find((entity) => entity.id === previous.cameraId) : undefined;
    const sampleTime = previous ? previous.time : 0;

    useEffect(() => {
        if (!previous || !previousCamera || playing) {
            setUrl('');
            setLabel('');
            return;
        }
        // Ignore a camera that is already the one being viewed: overlaying itself is noise.
        if (previousCamera.id === cameraId) {
            setUrl('');
            setLabel('');
            return;
        }
        const token = ++request.current;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            const engine = session.engineOrNull;
            const lease = session.renderLease;
            if (!engine || !lease) return;
            const ratio = 640;
            void (async () => {
                try {
                    // One frame, borrowed: the overlay must never leave the engine parked on the
                    // previous shot's time, and must not race the shot list's thumbnail sweep.
                    const data = await lease.borrow(() => {
                        engine.prepareOutput(sampleTime);
                        const canvas = engine.renderOutput(
                            sampleTime,
                            ratio,
                            Math.round(ratio * 0.5625),
                            previousCamera.id,
                        );
                        return canvas.toDataURL('image/png');
                    });
                    if (cancelled || token !== request.current) return;
                    setUrl(data);
                    setLabel(previousCamera.name);
                } catch {
                    // A failed reference frame must never block the viewport.
                    if (!cancelled && token === request.current) {
                        setUrl('');
                        setLabel('');
                    }
                }
            })();
        }, 180);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [cameraId, previous, previousCamera, playing, sampleTime]);

    if (!url) return null;

    return (
        <span className="previous-shot" aria-hidden="true">
            <img src={url} alt="" />
            <small>{label}</small>
        </span>
    );
}

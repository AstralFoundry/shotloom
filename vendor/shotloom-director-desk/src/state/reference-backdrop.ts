import { useSyncExternalStore } from 'react';

export interface ReferenceBackdrop {
    /** Opaque identifier from the host edge; used when reporting removal back. */
    edgeId: string;
    name: string;
    /** Data URL or blob URL for the preview thumbnail. */
    url: string;
    /** Size of the loaded image once decoded, for the summary line. */
    width: number;
    height: number;
    /** Source entity in the host document, when known. */
    sourceNodeId?: string;
}

/**
 * The reference image the host pushes into the desk.
 *
 * The host owns the texture (it decodes and attaches it to the engine), but the *user* needs to
 * see what was attached and be able to detach it. Keeping the metadata here — rather than in the
 * bridge — lets the environment panel render it without the bridge having to expose engine
 * internals, and the bridge stays the only thing that talks postMessage.
 */
const listeners = new Set<() => void>();
let current: ReferenceBackdrop | null = null;

export function getReferenceBackdrop(): ReferenceBackdrop | null {
    return current;
}

export function setReferenceBackdrop(value: ReferenceBackdrop | null) {
    current = value;
    listeners.forEach((listener) => listener());
}

export function onReferenceBackdropChange(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Subscribe from React; returns null when the desk runs standalone. */
export function useReferenceBackdrop(): ReferenceBackdrop | null {
    return useSyncExternalStore(
        (listener) => onReferenceBackdropChange(listener),
        getReferenceBackdrop,
        getReferenceBackdrop,
    );
}

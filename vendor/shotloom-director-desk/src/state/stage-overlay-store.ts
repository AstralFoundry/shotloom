import { create } from 'zustand';

export interface StageLabel {
    id: string;
    name: string;
    color: string;
    /** Entity kind, so the tag can show a matching icon. */
    kind: 'actor' | 'crowd' | 'camera' | 'prop';
    light: boolean;
    x: number;
    y: number;
    visible: boolean;
}

interface StageOverlayState {
    labels: StageLabel[];
    selected: string;
    patch: (partial: Partial<Omit<StageOverlayState, 'patch'>>) => void;
}

/**
 * Per-frame viewport chrome (object labels). Kept out of the editor store because it is
 * updated by the render loop at ~30 Hz and must not re-render the inspector or timeline.
 */
export const useStageOverlayStore = create<StageOverlayState>()((set) => ({
    labels: [],
    selected: '',
    patch: (partial) => set(partial),
}));

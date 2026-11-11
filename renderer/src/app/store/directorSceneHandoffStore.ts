import { create } from "zustand";

/**
 * Hand-off buffer between the two 3D desk instances.
 *
 * The full-page workspace and a canvas node each run their own desk document, and neither can
 * see the other's store. A user who blocks a scene in the workspace and then adds a director
 * node on the canvas otherwise starts from an empty stage. This module is only a carrier: it
 * holds one document and the id of the node it came from, and the receiving view pulls it.
 */

export type DirectorSceneHandoff = {
  /** The `director-desk` document exactly as the source instance exported it. */
  document: unknown;
  /** Source node id when the scene came from a canvas node. */
  sourceNodeId?: string;
  /** Human label used in the receiving toast. */
  label: string;
};

interface DirectorSceneHandoffState {
  handoff: DirectorSceneHandoff | null;
  /** Put a scene into the buffer; the next consumer clears it. */
  setHandoff: (handoff: DirectorSceneHandoff) => void;
  /** Read and clear, so a scene is never applied twice by remounts. */
  takeHandoff: () => DirectorSceneHandoff | null;
}

export const useDirectorSceneHandoffStore = create<DirectorSceneHandoffState>((set, get) => ({
  handoff: null,
  setHandoff: (handoff) => set({ handoff }),
  takeHandoff: () => {
    const handoff = get().handoff;
    if (handoff) set({ handoff: null });
    return handoff;
  },
}));
